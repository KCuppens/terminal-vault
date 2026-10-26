use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tvcore::backup::{self, BackupInfo};
use tvcore::{hosts_export_json, keys, sshconfig};
use tvcore::{Host, HostInput, KeyEntry, Layout, Settings, Vault, VaultError};
use uuid::Uuid;

use crate::sessions::close_all;
use crate::state::{err, AppState, CmdResult};

#[derive(Serialize)]
pub struct VaultInfo {
    path: String,
    dir: String,
}

fn path_string(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Everything about a key the frontend may see. Private material never leaves Rust.
#[derive(Serialize)]
pub struct KeyInfo {
    id: Uuid,
    name: String,
    public: String,
    fingerprint: String,
    key_type: String,
}

impl KeyInfo {
    fn new(key: &KeyEntry) -> CmdResult<Self> {
        Ok(Self {
            id: key.id,
            name: key.name.clone(),
            public: key.public_line().to_string(),
            fingerprint: key.fingerprint_sha256().map_err(err)?,
            key_type: key.key_type().map_err(err)?,
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
    let pass = zeroize::Zeroizing::new(passphrase);
    let vault = tauri::async_runtime::spawn_blocking(move || {
        let res = Vault::create(path, &pass);
        drop(pass);
        res
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    state.throttle_success();
    state.install_vault(vault)
}

#[tauri::command]
pub async fn vault_unlock(state: State<'_, AppState>, passphrase: String) -> CmdResult<()> {
    state.throttle_check()?;
    state.try_begin_unlock()?;
    struct UnlockGuard<'a>(&'a AppState);
    impl Drop for UnlockGuard<'_> {
        fn drop(&mut self) {
            self.0.finish_unlock();
        }
    }
    let _guard = UnlockGuard(&state);

    let path = state.vault_path.clone();
    let pass = zeroize::Zeroizing::new(passphrase);
    let opened = tauri::async_runtime::spawn_blocking(move || {
        let res = Vault::open(path, &pass);
        drop(pass);
        res
    })
    .await
    .map_err(err)?;
    match opened {
        Ok(vault) => {
            state.throttle_success();
            state.install_vault(vault)
        }
        Err(e) => {
            if matches!(e, VaultError::WrongPassphrase) {
                state.throttle_failure();
            }
            Err(err(e))
        }
    }
}

#[tauri::command]
pub async fn vault_lock(state: State<'_, AppState>) -> CmdResult<()> {
    drop(state.take_vault());
    // Retain existing background SSH/PTY connections across lock so user work stays active
    Ok(())
}

#[tauri::command]
pub fn vault_info(state: State<'_, AppState>) -> VaultInfo {
    VaultInfo {
        path: path_string(&state.vault_path),
        dir: path_string(state.dir()),
    }
}

#[tauri::command]
pub async fn vault_change_passphrase(
    state: State<'_, AppState>,
    current: String,
    next: String,
) -> CmdResult<()> {
    state.with_vault(|_| Ok(()))?;
    let path = state.vault_path.clone();
    let cur = zeroize::Zeroizing::new(current);
    let nxt = zeroize::Zeroizing::new(next);
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<()> {
        Vault::open(&path, &cur).map_err(err)?;
        drop(cur);
        backup::create_backup(&path).map_err(err)?;
        Ok(())
    })
    .await
    .map_err(err)??;
    let res = state.with_vault(|v| v.change_passphrase(&nxt).map_err(err));
    drop(nxt);
    res
}

#[tauri::command]
pub async fn vault_backup(state: State<'_, AppState>) -> CmdResult<BackupInfo> {
    let path = state.vault_path.clone();
    tauri::async_runtime::spawn_blocking(move || backup::create_backup(&path))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn vault_backups(state: State<'_, AppState>) -> CmdResult<Vec<BackupInfo>> {
    let path = state.vault_path.clone();
    tauri::async_runtime::spawn_blocking(move || backup::list_backups(&path))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn vault_restore(state: State<'_, AppState>, name: String) -> CmdResult<()> {
    drop(state.take_vault());
    close_all(&state).await;
    let path = state.vault_path.clone();
    tauri::async_runtime::spawn_blocking(move || backup::restore_backup(&path, &name))
        .await
        .map_err(err)?
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn vault_delete(state: State<'_, AppState>) -> CmdResult<()> {
    state.with_vault(|_| Ok(()))?;
    drop(state.take_vault());
    close_all(&state).await;
    let path = state.vault_path.clone();
    tauri::async_runtime::spawn_blocking(move || backup::delete_vault(&path))
        .await
        .map_err(err)?
        .map_err(err)?;
    state.throttle_success();
    Ok(())
}

/// A damaged settings file must not lock the user out of the app, so it reads as defaults
/// until the next save replaces it.
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Settings {
    Settings::load(state.settings_path()).unwrap_or_default()
}

#[tauri::command]
pub fn settings_save(state: State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    settings.save(state.settings_path()).map_err(err)?;
    Ok(settings)
}

#[tauri::command]
pub fn hosts_list(state: State<'_, AppState>) -> CmdResult<Vec<Host>> {
    state.with_vault(|v| Ok(v.data().hosts.clone()))
}

#[tauri::command]
pub async fn hosts_add(state: State<'_, AppState>, host: HostInput) -> CmdResult<Host> {
    let host = host.into_host();
    state.mutate(|d| d.add_host(host.clone()))?;
    Ok(host)
}

#[tauri::command]
pub async fn hosts_export(state: State<'_, AppState>) -> CmdResult<String> {
    let hosts = state.with_vault(|v| Ok(v.data().hosts.clone()))?;
    let json = hosts_export_json(&hosts);
    let vault_path = state.vault_path.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        backup::write_export(&vault_path, "hosts", ".json", json.as_bytes())
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    Ok(path_string(&path))
}

#[tauri::command]
pub async fn hosts_import_ssh_config(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Vec<HostInput>> {
    state.with_vault(|_| Ok(()))?;
    let Ok(home) = app.path().home_dir() else {
        return Ok(Vec::new());
    };
    let path = home.join(".ssh").join("config");
    let text = match tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(err)?
    {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(err(e)),
    };
    Ok(sshconfig::parse(
        &text,
        sshconfig::default_user_from_env().as_deref(),
    ))
}

#[tauri::command]
pub async fn hosts_update(state: State<'_, AppState>, host: Host) -> CmdResult<Host> {
    state.mutate(|d| d.update_host(host.clone()))?;
    Ok(host)
}

#[tauri::command]
pub async fn hosts_remove(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.mutate(|d| d.remove_host(id).map(|_| ()))
}

#[tauri::command]
pub fn keys_list(state: State<'_, AppState>) -> CmdResult<Vec<KeyInfo>> {
    state.with_vault(|v| v.data().keys.iter().map(KeyInfo::new).collect())
}

#[tauri::command]
pub async fn keys_generate(
    state: State<'_, AppState>,
    name: String,
    comment: Option<String>,
) -> CmdResult<KeyInfo> {
    let comment = comment.unwrap_or_else(|| name.clone());
    store_key(
        &state,
        keys::generate_ed25519(&name, &comment).map_err(err)?,
    )
}

#[tauri::command]
pub async fn keys_import(
    state: State<'_, AppState>,
    name: String,
    private_key: String,
    passphrase: Option<String>,
) -> CmdResult<KeyInfo> {
    let pkey = zeroize::Zeroizing::new(private_key);
    let pass = passphrase.map(zeroize::Zeroizing::new);
    let imported = keys::import(&name, &pkey, pass.as_deref().map(|s| &**s)).map_err(err);
    drop(pkey);
    drop(pass);
    store_key(&state, imported?)
}

#[tauri::command]
pub async fn keys_remove(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.mutate(|d| d.remove_key(id).map(|_| ()))
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
pub async fn layout_save(state: State<'_, AppState>, layout: Layout) -> CmdResult<Layout> {
    state.mutate(|d| d.save_layout(layout.clone()))?;
    Ok(layout)
}

#[tauri::command]
pub async fn layout_remove(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.mutate(|d| d.remove_layout(id).map(|_| ()))
}
