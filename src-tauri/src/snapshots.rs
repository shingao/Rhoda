//! Safety copies taken before bulk operations (tag rename/removal, wiki-link
//! rewrites, emptying the trash): `.ursa/backups/<date-time>-<operation>/`
//! holds the files as they were, at their vault-relative paths. The frontend
//! can restore them ("Undo" in the toast, or Settings › Backups); copies older
//! than 30 days are purged at startup. `manifest.json`, written by the frontend
//! once the operation is done, says which note each copy belongs to and what
//! the note looked like right after the operation (to detect later edits).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{atomic_write, current_root, read_note_file, resolve, scan_dir, unique_note_path, NoteFile, VaultState, INTERNAL_DIR};

const BACKUPS_DIR: &str = "backups";
const MANIFEST: &str = "manifest.json";

fn backups_root(root: &Path) -> PathBuf {
    root.join(INTERNAL_DIR).join(BACKUPS_DIR)
}

/// Backup names come from the frontend: `2026-10-02_15-04-05-rename-tag`.
fn validate_name(name: &str) -> CmdResult<()> {
    let valid = !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(CmdError::new(ErrorKind::InvalidName, format!("Invalid backup name: {name}")))
    }
}

/// Copies `paths` (relative to the vault) into a new backup folder; returns
/// its final name (suffixed if two operations happen in the same second).
pub(crate) fn backup_files(root: &Path, name: &str, paths: &[String]) -> CmdResult<String> {
    validate_name(name)?;
    let base = backups_root(root);
    fs::create_dir_all(&base)?;
    let (final_name, dir) = (1..)
        .map(|n| if n == 1 { name.to_string() } else { format!("{name}-{n}") })
        .map(|n| (n.clone(), base.join(n)))
        .find(|(_, d)| !d.exists())
        .expect("an unused name always exists");
    fs::create_dir(&dir)?;
    let copy_all = || -> CmdResult<()> {
        for rel in paths {
            let src = resolve(root, rel)?;
            let dst = resolve(&dir, rel)?;
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src, &dst)?;
        }
        Ok(())
    };
    // A partial backup is useless: the operation must not run without it.
    copy_all().inspect_err(|_| {
        let _ = fs::remove_dir_all(&dir);
    })?;
    Ok(final_name)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreItem {
    /// Path of the copy inside the backup (the note's path at backup time).
    pub from: String,
    /// Where to write it back (the note's current path).
    pub to: String,
    /// The note was deleted: recreate it without replacing another file.
    pub create: bool,
}

/// Writes the copies back and returns the restored notes as read from disk.
pub(crate) fn restore_files(root: &Path, name: &str, items: &[RestoreItem]) -> CmdResult<Vec<NoteFile>> {
    validate_name(name)?;
    let dir = backups_root(root).join(name);
    let mut restored = Vec::with_capacity(items.len());
    for item in items {
        let content = fs::read_to_string(resolve(&dir, &item.from)?)?;
        let mut target = resolve(root, &item.to)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        if item.create && target.exists() {
            let stem = target.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            target = unique_note_path(target.parent().unwrap_or(root), &stem, None)?;
        }
        atomic_write(&target, &content)?;
        restored.push(read_note_file(root, &target)?);
    }
    Ok(restored)
}

