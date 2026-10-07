//! Exports: files written to a folder the user chose (in the dialog, or the
//! last one, remembered in the settings), never elsewhere and never over an
//! existing file; PDFs printed by WebView2 from a hidden window.

#[cfg(windows)]
mod pdf;
#[cfg(windows)]
mod webview2;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, State};

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{current_root, resolve, VaultState};

/// Extensions an export may write.
const EXTENSIONS: &[&str] = &["md", "html", "pdf", "docx", "png", "jpg"];
/// Sub-folder of the export folder where a Markdown export copies its images and files.
pub const ASSETS_DIR: &str = "assets";

#[derive(Default)]
pub struct ExportState {
    /// Folders picked in the dialog during this session.
    allowed: Mutex<HashSet<PathBuf>>,
    /// Pages being printed, served to the hidden window by `ursa-export:`.
    pages: Mutex<HashMap<String, Vec<u8>>>,
    /// One PDF at a time (a single hidden window).
    #[cfg_attr(not(windows), allow(dead_code))]
    printing: tokio::sync::Mutex<()>,
}

fn canonical(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok().map(crate::vault::dunce)
}

/// The folder remembered in the settings (`export.folder`), read here rather than trusted from the page.
fn remembered(app: &AppHandle) -> Option<PathBuf> {
    let file = app.path().app_config_dir().ok()?.join("settings.json");
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(file).ok()?).ok()?;
    value.pointer("/export/folder")?.as_str().map(PathBuf::from)
}

/// The export folder `dir`, if the user chose it; refused otherwise.
fn allowed_dir(app: &AppHandle, state: &ExportState, dir: &str) -> CmdResult<PathBuf> {
    let dir = canonical(Path::new(dir)).filter(|d| d.is_dir()).ok_or_else(|| CmdError::new(ErrorKind::NotFound, "export folder not found"))?;
    let picked = state.allowed.lock()?.contains(&dir);
    if picked || remembered(app).and_then(|r| canonical(&r)).is_some_and(|r| r == dir) {
        Ok(dir)
    } else {
        Err(CmdError::new(ErrorKind::PermissionDenied, "export folder not chosen by the user"))
    }
}

/// A plain file name with an export extension (the page cleans names; checked again here).
fn valid_name(name: &str) -> bool {
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('.')
        && !name.ends_with(['.', ' '])
        && !name.chars().any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c))
        && ext.is_some_and(|e| EXTENSIONS.contains(&e.as_str()))
}

/// `name` in `dir`, or `name (2)`, `name (3)`… when taken: an export never replaces a file.
fn create_unique(dir: &Path, name: &str) -> CmdResult<(PathBuf, fs::File)> {
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("export");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    for n in 1..1000 {
        let candidate = if n == 1 { dir.join(name) } else { dir.join(format!("{stem} ({n}).{ext}")) };
        match fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(CmdError::new(ErrorKind::AlreadyExists, "too many files with this name"))
}

fn header_value(request: &tauri::ipc::Request<'_>, name: &str) -> CmdResult<String> {
    let raw = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| CmdError::other(format!("missing {name}")))?;
    Ok(percent_decode_str(raw).decode_utf8().map_err(CmdError::other)?.into_owned())
}

fn raw_body(request: &tauri::ipc::Request<'_>) -> CmdResult<Vec<u8>> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err(CmdError::other("expected raw bytes")),
    }
}

/// Export › "Change…": the native folder dialog; the folder may then be written to.
#[tauri::command]
pub async fn export_pick_folder(app: AppHandle, state: State<'_, ExportState>, title: String, current: Option<String>) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(dir) = current.map(PathBuf::from).filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    let Some(picked) = dialog.blocking_pick_folder() else { return Ok(None) };
    let path = picked.into_path().map_err(CmdError::other)?;
    let Some(dir) = canonical(&path) else { return Ok(None) };
    state.allowed.lock()?.insert(dir.clone());
    Ok(Some(dir.to_string_lossy().into_owned()))
}

