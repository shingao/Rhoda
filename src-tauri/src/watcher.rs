//! File watcher: reports the notes that changed on disk, whoever changed them.
//! The frontend re-reads each path and decides whether it is an external edit.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter};

use crate::vault::note_rel;

pub type VaultWatcher = Debouncer<RecommendedWatcher, RecommendedCache>;

pub const CHANGED_EVENT: &str = "vault://changed";
const DEBOUNCE: Duration = Duration::from_millis(250);

pub fn start(app: AppHandle, root: PathBuf) -> notify_debouncer_full::notify::Result<VaultWatcher> {
    let watched = root.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let paths: BTreeSet<String> = events
            .iter()
            .flat_map(|e| e.paths.iter())
            .filter_map(|p| note_rel(&watched, p))
            .collect();
        if !paths.is_empty() {
            let _ = app.emit(CHANGED_EVENT, paths.into_iter().collect::<Vec<_>>());
        }
    })?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
