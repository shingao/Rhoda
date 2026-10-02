mod backup;
mod error;
mod settings;
mod snapshots;
mod vault;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(vault::VaultState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ursa");
}