/// Removes the backups whose name sorts before `before` (names start with a
/// zero-padded local date-time, so the order is chronological).
pub(crate) fn purge_before(root: &Path, before: &str) -> io::Result<usize> {
    let Ok(entries) = fs::read_dir(backups_root(root)) else { return Ok(0) };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() && name.as_str() < before && validate_name(&name).is_ok() {
            fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub name: String,
    /// Number of notes copied.
    pub notes: usize,
}

/// Every backup, newest first.
pub(crate) fn list(root: &Path) -> io::Result<Vec<BackupInfo>> {
    let Ok(entries) = fs::read_dir(backups_root(root)) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type()?.is_dir() || validate_name(&name).is_err() {
            continue;
        }
        let mut files = Vec::new();
        scan_dir(&entry.path(), &entry.path(), &mut files);
        out.push(BackupInfo { name, notes: files.len() });
    }
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct BackupContent {
    /// `manifest.json`, absent for backups made before it existed.
    pub manifest: Option<String>,
    /// The copies, with paths relative to the backup folder (= vault paths at backup time).
    pub files: Vec<NoteFile>,
}

pub(crate) fn read(root: &Path, name: &str) -> CmdResult<BackupContent> {
    validate_name(name)?;
    let dir = backups_root(root).join(name);
    if !dir.is_dir() {
        return Err(CmdError::new(ErrorKind::NotFound, format!("No backup named {name}")));
    }
    let manifest = match fs::read_to_string(dir.join(MANIFEST)) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let mut files = Vec::new();
    scan_dir(&dir, &dir, &mut files);
    Ok(BackupContent { manifest, files })
}

pub(crate) fn write_manifest(root: &Path, name: &str, content: &str) -> CmdResult<()> {
    validate_name(name)?;
    let dir = backups_root(root).join(name);
    if !dir.is_dir() {
        return Err(CmdError::new(ErrorKind::NotFound, format!("No backup named {name}")));
    }
    Ok(atomic_write(&dir.join(MANIFEST), content)?)
}

#[tauri::command]
pub async fn list_backups(state: State<'_, VaultState>) -> CmdResult<Vec<BackupInfo>> {
    Ok(list(&current_root(&state)?)?)
}

#[tauri::command]
pub async fn read_backup(state: State<'_, VaultState>, name: String) -> CmdResult<BackupContent> {
    read(&current_root(&state)?, &name)
}

#[tauri::command]
pub async fn write_backup_manifest(state: State<'_, VaultState>, name: String, content: String) -> CmdResult<()> {
    write_manifest(&current_root(&state)?, &name, &content)
}

#[tauri::command]
pub async fn backup_notes(state: State<'_, VaultState>, name: String, paths: Vec<String>) -> CmdResult<String> {
    backup_files(&current_root(&state)?, &name, &paths)
}

#[tauri::command]
pub async fn restore_backup(state: State<'_, VaultState>, name: String, items: Vec<RestoreItem>) -> CmdResult<Vec<NoteFile>> {
    restore_files(&current_root(&state)?, &name, &items)
}

#[tauri::command]
pub async fn purge_backups(state: State<'_, VaultState>, before: String) -> CmdResult<usize> {
    Ok(purge_before(&current_root(&state)?, &before)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("a.md"), "A1").unwrap();
        fs::write(dir.path().join("sub/b.md"), "B1").unwrap();
        dir
    }

    #[test]
    fn backup_copies_files_at_their_paths() {
        let v = vault();
        let name = backup_files(v.path(), "2026-10-02_15-04-05-rename-tag", &["a.md".into(), "sub/b.md".into()]).unwrap();
        let dir = backups_root(v.path()).join(&name);
        assert_eq!(fs::read_to_string(dir.join("a.md")).unwrap(), "A1");
        assert_eq!(fs::read_to_string(dir.join("sub/b.md")).unwrap(), "B1");
        // Same second, same operation: a distinct folder.
        let again = backup_files(v.path(), "2026-10-02_15-04-05-rename-tag", &["a.md".into()]).unwrap();
        assert_eq!(again, "2026-10-02_15-04-05-rename-tag-2");
    }

    #[test]
    fn backup_rejects_bad_names_and_paths_and_leaves_nothing() {
        let v = vault();
        assert!(backup_files(v.path(), "../x", &["a.md".into()]).is_err());
        assert!(backup_files(v.path(), "ok", &["../a.md".into()]).is_err());
        assert!(backup_files(v.path(), "missing", &["a.md".into(), "nope.md".into()]).is_err());
        assert!(!backups_root(v.path()).join("missing").exists());
    }

    #[test]
    fn restore_overwrites_or_recreates_without_clobbering() {
        let v = vault();
        let name = backup_files(v.path(), "t", &["a.md".into(), "sub/b.md".into()]).unwrap();
        fs::write(v.path().join("a.md"), "A2").unwrap();
        fs::remove_file(v.path().join("sub/b.md")).unwrap();
        let items = vec![
            RestoreItem { from: "a.md".into(), to: "a.md".into(), create: false },
            RestoreItem { from: "sub/b.md".into(), to: "sub/b.md".into(), create: true },
        ];
        let files = restore_files(v.path(), &name, &items).unwrap();
        assert_eq!(fs::read_to_string(v.path().join("a.md")).unwrap(), "A1");
        assert_eq!(files[1].path, "sub/b.md");
        assert_eq!(files[1].content, "B1");

        // The deleted note's name was taken meanwhile: restored next to it.
        fs::write(v.path().join("sub/b.md"), "other").unwrap();
        let files = restore_files(v.path(), &name, &items[1..]).unwrap();
        assert_eq!(files[0].path, "sub/b 2.md");
        assert_eq!(fs::read_to_string(v.path().join("sub/b.md")).unwrap(), "other");
    }

    #[test]
    fn list_and_read_backups_with_their_manifest() {
        let v = vault();
        let old = backup_files(v.path(), "2026-09-01_10-00-00-delete-tag", &["a.md".into()]).unwrap();
        let new = backup_files(v.path(), "2026-10-01_10-00-00-rename-tag", &["a.md".into(), "sub/b.md".into()]).unwrap();
        write_manifest(v.path(), &new, r#"{"version":1}"#).unwrap();
        fs::create_dir_all(backups_root(v.path()).join(".hidden")).unwrap();

        let listed: Vec<(String, usize)> = list(v.path()).unwrap().into_iter().map(|b| (b.name, b.notes)).collect();
        assert_eq!(listed, vec![(new.clone(), 2), (old.clone(), 1)]);

        let content = read(v.path(), &new).unwrap();
        assert_eq!(content.manifest.as_deref(), Some(r#"{"version":1}"#));
        let mut paths: Vec<&str> = content.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, ["a.md", "sub/b.md"]);
        assert!(read(v.path(), &old).unwrap().manifest.is_none());
        assert!(read(v.path(), "missing").is_err());
        assert!(write_manifest(v.path(), "missing", "{}").is_err());
    }

    #[test]
    fn purge_removes_only_older_backups() {
        let v = vault();
        for name in ["2026-08-01_10-00-00-delete-tag", "2026-09-02_15-04-05-rename-tag", "2026-10-01_09-00-00-empty-trash"] {
            backup_files(v.path(), name, &["a.md".into()]).unwrap();
        }
        assert_eq!(purge_before(v.path(), "2026-09-02_15-04-05").unwrap(), 1);
        let left: Vec<String> = fs::read_dir(backups_root(v.path())).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left.len(), 2);
        assert!(!left.iter().any(|n| n.starts_with("2026-08")));
    }
}
