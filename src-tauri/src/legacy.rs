//! The app was called Ursa (identifier `com.ursa.notes`, notes in
//! `Documents\Ursa`) before version 1.0. Its settings and its notes folder
//! carry over once, never destructively: settings are copied (the old folder
//! stays), the notes folder is renamed only when the new one does not exist,
//! and on any failure the old folder simply keeps being used.

use std::fs;
use std::path::{Path, PathBuf};

/// Identifier of the app (tauri.conf.json), and before it was renamed.
pub const IDENTIFIER: &str = "com.bullshit.notes";
pub const OLD_IDENTIFIER: &str = "com.ursa.notes";
/// Default notes folder (in Documents) before and after the rename.
pub const OLD_VAULT: &str = "Ursa";
pub const VAULT: &str = "Bullshit";

/// Files of the app's config folder worth keeping.
const CONFIG_FILES: [&str; 2] = ["settings.json", ".window-state.json"];

/// The app's config folder (`%APPDATA%\com.bullshit.notes` on Windows), found
/// without Tauri: the old settings must be in place before its plugins start.
pub fn config_dir() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.map(|b| b.join(IDENTIFIER))
}

/// Whether `path` is the old default notes folder (`Documents\Ursa`).
pub fn is_old_default(docs: &Path, path: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(path) == norm(&docs.join(OLD_VAULT))
}

/// Copies the old settings into `config_dir` if it has none yet. Runs before
/// any plugin reads them (window size and position included).
pub fn copy_old_settings(config_dir: &Path) {
    let Some(old_dir) = config_dir.parent().map(|p| p.join(OLD_IDENTIFIER)) else { return };
    if !old_dir.is_dir() || config_dir.join(CONFIG_FILES[0]).exists() {
        return;
    }
    if fs::create_dir_all(config_dir).is_err() {
        return;
    }
    for name in CONFIG_FILES {
        let from = old_dir.join(name);
        if from.is_file() {
            let _ = fs::copy(&from, config_dir.join(name));
        }
    }
}

/// The default notes folder in `docs`: `Bullshit`, after moving an existing
/// `Ursa` folder there. If the move fails (folder in use), `Ursa` stays the
/// notes folder: nothing is lost, the move is tried again next time.
pub fn default_vault(docs: &Path) -> PathBuf {
    let new = docs.join(VAULT);
    let old = docs.join(OLD_VAULT);
    if new.exists() || !old.is_dir() {
        return new;
    }
    match fs::rename(&old, &new) {
        Ok(()) => new,
        Err(e) => {
            eprintln!("[bullshit] cannot move {} to {}: {e}", old.display(), new.display());
            old
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_the_old_notes_folder_once() {
        let docs = tempfile::tempdir().unwrap();
        fs::create_dir_all(docs.path().join("Ursa/.ursa")).unwrap();
        fs::write(docs.path().join("Ursa/Note.md"), "# Note\n").unwrap();
        assert_eq!(default_vault(docs.path()), docs.path().join("Bullshit"));
        assert_eq!(fs::read_to_string(docs.path().join("Bullshit/Note.md")).unwrap(), "# Note\n");
        assert!(docs.path().join("Bullshit/.ursa").is_dir());
        assert!(!docs.path().join("Ursa").exists());
        // Next start: nothing to move.
        assert_eq!(default_vault(docs.path()), docs.path().join("Bullshit"));
    }

    #[test]
    fn never_merges_into_an_existing_folder() {
        let docs = tempfile::tempdir().unwrap();
        fs::create_dir_all(docs.path().join("Ursa")).unwrap();
        fs::write(docs.path().join("Ursa/Old.md"), "old").unwrap();
        fs::create_dir_all(docs.path().join("Bullshit")).unwrap();
        assert_eq!(default_vault(docs.path()), docs.path().join("Bullshit"));
        assert!(docs.path().join("Ursa/Old.md").exists());
    }

    #[test]
    fn identifier_matches_the_config() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
    }

    #[test]
    fn recognizes_the_old_default_folder() {
        let docs = Path::new("C:/Users/Ana/Documents");
        assert!(is_old_default(docs, Path::new("c:\\users\\ana\\documents\\ursa\\")));
        assert!(!is_old_default(docs, Path::new("C:/Users/Ana/Documents/Ursa notes")));
    }

    #[test]
    fn no_old_folder_no_move() {
        let docs = tempfile::tempdir().unwrap();
        assert_eq!(default_vault(docs.path()), docs.path().join("Bullshit"));
        assert!(!docs.path().join("Bullshit").exists());
    }

    #[test]
    fn copies_old_settings_without_replacing_new_ones() {
        let base = tempfile::tempdir().unwrap();
        let old = base.path().join(OLD_IDENTIFIER);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), r#"{"language":"fr"}"#).unwrap();
        fs::write(old.join(".window-state.json"), "{}").unwrap();
        let new = base.path().join("com.bullshit.notes");
        copy_old_settings(&new);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"language":"fr"}"#);
        assert!(new.join(".window-state.json").exists());
        assert!(old.join("settings.json").exists(), "the old folder stays");
        // Settings saved since are never replaced.
        fs::write(new.join("settings.json"), r#"{"language":"en"}"#).unwrap();
        copy_old_settings(&new);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"language":"en"}"#);
    }
}
