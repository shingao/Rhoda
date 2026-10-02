mod backup;
mod error;
mod settings;
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
            settings::load_settings,
            settings::save_settings,
            backup::save_copies,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ursa");
}
