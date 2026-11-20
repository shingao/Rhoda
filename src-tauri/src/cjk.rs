//! Excalidraw's CJK font (Xiaolai), downloaded on demand from Settings ›
//! Drawings (decision P12-11): Chinese, Japanese and Korean text in drawings
//! then looks the same everywhere, embedded in each drawing's picture.
//!
//! - The only files fetched are those of the app's manifest (built from the
//!   installed Excalidraw package): fixed address, fixed names, and each file
//!   kept only if its SHA-256 is the expected one.
//! - Fetched like link previews (`preview::fetch`): public addresses only,
//!   pinned connection, checked redirects, size and time limits.
//! - Stored once for the machine in `%LOCALAPPDATA%\com.bullshit.notes\fonts\Xiaolai\`,
//!   served to the webview by the `vault:` protocol under `_fonts/`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::atomic_write_bytes;

/// Excalidraw's own address for its fonts (its CDN fallback), for the installed
/// version of `@excalidraw/excalidraw` (checked against it by a test).
const BASE: &str = "https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/Xiaolai/";
/// Prefix of the `vault:` protocol paths served from the downloaded fonts.
pub(crate) const SERVE_PREFIX: &str = "_fonts/fonts/Xiaolai/";
const MAX_FILE: usize = 512 * 1024;
const FILE_TIMEOUT: Duration = Duration::from_secs(30);

fn valid_name(name: &str) -> bool {
    name.strip_prefix("Xiaolai-Regular-")
        .and_then(|rest| rest.strip_suffix(".woff2"))
        .is_some_and(|hash| !hash.is_empty() && hash.len() <= 64 && hash.bytes().all(|b| b.is_ascii_alphanumeric()))
}

fn valid_sha(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())
}

pub(crate) fn fonts_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_local_data_dir().map_err(CmdError::other)?.join("fonts").join("Xiaolai"))
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether a file is there with the expected content.
fn present(dir: &Path, name: &str, sha: &str) -> bool {
    valid_name(name) && fs::read(dir.join(name)).is_ok_and(|b| sha256(&b).eq_ignore_ascii_case(sha))
}

/// The path of a downloaded font file to serve, or None.
pub(crate) fn served(app: &AppHandle, rel: &str) -> Option<PathBuf> {
    let name = rel.strip_prefix(SERVE_PREFIX)?;
    if !valid_name(name) {
        return None;
    }
    let path = fonts_dir(app).ok()?.join(name);
    path.is_file().then_some(path)
}

async fn fetch_one(dir: &Path, name: &str, sha: &str) -> CmdResult<()> {
    if !valid_name(name) || !valid_sha(sha) {
        return Err(CmdError::new(ErrorKind::InvalidName, format!("not a font of the manifest: {name}")));
    }
    if present(dir, name, sha) {
        return Ok(());
    }
    let url = Url::parse(BASE).and_then(|b| b.join(name)).map_err(CmdError::other)?;
    let (_, _, body) = tokio::time::timeout(FILE_TIMEOUT, crate::preview::fetch(url, MAX_FILE, "font/woff2", false, FILE_TIMEOUT))
        .await
        .map_err(|_| CmdError::new(ErrorKind::Other, "timeout"))??;
    if !sha256(&body).eq_ignore_ascii_case(sha) {
        return Err(CmdError::new(ErrorKind::Other, format!("{name}: unexpected content")));
    }
    fs::create_dir_all(dir)?;
    atomic_write_bytes(&dir.join(name), &body)?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct FontFile {
    name: String,
    sha256: String,
}

/// How many of the manifest's files are there, intact.
#[tauri::command]
pub async fn cjk_font_present(app: AppHandle, files: Vec<FontFile>) -> CmdResult<usize> {
    let dir = fonts_dir(&app)?;
    Ok(files.iter().filter(|f| present(&dir, &f.name, &f.sha256)).count())
}

/// Downloads one file of the manifest (the app calls it file after file, showing progress).
#[tauri::command]
pub async fn cjk_font_fetch(app: AppHandle, name: String, sha256: String) -> CmdResult<()> {
    fetch_one(&fonts_dir(&app)?, &name, &sha256).await
}

/// Removes the downloaded font.
#[tauri::command]
pub async fn cjk_font_remove(app: AppHandle) -> CmdResult<()> {
    let dir = fonts_dir(&app)?;
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_manifest_s_shape_of_names() {
        assert!(valid_name("Xiaolai-Regular-019d66dcad46dc156b162d267f981c20.woff2"));
        for bad in ["Xiaolai-Regular-.woff2", "Xiaolai-Regular-../x.woff2", "Excalifont-Regular-a.woff2", "Xiaolai-Regular-a.woff2/../../x", "Xiaolai-Regular-a.ttf"] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(valid_sha(&"a".repeat(64)) && !valid_sha("xyz"));
    }

    #[test]
    fn version_matches_the_installed_package() {
        let package: serde_json::Value = serde_json::from_str(&fs::read_to_string("../package.json").unwrap()).unwrap();
        let version = package["dependencies"]["@excalidraw/excalidraw"].as_str().unwrap();
        assert!(BASE.contains(&format!("@{version}/")), "{BASE} vs {version}");
    }

    #[tokio::test]
    async fn refuses_a_file_whose_content_differs() {
        let v = tempfile::tempdir().unwrap();
        // Wrong hash: never written (nothing fetched for a bad name either).
        assert!(fetch_one(v.path(), "../evil.woff2", &"0".repeat(64)).await.is_err());
        assert!(!v.path().join("evil.woff2").exists());
    }

    /// Real download of one file (network): run by the Windows CI.
    #[tokio::test]
    #[ignore]
    async fn downloads_a_real_file_and_checks_it() {
        let v = tempfile::tempdir().unwrap();
        let name = "Xiaolai-Regular-019d66dcad46dc156b162d267f981c20.woff2";
        let local = fs::read(format!("../node_modules/@excalidraw/excalidraw/dist/prod/fonts/Xiaolai/{name}")).expect("package installed");
        let mut last = None;
        for _ in 0..3 {
            match fetch_one(v.path(), name, &sha256(&local)).await {
                Ok(()) => {
                    last = None;
                    break;
                }
                Err(e) => last = Some(e),
            }
        }
        assert!(last.is_none(), "download failed: {last:?}");
        assert_eq!(fs::read(v.path().join(name)).unwrap(), local);
        // A wrong expected hash: refused, nothing kept.
        let w = tempfile::tempdir().unwrap();
        assert!(fetch_one(w.path(), name, &"0".repeat(64)).await.is_err());
        assert!(!w.path().join(name).exists());
    }
}
