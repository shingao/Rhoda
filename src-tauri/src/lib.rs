mod assets;
mod backup;
mod preview;
mod error;
mod export;
mod ocr;
mod settings;
mod snapshots;
mod vault;
mod watcher;

use std::time::Duration;

use tauri::Manager;

/// Hidden window printing PDF exports (see `export::pdf`).
const EXPORT_WINDOW: &str = "export-pdf";

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
                .with_denylist(&[EXPORT_WINDOW])
                .build(),
        )
        .manage(vault::VaultState::default())
        .manage(ocr::OcrState::default())
        .manage(export::ExportState::default())
        // Attachments and caches of the open vault, for <img> and pdf.js.
        .register_asynchronous_uri_scheme_protocol("vault", |ctx, request, responder| {
            // Thumbnails can take a moment: never on the main thread.
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(assets::serve(&app, &request)));
        })
        // The page of a PDF export, to the hidden window that prints it.
        .register_uri_scheme_protocol("ursa-export", |ctx, request| export::serve(ctx.app_handle(), &request))
        .setup(|app| {
            #[cfg(windows)]
            if export::smoke(app) {
                return Ok(());
            }
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
            snapshots::write_backup_file,
            snapshots::restore_backup_assets,
            vault::pick_vault_folder,
            assets::import_files,
            assets::import_bytes,
            assets::import_clipboard_image,
            assets::pick_attachments,
            assets::import_stickers,
            assets::pick_stickers,
            assets::list_stickers,
            ocr::ocr_status,
            ocr::ocr_cached,
            ocr::ocr_image,
            ocr::ocr_page,
            ocr::ocr_store,
            ocr::ocr_clear,
            assets::asset_info,
            preview::link_preview,
            preview::download_image,
            assets::pdf_info,
            assets::save_pdf_preview,
            assets::open_attachment,
            export::export_pick_folder,
            export::export_default_folder,
            export::export_folder_ok,
            export::export_write,
            export::export_copy_assets,
            export::export_reveal,
            export::export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ursa");
}
