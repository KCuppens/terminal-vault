use serde::{Deserialize, Serialize};
use tauri::State;
use tvcore::keys;
use tvcore::{Host, KeyEntry, Layout, Vault};
use uuid::Uuid;

use crate::sessions::close_all;
use crate::state::{err, AppState, CmdResult};

#[derive(Deserialize)]
pub struct HostInput {
    name: String,
    addr: String,
    port: u16,
    user: String,
    key_id: Option<Uuid>,
    #[serde(default)]
    tags: Vec<String>,
}

/// Everything about a key the frontend may see. Private material never leaves Rust.
#[derive(Serialize)]
pub struct KeyInfo {
    id: Uuid,
    name: String,
    public: String,
    fingerprint: String,
}

impl KeyInfo {
    fn new(key: &KeyEntry) -> CmdResult<Self> {
        Ok(Self {
            id: key.id,
            name: key.name.clone(),
            public: key.public_line().to_string(),
            fingerprint: key.fingerprint_sha256().map_err(err)?,
        })
    }
}

#[tauri::command]
pub fn vault_exists(state: State<'_, AppState>) -> bool {
    Vault::exists(&state.vault_path)
}

#[tauri::command]
pub async fn vault_create(state: State<'_, AppState>, passphrase: String) -> CmdResult<()> {
    let path = state.vault_path.clone();
    let vault = tauri::async_runtime::spawn_blocking(move || Vault::create(path, &passphrase))
        .await
        .map_err(err)?
        .map_err(err)?;
    state.install_vault(vault)
}

#[tauri::command]
pub async fn vault_unlock(state: State<'_, AppState>, passphrase: String) -> CmdResult<()> {
    let path = state.vault_path.clone();
    let vault = tauri::async_runtime::spawn_blocking(move || Vault::open(path, &passphrase))
        .await
        .map_err(err)?
        .map_err(err)?;
    state.install_vault(vault)
}

#[tauri::command]
pub async fn vault_lock(state: State<'_, AppState>) -> CmdResult<()> {
    close_all(&state).await;
    drop(state.take_vault());
    Ok(())
}

#[tauri::command]
pub fn hosts_list(state: State<'_, AppState>) -> CmdResult<Vec<Host>> {
    state.with_vault(|v| Ok(v.data().hosts.clone()))
}

#[tauri::command]
pub fn hosts_add(state: State<'_, AppState>, host: HostInput) -> CmdResult<Host> {
    let host = Host {
        id: Uuid::new_v4(),
        name: host.name,
        addr: host.addr,
        port: host.port,
        user: host.user,
        key_id: host.key_id,
        tags: host.tags,
    };
    state.mutate(|d| d.add_host(host.clone()))?;
    Ok(host)
}

#[tauri::command]
pub fn hosts_update(state: State<'_, AppState>, host: Host) -> CmdResult<Host> {
    state.mutate(|d| d.update_host(host.clone()))?;
    Ok(host)
}

#[tauri::command]
pub fn hosts_remove(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.mutate(|d| d.remove_host(id).map(|_| ()))
}

#[tauri::command]
pub fn keys_list(state: State<'_, AppState>) -> CmdResult<Vec<KeyInfo>> {
    state.with_vault(|v| v.data().keys.iter().map(KeyInfo::new).collect())
}

#[tauri::command]
pub fn keys_generate(state: State<'_, AppState>, name: String) -> CmdResult<KeyInfo> {
    store_key(&state, keys::generate_ed25519(&name).map_err(err)?)
}

#[tauri::command]
pub fn keys_import(
    state: State<'_, AppState>,
    name: String,
    private_key: String,
    passphrase: Option<String>,
) -> CmdResult<KeyInfo> {
    store_key(
        &state,
        keys::import(&name, &private_key, passphrase.as_deref()).map_err(err)?,
    )
}

fn store_key(state: &AppState, key: KeyEntry) -> CmdResult<KeyInfo> {
    let info = KeyInfo::new(&key)?;
    state.mutate(|d| d.add_key(key))?;
    Ok(info)
}

#[tauri::command]
pub fn layout_list(state: State<'_, AppState>) -> CmdResult<Vec<Layout>> {
    state.with_vault(|v| Ok(v.data().layouts.clone()))
}

#[tauri::command]
pub fn layout_save(state: State<'_, AppState>, layout: Layout) -> CmdResult<Layout> {
    state.mutate(|d| d.save_layout(layout.clone()))?;
    Ok(layout)
}

#[tauri::command]
pub fn layout_remove(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.mutate(|d| d.remove_layout(id).map(|_| ()))
}
