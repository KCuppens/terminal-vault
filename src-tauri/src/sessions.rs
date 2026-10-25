use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};
use tvcore::session::{
    addr_port, HostKeyDecision, KnownHosts, PtySize, SessionError, SessionEvent,
};
use tvcore::{Host, KnownHost};
use uuid::Uuid;

use crate::state::{err, AppState, CmdResult, SessionEntry};

const HOST_KEY_ROUNDS: usize = 3;

#[derive(Serialize, Clone)]
struct HostKeyPrompt {
    prompt_id: Uuid,
    host_name: String,
    addr_port: String,
    key_type: String,
    fingerprint: String,
    expected_fingerprint: Option<String>,
}

#[tauri::command]
pub async fn session_open(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: Uuid,
    cols: u32,
    rows: u32,
) -> CmdResult<String> {
    let size = PtySize { cols, rows };
    for _ in 0..HOST_KEY_ROUNDS {
        let (host, key, known) = state.with_vault(|v| {
            let data = v.data();
            let host = data.host(host_id).ok_or("unknown host")?.clone();
            let key_id = host.key_id.ok_or("host has no key assigned")?;
            let key = data.key(key_id).ok_or("host key not found in vault")?.clone();
            Ok((host, key, data.known_hosts.clone()))
        })?;
        let mut known = KnownHosts::new(known);
        match state.manager.open(&host, &key, &mut known, size).await {
            Ok((handle, events)) => {
                let id = Uuid::new_v4();
                state
                    .sessions
                    .lock()
                    .map_err(|_| "state poisoned".to_string())?
                    .insert(
                        id,
                        SessionEntry {
                            handle,
                            events: Some(events),
                        },
                    );
                return Ok(id.to_string());
            }
            Err(SessionError::HostKey(decision)) => {
                confirm_host_key(&app, &state, &host, decision).await?
            }
            Err(e) => return Err(err(e)),
        }
    }
    Err("host key could not be verified".into())
}

/// Asks the user about an unknown or changed host key and, if accepted, pins it in the
/// vault before releasing the gate so panes opened in parallel do not ask again.
async fn confirm_host_key(
    app: &AppHandle,
    state: &AppState,
    host: &Host,
    decision: HostKeyDecision,
) -> CmdResult<()> {
    let (key_type, fingerprint, expected) = match decision {
        HostKeyDecision::Trusted => return Ok(()),
        HostKeyDecision::NewKey {
            key_type,
            fingerprint,
        } => (key_type, fingerprint, None),
        HostKeyDecision::Changed {
            key_type,
            expected,
            got,
        } => (key_type, got, Some(expected)),
    };
    let addr_port = addr_port(host);
    let _gate = state.prompt_gate.lock().await;

    let current = state.with_vault(|v| Ok(KnownHosts::new(v.data().known_hosts.clone())))?;
    if current.decide(&addr_port, &key_type, &fingerprint) == HostKeyDecision::Trusted {
        return Ok(());
    }

    let prompt_id = Uuid::new_v4();
    let (tx, rx) = oneshot::channel();
    state
        .prompts
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .insert(prompt_id, tx);
    let prompt = HostKeyPrompt {
        prompt_id,
        host_name: host.name.clone(),
        addr_port: addr_port.clone(),
        key_type: key_type.clone(),
        fingerprint: fingerprint.clone(),
        expected_fingerprint: expected,
    };
    if let Err(e) = app.emit("hostkey://prompt", prompt) {
        forget_prompt(state, prompt_id);
        return Err(err(e));
    }
    if !rx.await.unwrap_or(false) {
        return Err("host key not accepted".into());
    }
    state.mutate(|d| {
        d.upsert_known_host(KnownHost {
            addr_port,
            key_type,
            fingerprint_sha256: fingerprint,
        });
        Ok(())
    })
}

fn forget_prompt(state: &AppState, prompt_id: Uuid) {
    if let Ok(mut prompts) = state.prompts.lock() {
        prompts.remove(&prompt_id);
    }
}

#[tauri::command]
pub fn host_key_confirm(
    state: State<'_, AppState>,
    prompt_id: Uuid,
    accept: bool,
) -> CmdResult<()> {
    let tx = state
        .prompts
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .remove(&prompt_id)
        .ok_or("no such host key prompt")?;
    tx.send(accept).map_err(|_| "prompt already closed".to_string())
}

/// Starts forwarding session output once the frontend has registered its listeners,
/// so nothing emitted during connect is lost.
#[tauri::command]
pub fn session_attach(app: AppHandle, state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    let events = state
        .sessions
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .get_mut(&id)
        .ok_or("unknown session")?
        .events
        .take()
        .ok_or("session already attached")?;
    tauri::async_runtime::spawn(pump(app, id, events));
    Ok(())
}

async fn pump(app: AppHandle, id: Uuid, mut events: mpsc::Receiver<SessionEvent>) {
    let mut finished = false;
    while let Some(event) = events.recv().await {
        let _ = match event {
            SessionEvent::Data(bytes) => app.emit(&topic(id, "data"), B64.encode(bytes)),
            SessionEvent::Exit(code) => {
                finished = true;
                app.emit(&topic(id, "exit"), code)
            }
            SessionEvent::Error(message) => {
                finished = true;
                app.emit(&topic(id, "error"), message)
            }
            SessionEvent::Closed => break,
        };
    }
    if !finished {
        let _ = app.emit(&topic(id, "error"), "connection closed");
    }
    if let Ok(mut sessions) = app.state::<AppState>().sessions.lock() {
        sessions.remove(&id);
    }
}

fn topic(id: Uuid, kind: &str) -> String {
    format!("session://{id}/{kind}")
}

fn handle_of(state: &AppState, id: Uuid) -> CmdResult<tvcore::session::SessionHandle> {
    state
        .sessions
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .get(&id)
        .map(|entry| entry.handle.clone())
        .ok_or_else(|| "unknown session".to_string())
}

#[tauri::command]
pub async fn session_write(
    state: State<'_, AppState>,
    id: Uuid,
    data_b64: String,
) -> CmdResult<()> {
    let bytes = B64.decode(data_b64).map_err(err)?;
    handle_of(&state, id)?.write(&bytes).await.map_err(err)
}

#[tauri::command]
pub async fn session_resize(
    state: State<'_, AppState>,
    id: Uuid,
    cols: u32,
    rows: u32,
) -> CmdResult<()> {
    handle_of(&state, id)?.resize(cols, rows).await.map_err(err)
}

#[tauri::command]
pub async fn session_close(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    let entry = state
        .sessions
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .remove(&id);
    if let Some(entry) = entry {
        let _ = entry.handle.close().await;
    }
    Ok(())
}

pub async fn close_all(state: &AppState) {
    let entries: Vec<SessionEntry> = match state.sessions.lock() {
        Ok(mut sessions) => sessions.drain().map(|(_, entry)| entry).collect(),
        Err(_) => return,
    };
    for entry in entries {
        let _ = entry.handle.close().await;
    }
    if let Ok(mut prompts) = state.prompts.lock() {
        prompts.clear();
    }
}
