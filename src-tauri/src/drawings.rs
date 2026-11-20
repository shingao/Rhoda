//! Drawings (Excalidraw, decision P12-5): `<vault>/assets/dessins/<id>.excalidraw`
//! holds the scene, `<id>.svg` its picture, the one a note links to. Both are
//! written whole (temporary file, then rename): a drawing is never half saved.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::snapshots::{backups_root, DRAWING_VERSIONS_DIR};
use crate::vault::{atomic_write, current_root, VaultState, ASSETS_DIR};

const DRAWINGS_DIR: &str = "dessins";
/// A scene with pasted images can be large; beyond this it is refused.
const MAX_BYTES: usize = 100 * 1024 * 1024;
/// Previous versions kept per drawing (`.ursa/backups/dessins/<id>/`).
const KEPT_VERSIONS: usize = 5;

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
    // The scene being replaced is kept first (a modified drawing only).
    if let Ok(previous) = fs::read_to_string(&source_path) {
        if previous != source {
            keep_version(root, id, &previous)?;
        }
    }
    fs::create_dir_all(source_path.parent().unwrap_or(root))?;
    // The source first: a picture is never newer than the scene it shows.
    atomic_write(&source_path, source)?;
    atomic_write(&svg_path, svg)?;
    Ok(())
}

fn versions_dir(root: &Path, id: &str) -> PathBuf {
    backups_root(root).join(DRAWING_VERSIONS_DIR).join(id)
}

/// Version names: the save time in milliseconds, zero-padded (they sort by date).
fn valid_version(name: &str) -> bool {
    name.len() == 13 + ".excalidraw".len() && name.ends_with(".excalidraw") && name[..13].bytes().all(|b| b.is_ascii_digit())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn keep_version(root: &Path, id: &str, scene: &str) -> CmdResult<()> {
    let dir = versions_dir(root, id);
    fs::create_dir_all(&dir)?;
    let mut ms = now_ms();
    // Two saves in the same millisecond: the next free name.
    while dir.join(format!("{ms:013}.excalidraw")).exists() {
        ms += 1;
    }
    atomic_write(&dir.join(format!("{ms:013}.excalidraw")), scene)?;
    let mut names = version_names(&dir);
    while names.len() > KEPT_VERSIONS {
        let oldest = names.remove(names.len() - 1);
        fs::remove_file(dir.join(oldest))?;
    }
    Ok(())
}

/// Version file names, newest first.
fn version_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| valid_version(n)).collect())
        .unwrap_or_default();
    names.sort_by(|a, b| b.cmp(a));
    names
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingVersion {
    pub name: String,
    /// When it was replaced (ms since 1970).
    pub saved_at: u64,
    pub bytes: u64,
}

fn versions(root: &Path, id: &str) -> CmdResult<Vec<DrawingVersion>> {
    paths(root, id)?;
    let dir = versions_dir(root, id);
    Ok(version_names(&dir)
        .into_iter()
        .map(|name| {
            let bytes = fs::metadata(dir.join(&name)).map(|m| m.len()).unwrap_or(0);
            DrawingVersion { saved_at: name[..13].parse().unwrap_or(0), name, bytes }
        })
        .collect())
}

fn read_version(root: &Path, id: &str, name: &str) -> CmdResult<String> {
    paths(root, id)?;
    if !valid_version(name) {
        return Err(CmdError::new(ErrorKind::InvalidName, format!("invalid version {name:?}")));
    }
    Ok(fs::read_to_string(versions_dir(root, id).join(name))?)
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

/// Previous versions of a drawing, newest first (at most 5).
#[tauri::command]
pub async fn drawing_versions(state: State<'_, VaultState>, id: String) -> CmdResult<Vec<DrawingVersion>> {
    versions(&current_root(&state)?, &id)
}

#[tauri::command]
pub async fn read_drawing_version(state: State<'_, VaultState>, id: String, name: String) -> CmdResult<String> {
    read_version(&current_root(&state)?, &id, &name)
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
    fn keeps_the_five_previous_versions_of_a_modified_drawing() {
        let v = tempfile::tempdir().unwrap();
        let scene = |n: usize| format!(r#"{{"type":"excalidraw","version":2,"elements":[],"n":{n}}}"#);
        save(v.path(), "a1", &scene(0), SVG).unwrap();
        save(v.path(), "a1", &scene(0), SVG).unwrap();
        assert!(versions(v.path(), "a1").unwrap().is_empty(), "unchanged: nothing kept");
        for n in 1..=7 {
            save(v.path(), "a1", &scene(n), SVG).unwrap();
        }
        let kept = versions(v.path(), "a1").unwrap();
        assert_eq!(kept.len(), 5);
        assert_eq!(read_version(v.path(), "a1", &kept[0].name).unwrap(), scene(6), "newest first: the one replaced last");
        assert_eq!(read_version(v.path(), "a1", &kept[4].name).unwrap(), scene(2));
        assert!(read_version(v.path(), "a1", "../../x").is_err());
        // Not a backup of Settings › Backups, never purged as one.
        assert!(crate::snapshots::list(v.path()).unwrap().is_empty());
        crate::snapshots::purge_before(v.path(), "9999").unwrap();
        assert_eq!(versions(v.path(), "a1").unwrap().len(), 5);
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
