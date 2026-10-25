mod commands;
mod sessions;
mod state;

use tauri::Manager;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState::new(dir.join("vault.tv")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::vault_create,
            commands::vault_unlock,
            commands::vault_lock,
            commands::hosts_list,
            commands::hosts_add,
            commands::hosts_update,
            commands::hosts_remove,
            commands::keys_list,
            commands::keys_generate,
            commands::keys_import,
            commands::layout_list,
            commands::layout_save,
            commands::layout_remove,
            sessions::session_open,
            sessions::session_attach,
            sessions::session_write,
            sessions::session_resize,
            sessions::session_close,
            sessions::host_key_confirm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Terminal Vault");
}