/// The default export folder: `Documents\Ursa exports` (created on first use, then allowed).
#[tauri::command]
pub async fn export_default_folder(app: AppHandle, state: State<'_, ExportState>, name: String) -> CmdResult<String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(CmdError::new(ErrorKind::InvalidName, "invalid folder name"));
    }
    let docs = app.path().document_dir().or_else(|_| app.path().home_dir().map(|h| h.join("Documents")))?;
    let dir = docs.join(name);
    fs::create_dir_all(&dir)?;
    let dir = canonical(&dir).ok_or_else(|| CmdError::other("export folder not created"))?;
    state.allowed.lock()?.insert(dir.clone());
    Ok(dir.to_string_lossy().into_owned())
}

/// Whether `dir` can be written to without asking again (remembered and still there).
#[tauri::command]
pub async fn export_folder_ok(app: AppHandle, state: State<'_, ExportState>, dir: String) -> CmdResult<bool> {
    Ok(allowed_dir(&app, &state, &dir).is_ok())
}

/// Writes one exported file (raw body; headers `x-ursa-dir`, `x-ursa-name`, URL-encoded). Returns its path.
#[tauri::command]
pub async fn export_write(app: AppHandle, state: State<'_, ExportState>, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let dir = allowed_dir(&app, &state, &header_value(&request, "x-ursa-dir")?)?;
    let name = header_value(&request, "x-ursa-name")?;
    if !valid_name(&name) {
        return Err(CmdError::new(ErrorKind::InvalidName, format!("invalid export name: {name}")));
    }
    let bytes = raw_body(&request)?;
    let (path, mut file) = create_unique(&dir, &name)?;
    if let Err(e) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(e.into());
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Markdown export: copies files of the vault into `<dir>/assets/` (an identical
/// file already there is reused). Returns, for each one, its path relative to `dir`.
#[tauri::command]
pub async fn export_copy_assets(app: AppHandle, state: State<'_, ExportState>, vault: State<'_, VaultState>, dir: String, files: Vec<String>) -> CmdResult<Vec<Option<String>>> {
    let dir = allowed_dir(&app, &state, &dir)?;
    let root = current_root(&vault)?;
    let target = dir.join(ASSETS_DIR);
    let mut out = Vec::with_capacity(files.len());
    for rel in files {
        let Ok(src) = resolve(&root, &rel) else {
            out.push(None);
            continue;
        };
        let Ok(bytes) = fs::read(&src) else {
            out.push(None);
            continue;
        };
        fs::create_dir_all(&target)?;
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
        let stem = Path::new(&name).file_stem().and_then(|s| s.to_str()).unwrap_or("file").to_string();
        let ext = Path::new(&name).extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
        let mut written = None;
        for n in 1..1000 {
            let candidate = if n == 1 { name.clone() } else { format!("{stem} ({n}){ext}") };
            let path = target.join(&candidate);
            if path.exists() {
                if fs::read(&path).is_ok_and(|existing| existing == bytes) {
                    written = Some(candidate);
                    break;
                }
                continue;
            }
            fs::write(&path, &bytes)?;
            written = Some(candidate);
            break;
        }
        out.push(written.map(|n| format!("{ASSETS_DIR}/{n}")));
    }
    Ok(out)
}

/// Shows an exported file in the Explorer.
#[tauri::command]
pub async fn export_reveal(app: AppHandle, state: State<'_, ExportState>, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let file = canonical(Path::new(&path)).ok_or_else(|| CmdError::new(ErrorKind::NotFound, "exported file not found"))?;
    let parent = file.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    allowed_dir(&app, &state, &parent)?;
    app.opener().reveal_item_in_dir(&file).map_err(CmdError::other)
}

/// Paper sizes offered, in inches (A4 = 210 × 297 mm).
fn page_inches(page: &str) -> (f64, f64) {
    match page {
        "letter" => (8.5, 11.0),
        _ => (210.0 / 25.4, 297.0 / 25.4),
    }
}

/// PDF of an export page (raw HTML body; headers `x-ursa-dir`, `x-ursa-name`, `x-ursa-page`).
#[tauri::command]
pub async fn export_pdf(app: AppHandle, state: State<'_, ExportState>, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let dir = allowed_dir(&app, &state, &header_value(&request, "x-ursa-dir")?)?;
    let name = header_value(&request, "x-ursa-name")?;
    if !valid_name(&name) || !name.to_ascii_lowercase().ends_with(".pdf") {
        return Err(CmdError::new(ErrorKind::InvalidName, format!("invalid export name: {name}")));
    }
    let page = page_inches(&header_value(&request, "x-ursa-page").unwrap_or_default());
    let html = raw_body(&request)?;
    // The file is reserved first (unique name), then written by WebView2.
    let (path, file) = create_unique(&dir, &name)?;
    drop(file);
    let result = print(&app, &state, html, &path, page).await;
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result.map(|_| path.to_string_lossy().into_owned())
}

#[cfg(windows)]
async fn print(app: &AppHandle, state: &ExportState, html: Vec<u8>, path: &Path, page: (f64, f64)) -> CmdResult<()> {
    let _one = state.printing.lock().await;
    let id = format!("{:016x}", rand_id());
    state.pages.lock()?.insert(id.clone(), html);
    let result = pdf::print(app, &id, path, page).await;
    state.pages.lock()?.remove(&id);
    result
}

#[cfg(not(windows))]
async fn print(_app: &AppHandle, _state: &ExportState, _html: Vec<u8>, _path: &Path, _page: (f64, f64)) -> CmdResult<()> {
    Err(CmdError::other("PDF export uses WebView2 (Windows only)"))
}

#[cfg(windows)]
fn rand_id() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish()
}

/// `ursa-export:` — the page being printed, to the hidden window only. No scripts, no outside requests.
pub fn serve(app: &AppHandle, request: &tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let page = app.state::<ExportState>().pages.lock().ok().and_then(|p| p.get(id).cloned());
    match page {
        Some(html) => Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header("Content-Security-Policy", "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'")
            .body(html)
            .unwrap_or_default(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap_or_default(),
    }
}

#[cfg(windows)]
static SMOKE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// True while the CI check prints its PDF (closing the main window must not quit the app).
#[cfg(windows)]
pub fn smoke_running() -> bool {
    SMOKE.load(std::sync::atomic::Ordering::SeqCst)
}

/// CI check of the PDF export (`URSA_PDF_SMOKE=<page.html>|<out.pdf>`): prints the page, then quits
/// (exit code 0 when the PDF was written; the reason is written next to it otherwise).
#[cfg(windows)]
pub fn smoke(app: &tauri::App) -> bool {
    let Ok(spec) = std::env::var("URSA_PDF_SMOKE") else { return false };
    let Some((input, output)) = spec.split_once('|').map(|(a, b)| (PathBuf::from(a), PathBuf::from(b))) else { return false };
    SMOKE.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.destroy();
    }
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<ExportState>();
        let result = match fs::read(&input) {
            Ok(html) => print(&handle, &state, html, &output, page_inches("a4")).await,
            Err(e) => Err(e.into()),
        };
        let code = match result {
            Ok(()) => 0,
            Err(e) => {
                let _ = fs::write(output.with_extension("error.txt"), e.message);
                1
            }
        };
        handle.exit(code);
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_plain_files_with_export_extensions() {
        assert!(valid_name("Voyage à Kyoto.pdf"));
        assert!(valid_name("Note (2).md"));
        assert!(!valid_name("../evil.pdf"));
        assert!(!valid_name("a\\b.html"));
        assert!(!valid_name("script.exe"));
        assert!(!valid_name("note.pdf."));
        assert!(!valid_name(".hidden.md"));
        assert!(!valid_name(""));
    }

    #[test]
    fn exports_never_replace_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let (a, _) = create_unique(dir.path(), "Note.md").unwrap();
        let (b, _) = create_unique(dir.path(), "Note.md").unwrap();
        let (c, _) = create_unique(dir.path(), "Note.md").unwrap();
        let names: Vec<_> = [a, b, c].iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["Note.md", "Note (2).md", "Note (3).md"]);
    }

    #[test]
    fn page_sizes() {
        let (w, h) = page_inches("a4");
        assert!((w - 8.27).abs() < 0.01 && (h - 11.69).abs() < 0.01);
        assert_eq!(page_inches("letter"), (8.5, 11.0));
    }
}
