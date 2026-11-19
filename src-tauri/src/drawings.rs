//! Drawings (Excalidraw, decision P12-5): `<vault>/assets/dessins/<id>.excalidraw`
//! holds the scene, `<id>.svg` its picture, the one a note links to. Both are
//! written whole (temporary file, then rename): a drawing is never half saved.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{atomic_write, current_root, VaultState, ASSETS_DIR};

const DRAWINGS_DIR: &str = "dessins";
/// A scene with pasted images can be large; beyond this it is refused.
const MAX_BYTES: usize = 100 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn paths(root: &Path, id: &str) -> CmdResult<(PathBuf, PathBuf)> {
    if !valid_id(id) {
        return Err(CmdError::new(ErrorKind::InvalidName, format!("invalid drawing id {id:?}")));
    }
    let dir = root.join(ASSETS_DIR).join(DRAWINGS_DIR);
    Ok((dir.join(format!("{id}.excalidraw")), dir.join(format!("{id}.svg"))))
}

fn read(root: &Path, id: &str) -> CmdResult<Option<String>> {
    let (source, _) = paths(root, id)?;
    match fs::read_to_string(source) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn save(root: &Path, id: &str, source: &str, svg: &str) -> CmdResult<()> {
    let (source_path, svg_path) = paths(root, id)?;
    if source.len() > MAX_BYTES || svg.len() > MAX_BYTES {
        return Err(CmdError::new(ErrorKind::Other, "drawing too large"));
    }
    let scene: serde_json::Value = serde_json::from_str(source).map_err(|_| CmdError::new(ErrorKind::Other, "not an Excalidraw scene"))?;
    if scene.get("type").and_then(|t| t.as_str()) != Some("excalidraw") {
        return Err(CmdError::new(ErrorKind::Other, "not an Excalidraw scene"));
    }
    if !svg.trim_start().starts_with("<svg") {
        return Err(CmdError::new(ErrorKind::Other, "not an SVG picture"));
    }
    fs::create_dir_all(source_path.parent().unwrap_or(root))?;
    // The source first: a picture is never newer than the scene it shows.
    atomic_write(&source_path, source)?;
    atomic_write(&svg_path, svg)?;
    Ok(())
}

/// Copies a drawing under another id (duplicated note); false when it does not exist. Never overwrites.
fn copy(root: &Path, from: &str, to: &str) -> CmdResult<bool> {
    let (from_source, from_svg) = paths(root, from)?;
    let (to_source, to_svg) = paths(root, to)?;
    if !from_source.is_file() || !from_svg.is_file() {
        return Ok(false);
    }
    if to_source.exists() || to_svg.exists() {
        return Err(CmdError::new(ErrorKind::AlreadyExists, format!("drawing {to} exists")));
    }
    atomic_write(&to_source, &fs::read_to_string(from_source)?)?;
    atomic_write(&to_svg, &fs::read_to_string(from_svg)?)?;
    Ok(true)
}

/// The scene of a drawing (JSON), or null if it has none.
#[tauri::command]
pub async fn read_drawing(state: State<'_, VaultState>, id: String) -> CmdResult<Option<String>> {
    read(&current_root(&state)?, &id)
}

#[tauri::command]
pub async fn save_drawing(state: State<'_, VaultState>, id: String, source: String, svg: String) -> CmdResult<()> {
    save(&current_root(&state)?, &id, &source, &svg)
}

#[tauri::command]
pub async fn copy_drawing(state: State<'_, VaultState>, from: String, to: String) -> CmdResult<bool> {
    copy(&current_root(&state)?, &from, &to)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCENE: &str = r#"{"type":"excalidraw","version":2,"elements":[]}"#;
    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>"#;

    #[test]
    fn saves_reads_and_copies() {
        let v = tempfile::tempdir().unwrap();
        assert_eq!(read(v.path(), "a1").unwrap(), None);
        save(v.path(), "a1", SCENE, SVG).unwrap();
        assert_eq!(read(v.path(), "a1").unwrap().as_deref(), Some(SCENE));
        assert_eq!(fs::read_to_string(v.path().join("assets/dessins/a1.svg")).unwrap(), SVG);
        assert!(copy(v.path(), "a1", "b2").unwrap());
        assert_eq!(read(v.path(), "b2").unwrap().as_deref(), Some(SCENE));
        assert!(copy(v.path(), "a1", "b2").is_err(), "never overwrites");
        assert!(!copy(v.path(), "absent", "c3").unwrap());
    }

    #[test]
    fn refuses_bad_ids_and_content() {
        let v = tempfile::tempdir().unwrap();
        assert!(save(v.path(), "../x", SCENE, SVG).is_err());
        assert!(save(v.path(), "a", "{}", SVG).is_err());
        assert!(save(v.path(), "a", SCENE, "<script>").is_err());
        assert!(read(v.path(), "a/b").is_err());
        assert!(!v.path().join("assets").exists());
    }
}
