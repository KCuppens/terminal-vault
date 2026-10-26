use std::future::Future;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tvcore::session::{
    addr_port, HostKeyDecision, KnownHosts, PtySize, SessionError, SessionEvent,
};
use tvcore::{Host, KeyEntry, KnownHost, ModelError};
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
}

/// Runs `op` against the host's key, asking the user once about an unknown host key and
/// retrying after it is pinned.
async fn with_host_key<T, F, Fut>(
    app: &AppHandle,
    state: &AppState,
    host_id: Uuid,
    op: F,
) -> CmdResult<T>
where
    F: Fn(Host, KeyEntry, KnownHosts) -> Fut,
    Fut: Future<Output = Result<T, SessionError>>,
{
    for _ in 0..HOST_KEY_ROUNDS {
        let (host, key, known) = state.with_vault(|v| {
            let data = v.data();
            let host = data.host(host_id).ok_or("unknown host")?.clone();
            let key_id = host.key_id.ok_or("host has no key assigned")?;
            let key = data
                .key(key_id)
                .ok_or("host key not found in vault")?
                .clone();
            Ok((host, key, data.known_hosts.clone()))
        })?;
        match op(host.clone(), key, KnownHosts::new(known)).await {
            Ok(done) => return Ok(done),
            Err(SessionError::HostKey(HostKeyDecision::NewKey {
                key_type,
                fingerprint,
            })) => confirm_host_key(app, state, &host, key_type, fingerprint).await?,
            Err(SessionError::HostKey(HostKeyDecision::Changed { expected, got, .. })) => {
                return Err(changed_message(&addr_port(&host), &expected, &got));
            }
            Err(SessionError::HostKey(HostKeyDecision::Trusted)) => {}
            Err(e) => return Err(err(e)),
        }
    }
    Err("host key could not be verified".into())
}

/// `tmux`: `None` uses the host's default session, `Some("")` forces a plain shell, and any
/// other value attaches that session.
#[tauri::command]
pub async fn session_open(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: Uuid,
    cols: u32,
    rows: u32,
    tmux: Option<String>,
) -> CmdResult<String> {
    let size = PtySize { cols, rows };
    let epoch = state.epoch();
    let wanted = match tmux {
        Some(name) if name.is_empty() => None,
        Some(name) => Some(name),
        None => state.with_vault(|v| {
            Ok(v.data()
                .host(host_id)
                .ok_or("unknown host")?
                .tmux_session
                .clone())
        })?,
    };
    let manager = state.manager.clone();
    let (handle, events) = with_host_key(&app, &state, host_id, |host, key, mut known| {
        let manager = manager.clone();
        let wanted = wanted.clone();
        async move {
            match wanted {
                Some(name) => {
                    manager
                        .open_tmux(&host, &key, &mut known, size, &name)
                        .await
                }
                None => manager.open(&host, &key, &mut known, size).await,
            }
        }
    })
    .await?;
    let id = Uuid::new_v4();
    let stale = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "state poisoned".to_string())?;
        if state.epoch() == epoch {
            sessions.insert(
                id,
                SessionEntry {
                    handle,
                    events: Some(events),
                },
            );
            None
        } else {
            Some(handle)
        }
    };
    if let Some(handle) = stale {
        let _ = handle.close().await;
        return Err("vault was locked while connecting".into());
    }
    Ok(id.to_string())
}

/// Names of the tmux sessions running on the host, for the connect picker.
#[tauri::command]
pub async fn tmux_sessions(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: Uuid,
) -> CmdResult<Vec<String>> {
    let manager = state.manager.clone();
    with_host_key(&app, &state, host_id, |host, key, mut known| {
        let manager = manager.clone();
        async move { manager.list_tmux(&host, &key, &mut known).await }
    })
    .await
}

