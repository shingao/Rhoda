//! Vault I/O: everything that touches note files on disk.
//!
//! Paths exchanged with the frontend are always relative to the vault root and
//! use `/` as separator. Every incoming path is validated so a command can never
//! escape the vault.

use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::watcher::{self, VaultWatcher};

const INTERNAL_DIR: &str = ".ursa";
const ASSETS_DIR: &str = "assets";
const SCHEMA_VERSION: &str = "1";
const TMP_SUFFIX: &str = ".ursa-tmp";

#[derive(Default)]
pub struct VaultState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<VaultWatcher>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub path: String,
    pub content: String,
    /// Milliseconds since the Unix epoch.
    pub mtime: f64,
    pub created: f64,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn to_ms(t: io::Result<SystemTime>) -> f64 {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn current_root(state: &State<'_, VaultState>) -> CmdResult<PathBuf> {
    state
        .root
        .lock()
        .map_err(err)?
        .clone()
        .ok_or_else(|| "No vault is open".to_string())
}

/// Joins a frontend-provided relative path to the root, refusing anything that
/// is absolute or contains `..`.
fn resolve(root: &Path, rel: &str) -> CmdResult<PathBuf> {
    let rel = Path::new(rel);
    if rel.components().all(|c| matches!(c, Component::Normal(_))) && rel.components().next().is_some() {
        Ok(root.join(rel))
    } else {
        Err(format!("Invalid note path: {}", rel.display()))
    }
}

/// Relative `/`-separated path of a note, or `None` if `abs` is not a note
/// (wrong extension, hidden or internal folder, assets folder).
pub fn note_rel(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let parts: Vec<&str> = rel
        .components()
        .map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()?;
    let (file, dirs) = parts.split_last()?;
    if parts.iter().any(|p| p.starts_with('.')) || dirs.first() == Some(&ASSETS_DIR) {
        return None;
    }
    let is_md = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"));
    is_md.then(|| parts.join("/"))
}

fn read_note_file(root: &Path, abs: &Path) -> io::Result<NoteFile> {
    let bytes = fs::read(abs)?;
    let mut content = String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    if content.starts_with('\u{feff}') {
        content.remove(0);
    }
    let meta = fs::metadata(abs)?;
    Ok(NoteFile {
        path: note_rel(root, abs).unwrap_or_default(),
        content,
        mtime: to_ms(meta.modified()),
        created: to_ms(meta.created()),
    })
}

fn scan_dir(root: &Path, dir: &Path, out: &mut Vec<NoteFile>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        let hidden = entry.file_name().to_string_lossy().starts_with('.');
        if kind.is_dir() {
            if !hidden && !(dir == root && entry.file_name() == ASSETS_DIR) {
                scan_dir(root, &path, out);
            }
        } else if kind.is_file() && note_rel(root, &path).is_some() {
            match read_note_file(root, &path) {
                Ok(note) => out.push(note),
                Err(e) => eprintln!("[ursa] skipped {}: {e}", path.display()),
            }
        }
    }
}

/// Retries an operation that may transiently fail on Windows because an
/// antivirus or the search indexer briefly holds the file.
fn with_retry<T>(mut op: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut attempt = 0;
    loop {
        match op() {
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied && attempt < 4 => {
                attempt += 1;
                thread::sleep(Duration::from_millis(40 * attempt));
            }
            other => return other,
        }
    }
}

