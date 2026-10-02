//! "Save a copy elsewhere": rescue path when notes cannot be written to the
//! vault at shutdown. The destination is chosen in a native dialog opened here,
//! so the frontend never passes an arbitrary path to write to.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::{CmdError, CmdResult};
use crate::vault::{atomic_write, create_in};

#[derive(Debug, Deserialize)]
pub struct NoteCopy {
    /// File name stem, already sanitized by the frontend.
    pub stem: String,
    pub content: String,
}

/// Asks where to save, writes the copies, and returns where they went
/// (`None` if the user cancelled). One note → "Save as" dialog; several → folder picker.
#[tauri::command]
pub async fn save_copies(app: AppHandle, notes: Vec<NoteCopy>, title: String) -> CmdResult<Option<String>> {
    match notes.as_slice() {
        [] => Ok(None),
        [single] => {
            let picked = app
                .dialog()
                .file()
                .set_title(title)
                .set_file_name(format!("{}.md", single.stem))
                .add_filter("Markdown", &["md"])
                .blocking_save_file();
            let Some(path) = picked else { return Ok(None) };
            let path: PathBuf = path.into_path().map_err(CmdError::other)?;
            atomic_write(&path, &single.content)?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        many => {
            let picked = app.dialog().file().set_title(title).blocking_pick_folder();
            let Some(dir) = picked else { return Ok(None) };
            let dir: PathBuf = dir.into_path().map_err(CmdError::other)?;
            for note in many {
                create_in(&dir, &note.stem, &note.content)?;
            }
            Ok(Some(dir.to_string_lossy().into_owned()))
        }
    }
}
