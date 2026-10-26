const COMMANDS: &[&str] = &[
    "vault_exists",
    "vault_create",
    "vault_unlock",
    "vault_lock",
    "vault_info",
    "vault_change_passphrase",
    "vault_backup",
    "vault_backups",
    "vault_restore",
    "vault_delete",
    "settings_get",
    "settings_save",
    "hosts_list",
    "hosts_add",
    "hosts_update",
    "hosts_remove",
    "hosts_export",
    "hosts_import_ssh_config",
    "keys_list",
    "keys_generate",
    "keys_import",
    "keys_remove",
    "layout_list",
    "layout_save",
    "layout_remove",
    "session_open",
    "session_attach",
    "session_write",
    "session_resize",
    "session_close",
    "host_key_confirm",
    "host_key_forget",
    "tmux_sessions",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