/// Writes through a temporary sibling file then renames it over the target,
/// so a crash never leaves a half-written note.
pub fn atomic_write(path: &Path, content: &str) -> io::Result<()> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
    let tmp = path.with_file_name(format!(".{name}{TMP_SUFFIX}"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    with_retry(|| fs::rename(&tmp, path)).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// `dir/stem.md`, or `dir/stem (2).md`, `(3)`… if taken. `except` is the file
/// being renamed: it never counts as a collision with itself.
fn unique_note_path(dir: &Path, stem: &str, except: Option<&Path>) -> PathBuf {
    (1..)
        .map(|n| match n {
            1 => dir.join(format!("{stem}.md")),
            n => dir.join(format!("{stem} ({n}).md")),
        })
        .find(|p| !p.exists() || except.is_some_and(|e| same_path(p, e)))
        .expect("an unused name always exists")
}

fn validate_stem(stem: &str) -> CmdResult<()> {
    let bad = stem.is_empty()
        || stem.starts_with('.')
        || stem.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control());
    if bad {
        Err(format!("Invalid file name: {stem}"))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn default_vault_path(app: AppHandle) -> CmdResult<String> {
    let docs = app.path().document_dir().map_err(err)?;
    Ok(docs.join("Ursa").to_string_lossy().into_owned())
}

/// Opens (creating it if needed) the vault, returns every note and starts
/// watching the folder for external changes.
#[tauri::command]
pub async fn open_vault(app: AppHandle, state: State<'_, VaultState>, path: String) -> CmdResult<Vec<NoteFile>> {
    let root = PathBuf::from(&path);
    fs::create_dir_all(root.join(INTERNAL_DIR)).map_err(err)?;
    let version = root.join(INTERNAL_DIR).join("version");
    if !version.exists() {
        atomic_write(&version, SCHEMA_VERSION).map_err(err)?;
    }
    let root = fs::canonicalize(&root).map_err(err)?;
    let root = dunce(root);

    let mut notes = Vec::new();
    scan_dir(&root, &root, &mut notes);

    // Drop the previous watcher before starting a new one.
    *state.watcher.lock().map_err(err)? = None;
    let w = watcher::start(app, root.clone()).map_err(err)?;
    *state.watcher.lock().map_err(err)? = Some(w);
    *state.root.lock().map_err(err)? = Some(root);
    Ok(notes)
}

/// `canonicalize` returns `\\?\C:\…` verbatim paths on Windows; strip the
/// prefix so paths stay comparable with the ones `notify` reports.
fn dunce(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest.to_string()),
        _ => p,
    }
}

#[tauri::command]
pub async fn read_note(state: State<'_, VaultState>, path: String) -> CmdResult<Option<NoteFile>> {
    let root = current_root(&state)?;
    let abs = resolve(&root, &path)?;
    match read_note_file(&root, &abs) {
        Ok(note) => Ok(Some(note)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

/// Saves a note and returns its new modification time.
#[tauri::command]
pub async fn write_note(state: State<'_, VaultState>, path: String, content: String) -> CmdResult<f64> {
    let root = current_root(&state)?;
    let abs = resolve(&root, &path)?;
    atomic_write(&abs, &content).map_err(err)?;
    Ok(to_ms(fs::metadata(&abs).and_then(|m| m.modified())))
}

/// Creates a new note at the vault root under a unique name derived from `stem`.
#[tauri::command]
pub async fn create_note(state: State<'_, VaultState>, stem: String, content: String) -> CmdResult<NoteFile> {
    validate_stem(&stem)?;
    let root = current_root(&state)?;
    let abs = unique_note_path(&root, &stem, None);
    atomic_write(&abs, &content).map_err(err)?;
    read_note_file(&root, &abs).map_err(err)
}

/// Renames a note within its folder; returns the new relative path (unchanged
/// if `stem` already matches).
#[tauri::command]
pub async fn rename_note(state: State<'_, VaultState>, from: String, stem: String) -> CmdResult<String> {
    validate_stem(&stem)?;
    let root = current_root(&state)?;
    let src = resolve(&root, &from)?;
    let dir = src.parent().ok_or("Invalid note path")?;
    let dst = unique_note_path(dir, &stem, Some(&src));
    if dst != src {
        with_retry(|| fs::rename(&src, &dst)).map_err(err)?;
    }
    note_rel(&root, &dst).ok_or_else(|| "Renamed note is outside the vault".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_rel_filters_internal_and_assets() {
        let root = Path::new("/v");
        assert_eq!(note_rel(root, Path::new("/v/a.md")).as_deref(), Some("a.md"));
        assert_eq!(note_rel(root, Path::new("/v/sub/B.MD")).as_deref(), Some("sub/B.MD"));
        assert_eq!(note_rel(root, Path::new("/v/.ursa/x.md")), None);
        assert_eq!(note_rel(root, Path::new("/v/assets/x.md")), None);
        assert_eq!(note_rel(root, Path::new("/v/.a.md.ursa-tmp")), None);
        assert_eq!(note_rel(root, Path::new("/v/a.txt")), None);
        assert_eq!(note_rel(root, Path::new("/elsewhere/a.md")), None);
    }

    #[test]
    fn resolve_rejects_escapes() {
        let root = Path::new("/v");
        assert!(resolve(root, "a.md").is_ok());
        assert!(resolve(root, "sub/a.md").is_ok());
        assert!(resolve(root, "../a.md").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "").is_err());
    }

    #[test]
    fn unique_names_and_rename_to_self() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let a = unique_note_path(d, "Note", None);
        assert_eq!(a, d.join("Note.md"));
        atomic_write(&a, "x").unwrap();
        assert_eq!(unique_note_path(d, "Note", None), d.join("Note (2).md"));
        assert_eq!(unique_note_path(d, "Note", Some(&a)), a);
        assert!(!d.join(".Note.md.ursa-tmp").exists());
    }

    #[test]
    fn stems_are_validated() {
        assert!(validate_stem("Hello world").is_ok());
        assert!(validate_stem("a/b").is_err());
        assert!(validate_stem(".hidden").is_err());
        assert!(validate_stem("").is_err());
    }
}
