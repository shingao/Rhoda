mod backup;
mod error;
mod settings;
mod snapshots;
mod vault;
mod watcher;

use std::time::Duration;

use tauri::Manager;

/// If the frontend could not show the window (script error), show it anyway.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // The window is shown by the frontend once themed (no flash): never restore "visible".
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
        .manage(vault::VaultState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(SHOW_FALLBACK);
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::default_vault_path,
            vault::open_vault,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::rename_note,
            vault::delete_note,
            vault::read_internal,
            vault::write_internal,
            settings::load_settings,
            settings::save_settings,
            backup::save_copies,
            snapshots::backup_notes,
            snapshots::restore_backup,
            snapshots::purge_backups,
            snapshots::list_backups,
            snapshots::read_backup,
            snapshots::write_backup_manifest,
            vault::pick_vault_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ursa");
}
