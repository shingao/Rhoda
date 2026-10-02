//! Safety copies taken before bulk operations (tag rename/removal, wiki-link
//! rewrites, emptying the trash): `.ursa/backups/<date-time>-<operation>/`
//! holds the files as they were, at their vault-relative paths. The frontend
//! can restore them ("Undo" in the toast); copies older than 30 days are purged
//! at startup.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::State;

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{atomic_write, current_root, read_note_file, resolve, unique_note_path, NoteFile, VaultState, INTERNAL_DIR};

const BACKUPS_DIR: &str = "backups";

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
