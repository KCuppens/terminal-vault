use std::collections::HashMap;
use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tvcore::prompt::PromptGate;
use tvcore::session::{SessionEvent, SessionHandle, SessionManager};
use tvcore::{ModelError, UnlockThrottle, Vault, VaultData};
use uuid::Uuid;

const PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

pub type CmdResult<T> = Result<T, String>;

pub fn err(e: impl Display) -> String {
    e.to_string()
}

pub struct SessionEntry {
    pub handle: SessionHandle,
    pub events: Option<mpsc::Receiver<SessionEvent>>,
}

pub struct AppState {
    pub vault_path: PathBuf,
    vault: Mutex<Option<Vault>>,
    pub sessions: Mutex<HashMap<Uuid, SessionEntry>>,
    pub prompts: PromptGate,
    lock_epoch: AtomicU64,
    pub manager: SessionManager,
    throttle: Mutex<UnlockThrottle>,
    started: Instant,
}

impl AppState {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            vault_path,
            vault: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            prompts: PromptGate::new(PROMPT_TIMEOUT),
            lock_epoch: AtomicU64::new(0),
            manager: SessionManager::default(),
            throttle: Mutex::new(UnlockThrottle::default()),
            started: Instant::now(),
        }
    }

    /// Never call with an await inside `f`: the vault lock is a plain mutex.
    pub fn with_vault<T>(&self, f: impl FnOnce(&mut Vault) -> CmdResult<T>) -> CmdResult<T> {
        let mut guard = self
            .vault
            .lock()
            .map_err(|_| "state poisoned".to_string())?;
        f(guard.as_mut().ok_or("vault is locked")?)
    }

    pub fn install_vault(&self, vault: Vault) -> CmdResult<()> {
        *self
            .vault
            .lock()
            .map_err(|_| "state poisoned".to_string())? = Some(vault);
        Ok(())
    }

    /// Locking bumps the epoch so a session that finished connecting afterwards can tell.
    pub fn take_vault(&self) -> Option<Vault> {
        self.lock_epoch.fetch_add(1, Ordering::SeqCst);
        self.vault.lock().ok()?.take()
    }

    pub fn epoch(&self) -> u64 {
        self.lock_epoch.load(Ordering::SeqCst)
    }

    /// Applies `f`, then persists. On any failure the in-memory data is rolled back.
    pub fn mutate<T>(
        &self,
        f: impl FnOnce(&mut VaultData) -> Result<T, ModelError>,
    ) -> CmdResult<T> {
        self.with_vault(|vault| vault.update(f).map_err(err))
    }

    pub fn dir(&self) -> &Path {
        self.vault_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
    }

    pub fn settings_path(&self) -> PathBuf {
        self.dir().join("settings.json")
    }

    pub fn throttle_check(&self) -> CmdResult<()> {
        let now = self.started.elapsed();
        let guard = self
            .throttle
            .lock()
            .map_err(|_| "state poisoned".to_string())?;
        guard.check(now).map_err(UnlockThrottle::message)
    }

    pub fn throttle_failure(&self) {
        let now = self.started.elapsed();
        if let Ok(mut t) = self.throttle.lock() {
            t.record_failure(now);
        }
    }

    pub fn throttle_success(&self) {
        if let Ok(mut t) = self.throttle.lock() {
            t.record_success();
        }
    }
}
