//! Vault I/O: everything that touches note files on disk.
//!
//! Paths exchanged with the frontend are always relative to the vault root and
//! use `/` as separator. Every incoming path is validated so a command can never
//! escape the vault.

use std::collections::HashSet;
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
const NOTE_EXT: &str = ".md";
/// Windows MAX_PATH (260) minus the terminating NUL, in UTF-16 code units.
const MAX_PATH_UNITS: usize = 259;
/// Room kept for a collision suffix such as " 999".
const SUFFIX_RESERVE: usize = 4;

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

/// Errors worth retrying: on Windows an antivirus, the search indexer or a sync
/// client may briefly hold the file (access denied / sharing violation).
fn is_transient(e: &io::Error) -> bool {
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    matches!(e.kind(), io::ErrorKind::PermissionDenied | io::ErrorKind::ResourceBusy)
        || (cfg!(windows) && matches!(e.raw_os_error(), Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION)))
}

fn with_retry<T>(mut op: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut attempt = 0;
    loop {
        match op() {
            Err(e) if is_transient(&e) && attempt < 4 => {
                attempt += 1;
                thread::sleep(Duration::from_millis(40 * attempt));
            }
            other => return other,
        }
    }
}

fn tmp_path_for(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
    path.with_file_name(format!(".{name}{TMP_SUFFIX}"))
}

fn write_synced(path: &Path, content: &str) -> io::Result<()> {
    let mut f = fs::File::create(path)?;
    f.write_all(content.as_bytes())?;
    f.sync_all()
}

/// Writes through a temporary sibling file then renames it over the target,
/// so a crash never leaves a half-written note.
pub fn atomic_write(path: &Path, content: &str) -> io::Result<()> {
    let tmp = tmp_path_for(path);
    write_synced(&tmp, content)?;
    with_retry(|| fs::rename(&tmp, path)).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// Moves `src` to `dst` without ever replacing an existing file (a plain
/// `rename` silently overwrites on Windows). A case-only change of the same
/// file is a regular rename.
fn move_no_clobber(src: &Path, dst: &Path) -> io::Result<()> {
    let same_file = src.parent() == dst.parent()
        && eq_ignore_case(&src.file_name().unwrap_or_default().to_string_lossy(), &dst.file_name().unwrap_or_default().to_string_lossy());
    if same_file {
        return with_retry(|| fs::rename(src, dst));
    }
    match fs::hard_link(src, dst) {
        Ok(()) => with_retry(|| fs::remove_file(src)).inspect_err(|_| {
            // The source is locked: undo, the caller keeps the old name.
            let _ = fs::remove_file(dst);
        }),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(e),
        // File systems without hard links (FAT, some network shares).
        Err(_) if dst.exists() => Err(io::ErrorKind::AlreadyExists.into()),
        Err(_) => with_retry(|| fs::rename(src, dst)),
    }
}

/// Windows device names, reserved even with an extension (`CON.txt`).
fn is_reserved_name(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or("").trim_end().to_lowercase();
    matches!(base.as_str(), "con" | "prn" | "aux" | "nul" | "conin$" | "conout$")
        || ((base.starts_with("com") || base.starts_with("lpt"))
            && base.chars().count() == 4
            && base.chars().last().is_some_and(|c| c.is_ascii_digit() || matches!(c, '¹' | '²' | '³')))
}

/// Defensive check: the frontend sanitizes titles, the backend refuses anything
/// that would still be an invalid Windows file name.
fn validate_stem(stem: &str) -> CmdResult<()> {
    let bad = stem.is_empty()
        || stem.starts_with('.')
        || stem.ends_with(['.', ' '])
        || stem.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control())
        || is_reserved_name(stem);
    if bad {
        Err(format!("Invalid file name: {stem}"))
    } else {
        Ok(())
    }
}

/// Shortens `stem` so that `dir\stem 999.md` stays within MAX_PATH.
fn fit_stem(dir: &Path, stem: &str) -> CmdResult<String> {
    let dir_units = dir.to_string_lossy().encode_utf16().count();
    let budget = MAX_PATH_UNITS.saturating_sub(dir_units + 1 + SUFFIX_RESERVE + NOTE_EXT.len());
    let mut fitted = String::new();
    let mut used = 0;
    for c in stem.chars() {
        used += c.len_utf16();
        if used > budget {
            break;
        }
        fitted.push(c);
    }
    let fitted = fitted.trim_end_matches(['.', ' ']);
    if fitted.is_empty() {
        Err("The notes folder path is too long for a file name".into())
    } else {
        Ok(fitted.to_string())
    }
}

/// First free name among `stem.md`, `stem 2.md`, `stem 3.md`… compared without
/// case, like NTFS. `current` is the note being renamed: if it already holds a
/// candidate name (exactly or up to case) it keeps it rather than moving.
fn unique_note_path(dir: &Path, stem: &str, current: Option<&Path>) -> io::Result<PathBuf> {
    let taken: HashSet<String> = fs::read_dir(dir)?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_lowercase())
        .collect();
    let current_name = current.and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned());
    for n in 1.. {
        let name = match n {
            1 => format!("{stem}{NOTE_EXT}"),
            n => format!("{stem} {n}{NOTE_EXT}"),
        };
        let is_current = current_name.as_deref().is_some_and(|c| eq_ignore_case(c, &name));
        if is_current || !taken.contains(&name.to_lowercase()) {
            return Ok(dir.join(name));
        }
    }
    unreachable!("an unused name always exists")
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
    let root = dunce(fs::canonicalize(&root).map_err(err)?);

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

