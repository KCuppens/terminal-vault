const COMMANDS: &[&str] = &[
    "vault_exists",
    "vault_create",
    "vault_unlock",
    "vault_lock",
    "hosts_list",
    "hosts_add",
    "hosts_update",
    "hosts_remove",
    "keys_list",
    "keys_generate",
    "keys_import",
    "layout_list",
    "layout_save",
    "layout_remove",
    "session_open",
    "session_attach",
    "session_write",
    "session_resize",
    "session_close",
    "host_key_confirm",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
