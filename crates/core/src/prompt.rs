use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tokio::sync::oneshot;
use tokio::time::timeout;
use uuid::Uuid;

/// Serializes yes/no questions to the user so parallel connects to one new host ask once.
pub struct PromptGate {
    gate: tokio::sync::Mutex<()>,
    pending: Mutex<HashMap<Uuid, oneshot::Sender<bool>>>,
    limit: Duration,
}

impl PromptGate {
    pub fn new(limit: Duration) -> Self {
        Self {
            gate: tokio::sync::Mutex::new(()),
            pending: Mutex::new(HashMap::new()),
            limit,
        }
    }

    /// Asks once. Holding the gate, `already_done` is checked first, so a caller that waited
    /// behind another prompt for the same host returns without asking. `show` displays the
    /// question under the given id; `close` is called with that id when it ends without a
    /// yes (declined, timed out or cleared) so the display can drop it. On yes, `accept`
    /// runs before the gate is released, so the next caller's `already_done` sees the
    /// result. No answer within the limit counts as no.
    pub async fn ask(
        &self,
        already_done: impl FnOnce() -> Result<bool, String>,
        show: impl FnOnce(Uuid) -> Result<(), String>,
        close: impl FnOnce(Uuid),
        accept: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let _gate = self.gate.lock().await;
        if already_done()? {
            return Ok(());
        }
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "state poisoned".to_string())?
            .insert(id, tx);
        if let Err(e) = show(id) {
            self.forget(id);
            return Err(e);
        }
        if !matches!(timeout(self.limit, rx).await, Ok(Ok(true))) {
            self.forget(id);
            close(id);
            return Err("prompt declined or timed out".into());
        }
        accept()
    }

    pub fn answer(&self, id: Uuid, yes: bool) -> Result<(), String> {
        let tx = self
            .pending
            .lock()
            .map_err(|_| "state poisoned".to_string())?
            .remove(&id)
            .ok_or("no such prompt")?;
        tx.send(yes)
            .map_err(|_| "prompt already closed".to_string())
    }

    /// Declines every open prompt.
    pub fn clear(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }

    fn forget(&self, id: Uuid) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }
}