fn create_in(dir: &Path, stem: &str, content: &str) -> CmdResult<PathBuf> {
    validate_stem(stem)?;
    let stem = fit_stem(dir, stem)?;
    let dst = unique_note_path(dir, &stem, None).map_err(err)?;
    let tmp = tmp_path_for(&dst);
    write_synced(&tmp, content).map_err(err)?;
    move_no_clobber(&tmp, &dst).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(e)
    })?;
    Ok(dst)
}

/// Creates a new note at the vault root under a unique name derived from `stem`.
#[tauri::command]
pub async fn create_note(state: State<'_, VaultState>, stem: String, content: String) -> CmdResult<NoteFile> {
    let root = current_root(&state)?;
    let abs = create_in(&root, &stem, &content)?;
    read_note_file(&root, &abs).map_err(err)
}

fn rename_in_place(src: &Path, stem: &str) -> CmdResult<PathBuf> {
    validate_stem(stem)?;
    let dir = src.parent().ok_or("Invalid note path")?;
    let stem = fit_stem(dir, stem)?;
    let dst = unique_note_path(dir, &stem, Some(src)).map_err(err)?;
    if dst.file_name() != src.file_name() {
        move_no_clobber(src, &dst).map_err(err)?;
    }
    Ok(dst)
}

/// Renames a note within its folder; returns the new relative path (unchanged
/// if it already carries the right name). On failure the note keeps its name.
#[tauri::command]
pub async fn rename_note(state: State<'_, VaultState>, from: String, stem: String) -> CmdResult<String> {
    let root = current_root(&state)?;
    let src = resolve(&root, &from)?;
    let dst = rename_in_place(&src, &stem)?;
    note_rel(&root, &dst).ok_or_else(|| "Renamed note is outside the vault".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, name).unwrap();
        p
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

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
    fn stems_are_validated() {
        assert!(validate_stem("Hello world").is_ok());
        assert!(validate_stem("Console").is_ok());
        assert!(validate_stem("COM10").is_ok());
        for bad in ["", "a/b", "a\\b", "a:b", "a*", "a?", "a|b", "a\"b", "a<b>", ".hidden", "trailing.", "trailing ", "tab\there"] {
            assert!(validate_stem(bad).is_err(), "{bad:?} should be rejected");
        }
        for reserved in ["CON", "con", "Nul", "PRN", "AUX", "COM1", "lpt9", "COM¹", "CON.txt", "aux .notes", "CONIN$"] {
            assert!(validate_stem(reserved).is_err(), "{reserved:?} is reserved");
        }
    }

    #[test]
    fn stems_fit_within_max_path() {
        let short = Path::new("C:/Users/me/Documents/Ursa");
        assert_eq!(fit_stem(short, "Short title").unwrap(), "Short title");

        let deep = PathBuf::from(format!("C:/{}", "d".repeat(200)));
        let fitted = fit_stem(&deep, &"x".repeat(120)).unwrap();
        let full = format!("{}/{} 999.md", deep.display(), fitted);
        assert!(full.encode_utf16().count() <= MAX_PATH_UNITS, "{} units", full.encode_utf16().count());
        assert!(fitted.len() < 120);

        // Never splits a character, never ends with a dot or space.
        let fitted = fit_stem(&deep, &format!("{}. 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀", "y".repeat(40))).unwrap();
        assert!(!fitted.ends_with(['.', ' ']));
        assert!(fit_stem(&PathBuf::from(format!("C:/{}", "d".repeat(260))), "x").is_err());
    }

    #[test]
    fn collisions_ignore_case_and_use_numeric_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        assert_eq!(unique_note_path(d, "Note", None).unwrap(), d.join("Note.md"));
        touch(d, "note.md");
        assert_eq!(unique_note_path(d, "Note", None).unwrap(), d.join("Note 2.md"));
        touch(d, "NOTE 2.md");
        assert_eq!(unique_note_path(d, "Note", None).unwrap(), d.join("Note 3.md"));
    }

    #[test]
    fn create_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        touch(d, "Idea.md");
        let created = create_in(d, "idea", "new").unwrap();
        assert_eq!(created, d.join("idea 2.md"));
        assert_eq!(fs::read_to_string(d.join("Idea.md")).unwrap(), "Idea.md");
        assert_eq!(names(d), ["Idea.md", "idea 2.md"]);
    }

    #[test]
    fn rename_rules() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let other = touch(d, "Plan.md");
        let src = touch(d, "Untitled.md");

        // Collision with another note (case-insensitive) → suffix.
        let renamed = rename_in_place(&src, "plan").unwrap();
        assert_eq!(renamed, d.join("plan 2.md"));
        assert_eq!(fs::read_to_string(&other).unwrap(), "Plan.md", "other note untouched");

        // Already carrying the right name (with suffix) → no move.
        assert_eq!(rename_in_place(&renamed, "plan").unwrap(), renamed);

        // Case-only change of the same file is allowed.
        let upper = rename_in_place(&renamed, "Plan 2").unwrap();
        assert_eq!(upper, d.join("Plan 2.md"));
        assert_eq!(names(d), ["Plan 2.md", "Plan.md"]);

        // Sanitization leftovers are refused, the file keeps its name.
        assert!(rename_in_place(&upper, "CON").is_err());
        assert!(upper.exists());
    }

    #[test]
    fn move_no_clobber_refuses_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let a = touch(d, "a.md");
        let b = touch(d, "b.md");
        assert!(move_no_clobber(&a, &b).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "b.md");
        assert!(a.exists());
        move_no_clobber(&a, &d.join("c.md")).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(d.join("c.md")).unwrap(), "a.md");
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("n.md");
        atomic_write(&p, "one").unwrap();
        atomic_write(&p, "two").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(names(dir.path()), ["n.md"]);
    }
}
