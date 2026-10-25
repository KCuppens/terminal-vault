use std::collections::HashMap;
use std::fmt::Display;
use std::path::PathBuf;
use std::sync::Mutex;

use tokio::sync::{mpsc, oneshot};
use tvcore::session::{SessionEvent, SessionHandle, SessionManager};
use tvcore::{ModelError, Vault, VaultData};
use uuid::Uuid;

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
    pub prompts: Mutex<HashMap<Uuid, oneshot::Sender<bool>>>,
    /// Serializes host key prompts so parallel panes to one host ask once.
    pub prompt_gate: tokio::sync::Mutex<()>,
    pub manager: SessionManager,
}

impl AppState {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            vault_path,
            vault: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            prompts: Mutex::new(HashMap::new()),
            prompt_gate: tokio::sync::Mutex::new(()),
            manager: SessionManager::default(),
        }
    }

    /// Never call with an await inside `f`: the vault lock is a plain mutex.
    pub fn with_vault<T>(&self, f: impl FnOnce(&mut Vault) -> CmdResult<T>) -> CmdResult<T> {
        let mut guard = self.vault.lock().map_err(|_| "state poisoned".to_string())?;
        f(guard.as_mut().ok_or("vault is locked")?)
    }

    pub fn install_vault(&self, vault: Vault) -> CmdResult<()> {
        *self.vault.lock().map_err(|_| "state poisoned".to_string())? = Some(vault);
        Ok(())
    }

    pub fn take_vault(&self) -> Option<Vault> {
        self.vault.lock().ok()?.take()
    }

    /// Applies `f`, then persists. On any failure the in-memory data is rolled back so
    /// memory never gets ahead of what is on disk.
    pub fn mutate<T>(
        &self,
        f: impl FnOnce(&mut VaultData) -> Result<T, ModelError>,
    ) -> CmdResult<T> {
        self.with_vault(|vault| {
            let backup = vault.data().clone();
            let outcome = f(vault.data_mut())
                .map_err(err)
                .and_then(|out| vault.save().map(|()| out).map_err(err));
            if outcome.is_err() {
                *vault.data_mut() = backup;
            }
            outcome
        })
    }
}
