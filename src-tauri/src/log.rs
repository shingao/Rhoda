//! Error journal: `%LOCALAPPDATA%\com.bullshit.notes\logs\bullshit.log`, rotated to
//! `bullshit.1.log` … `bullshit.4.log` (5 files at most). Lines come from the frontend
//! (already stripped of note text, see `src/core/logText.ts`) and from Rust
//! panics. Never blocks or fails the app: a journal that cannot be written is
//! simply skipped.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::{CmdError, CmdResult};

/// Seen by the user (Settings › About › log folder): the app's public name.
const FILE: &str = "bullshit";
/// Current file plus 4 older ones.
const KEEP: usize = 5;
const MAX_BYTES: u64 = 512 * 1024;
const MAX_LINE: usize = 2000;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static WRITE: Mutex<()> = Mutex::new(());

/// Remembers the folder and records Rust panics there too.
pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = DIR.set(dir);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        append("error", "rust", &format!("panic{place}: {what}"));
        previous(info);
    }));
}

fn path(dir: &Path, n: usize) -> PathBuf {
    if n == 0 {
        dir.join(format!("{FILE}.log"))
    } else {
        dir.join(format!("{FILE}.{n}.log"))
    }
}

/// `bullshit.log` → `bullshit.1.log` → … ; the oldest beyond `KEEP` is dropped.
fn rotate(dir: &Path) {
    let _ = fs::remove_file(path(dir, KEEP - 1));
    for n in (0..KEEP - 1).rev() {
        let _ = fs::rename(path(dir, n), path(dir, n + 1));
    }
}

/// One line, control characters removed, length capped.
fn clean(text: &str) -> String {
    let mut out: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    if out.len() > MAX_LINE {
        let mut cut = MAX_LINE;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push('…');
    }
    out
}

fn append_in(dir: &Path, level: &str, source: &str, message: &str) -> std::io::Result<()> {
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    fs::create_dir_all(dir)?;
    if fs::metadata(path(dir, 0)).map(|m| m.len() >= MAX_BYTES).unwrap_or(false) {
        rotate(dir);
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path(dir, 0))?;
    writeln!(file, "{} {} [{}] {}", timestamp(), clean(level).to_uppercase(), clean(source), clean(message))
}

fn append(level: &str, source: &str, message: &str) {
    if let Some(dir) = DIR.get() {
        let _ = append_in(dir, level, source, message);
    }
}

/// UTC `YYYY-MM-DDTHH:MM:SSZ` without a date crate.
fn timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format_utc(secs)
}

fn format_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

#[tauri::command]
pub fn log_write(level: String, source: String, message: String) {
    let level = if matches!(level.as_str(), "error" | "warn" | "info") { level } else { "info".into() };
    append(&level, &source, &message);
}

#[tauri::command]
pub fn log_open_folder(app: AppHandle) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = DIR.get().ok_or_else(|| CmdError::other("no log folder"))?;
    fs::create_dir_all(dir)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(CmdError::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_five_files_at_most() {
        let dir = tempfile::tempdir().unwrap();
        let big = "x".repeat(MAX_LINE);
        for _ in 0..(MAX_BYTES as usize / MAX_LINE + 2) * 8 {
            append_in(dir.path(), "error", "test", &big).unwrap();
        }
        let mut names: Vec<String> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["bullshit.1.log", "bullshit.2.log", "bullshit.3.log", "bullshit.4.log", "bullshit.log"]);
        for name in &names {
            assert!(fs::metadata(dir.path().join(name)).unwrap().len() <= MAX_BYTES + MAX_LINE as u64 + 64);
        }
    }

    #[test]
    fn one_line_per_entry() {
        let dir = tempfile::tempdir().unwrap();
        append_in(dir.path(), "warn", "ui", "first\nsecond\r\nthird").unwrap();
        let text = fs::read_to_string(path(dir.path(), 0)).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(text.contains(" WARN [ui] first second  third"));
    }

    #[test]
    fn formats_dates() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_utc(1_791_374_400), "2026-10-07T12:00:00Z");
        assert_eq!(format_utc(951_782_400), "2000-02-29T00:00:00Z");
    }
}