/// Asks the user about an unknown host key and, if accepted, pins it in the vault before
/// releasing the gate so panes opened in parallel do not ask again.
async fn confirm_host_key(
    app: &AppHandle,
    state: &AppState,
    host: &Host,
    key_type: String,
    fingerprint: String,
) -> CmdResult<()> {
    let addr_port = addr_port(host);
    state
        .prompts
        .ask(
            || {
                let known =
                    state.with_vault(|v| Ok(KnownHosts::new(v.data().known_hosts.clone())))?;
                match known.decide(&addr_port, &key_type, &fingerprint) {
                    HostKeyDecision::Trusted => Ok(true),
                    HostKeyDecision::NewKey { .. } => Ok(false),
                    HostKeyDecision::Changed { expected, got, .. } => {
                        Err(changed_message(&addr_port, &expected, &got))
                    }
                }
            },
            |prompt_id| {
                let prompt = HostKeyPrompt {
                    prompt_id,
                    host_name: host.name.clone(),
                    addr_port: addr_port.clone(),
                    key_type: key_type.clone(),
                    fingerprint: fingerprint.clone(),
                };
                app.emit("hostkey://prompt", prompt).map_err(err)
            },
            |prompt_id| {
                let _ = app.emit("hostkey://closed", prompt_id.to_string());
            },
            || {
                state.mutate(|d| {
                    if d.known_hosts.iter().any(|k| k.addr_port == addr_port) {
                        return Err(ModelError::DuplicateKnownHost(addr_port.clone()));
                    }
                    d.upsert_known_host(KnownHost {
                        addr_port: addr_port.clone(),
                        key_type: key_type.clone(),
                        fingerprint_sha256: fingerprint.clone(),
                    });
                    Ok(())
                })
            },
        )
        .await
        .map_err(|e| format!("host key not accepted: {e}"))
}

fn changed_message(addr_port: &str, expected: &str, got: &str) -> String {
    format!(
        "host key for {addr_port} changed (on record {expected}, presented {got}); if the server was reinstalled, forget its key in the host list"
    )
}

/// Drops the pinned key for a host so the next connect asks again. This is the only way
/// to replace a pinned key: a changed key is never accepted from a prompt.
#[tauri::command]
pub fn host_key_forget(state: State<'_, AppState>, host_id: Uuid) -> CmdResult<()> {
    let host = state.with_vault(|v| {
        v.data()
            .host(host_id)
            .cloned()
            .ok_or_else(|| "unknown host".to_string())
    })?;
    let addr_port = addr_port(&host);
    state.mutate(|d| {
        d.remove_known_host(&addr_port);
        Ok(())
    })
}

#[tauri::command]
pub fn host_key_confirm(
    state: State<'_, AppState>,
    prompt_id: Uuid,
    accept: bool,
) -> CmdResult<()> {
    state.prompts.answer(prompt_id, accept)
}

/// Starts forwarding session output once the frontend has registered its listeners,
/// so nothing emitted during connect is lost.
#[tauri::command]
pub fn session_attach(app: AppHandle, state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.with_vault(|_| Ok(()))?;
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
    let mut buffered_data: Vec<Vec<u8>> = Vec::new();
    const MAX_BUFFERED_CHUNKS: usize = 256;
    while let Some(event) = events.recv().await {
        let is_unlocked = app.state::<AppState>().is_unlocked();
        if is_unlocked && !buffered_data.is_empty() {
            for chunk in buffered_data.drain(..) {
                let _ = app.emit(&topic(id, "data"), B64.encode(chunk));
            }
        }
        let _ = match event {
            SessionEvent::Data(bytes) => {
                if is_unlocked {
                    app.emit(&topic(id, "data"), B64.encode(bytes))
                } else {
                    if buffered_data.len() < MAX_BUFFERED_CHUNKS {
                        buffered_data.push(bytes);
                    }
                    Ok(())
                }
            }
            SessionEvent::Exit(code) => {
                finished = true;
                app.emit(&topic(id, "exit"), code)
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
    state.with_vault(|_| Ok(()))?;
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
    state.with_vault(|_| Ok(()))?;
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
    state.prompts.clear();
}
