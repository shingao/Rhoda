//! App-level settings (vault location, layout, preferences), stored outside the
//! vault in the OS config directory. The frontend owns the schema.

use std::fs;

use tauri::{AppHandle, Manager};

use crate::error::CmdResult;
use crate::vault::atomic_write;

const FILE: &str = "settings.json";

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> CmdResult<serde_json::Value> {
    let path = app.path().app_config_dir()?.join(FILE);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null)),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, value: serde_json::Value) -> CmdResult<()> {
    let dir = app.path().app_config_dir()?;
    fs::create_dir_all(&dir)?;
    let text = serde_json::to_string_pretty(&value).map_err(crate::error::CmdError::other)?;
    Ok(atomic_write(&dir.join(FILE), &text)?)
}
