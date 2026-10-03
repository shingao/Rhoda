//! Attachments: images and PDFs copied into `<vault>/assets/`, and the `vault:`
//! protocol that serves them (and `.ursa/` caches) to the webview.
//!
//! - Formats are recognised from the file's bytes, not its name. HEIC/HEIF is
//!   refused with a clear reason (WebView2 cannot display it).
//! - The same image added twice (same SHA-256) reuses the existing file.
//! - Names are clean and unique: `capture-d-ecran-2026-10-03.png`, then `-2`…

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, State};

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{current_root, resolve, root_of, VaultState, ASSETS_DIR, INTERNAL_DIR};

/// Larger files are refused (a 20 MB photo is fine).
const MAX_BYTES: u64 = 200 * 1024 * 1024;
/// Longest file stem written by Ursa (before a collision suffix).
const MAX_STEM: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Png,
    Jpeg,
    Gif,
    Webp,
    Svg,
    Pdf,
}

impl Format {
    fn ext(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpg",
            Format::Gif => "gif",
            Format::Webp => "webp",
            Format::Svg => "svg",
            Format::Pdf => "pdf",
        }
    }
}

/// Why a file was not imported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Refusal {
    Heic,
    Unsupported,
    TooLarge,
}

pub(crate) enum Detected {
    Ok(Format),
    Refused(Refusal),
}

/// Recognises the format from the first bytes.
pub(crate) fn detect(head: &[u8]) -> Detected {
    let starts = |sig: &[u8]| head.starts_with(sig);
    if starts(b"\x89PNG\r\n\x1a\n") {
        return Detected::Ok(Format::Png);
    }
    if starts(&[0xFF, 0xD8, 0xFF]) {
        return Detected::Ok(Format::Jpeg);
    }
    if starts(b"GIF87a") || starts(b"GIF89a") {
        return Detected::Ok(Format::Gif);
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Detected::Ok(Format::Webp);
    }
    if starts(b"%PDF-") {
        return Detected::Ok(Format::Pdf);
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        let brand = &head[8..12];
        if [b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"heif"].iter().any(|b| brand == *b) {
            return Detected::Refused(Refusal::Heic);
        }
    }
    let text = String::from_utf8_lossy(&head[..head.len().min(2048)]).to_ascii_lowercase();
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if (text.starts_with("<?xml") || text.starts_with("<svg") || text.starts_with("<!--") || text.starts_with("<!doctype svg")) && text.contains("<svg") {
        return Detected::Ok(Format::Svg);
    }
    Detected::Refused(Refusal::Unsupported)
}

/// Pixel size of an image; SVG from its width/height or viewBox; PDF has none.
pub(crate) fn dimensions(format: Format, bytes: &[u8]) -> Option<(u32, u32)> {
    match format {
        Format::Pdf => None,
        Format::Svg => svg_size(&String::from_utf8_lossy(bytes)),
        _ => imagesize::blob_size(bytes).ok().map(|s| (s.width as u32, s.height as u32)),
    }
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let at = tag.find(&format!(" {name}="))? + name.len() + 2;
    let quote = tag[at..].chars().next()?;
    let rest = &tag[at + 1..];
    Some(&rest[..rest.find(quote)?])
}

fn svg_size(text: &str) -> Option<(u32, u32)> {
    let start = text.find("<svg")?;
    let tag = &text[start..start + text[start..].find('>')?];
    let number = |v: &str| v.trim().trim_end_matches("px").parse::<f64>().ok().filter(|n| *n > 0.0);
    if let (Some(w), Some(h)) = (attr(tag, "width").and_then(number), attr(tag, "height").and_then(number)) {
        return Some((w.round() as u32, h.round() as u32));
    }
    let vb: Vec<f64> = attr(tag, "viewBox")?.split([' ', ',']).filter_map(|n| n.trim().parse().ok()).collect();
    (vb.len() == 4 && vb[2] > 0.0 && vb[3] > 0.0).then(|| (vb[2].round() as u32, vb[3].round() as u32))
}

/// Clean file stem: lowercase ASCII, accents folded, other characters → `-`.
pub(crate) fn slug(stem: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in stem.chars().flat_map(char::to_lowercase) {
        let folded = match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => "a",
            'ç' => "c",
            'è' | 'é' | 'ê' | 'ë' => "e",
            'ì' | 'í' | 'î' | 'ï' => "i",
            'ñ' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => "o",
            'ù' | 'ú' | 'û' | 'ü' => "u",
            'ý' | 'ÿ' => "y",
            'œ' => "oe",
            'æ' => "ae",
            'ß' => "ss",
            c if c.is_ascii_alphanumeric() => {
                out.push(c);
                continue;
            }
            _ => "-",
        };
        out.push_str(folded);
    }
    let mut clean = String::new();
    for part in out.split('-').filter(|p| !p.is_empty()) {
        if clean.len() + part.len() + 1 > MAX_STEM {
            break;
        }
        if !clean.is_empty() {
            clean.push('-');
        }
        clean.push_str(part);
    }
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// A file of `assets/` with the same content, if any (same size first, then hash).
fn find_same(dir: &Path, bytes: &[u8]) -> Option<PathBuf> {
    let hash = sha256(bytes);
    fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
        let path = entry.path();
        let meta = entry.metadata().ok()?;
        (meta.is_file() && meta.len() == bytes.len() as u64 && fs::read(&path).ok().map(|b| sha256(&b)) == Some(hash)).then_some(path)
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum Imported {
    /// Copied (or reused): `path` is vault-relative, `/`-separated.
    Ok {
        path: String,
        format: Format,
        width: Option<u32>,
        height: Option<u32>,
        reused: bool,
    },
    Refused {
        name: String,
        reason: Refusal,
    },
}

/// Writes `bytes` into `assets/` (or finds the identical file already there).
pub(crate) fn import(root: &Path, name: &str, bytes: &[u8]) -> CmdResult<Imported> {
    let refused = |reason| Ok(Imported::Refused { name: name.to_string(), reason });
    if bytes.len() as u64 > MAX_BYTES {
        return refused(Refusal::TooLarge);
    }
    let format = match detect(&bytes[..bytes.len().min(4096)]) {
        Detected::Ok(f) => f,
        Detected::Refused(r) => return refused(r),
    };
    let (width, height) = dimensions(format, bytes).map_or((None, None), |(w, h)| (Some(w), Some(h)));
    let dir = root.join(ASSETS_DIR);
    fs::create_dir_all(&dir)?;
    let rel = |p: &Path| format!("{ASSETS_DIR}/{}", p.file_name().unwrap_or_default().to_string_lossy());
    if let Some(existing) = find_same(&dir, bytes) {
        return Ok(Imported::Ok { path: rel(&existing), format, width, height, reused: true });
    }
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = slug(&stem, if format == Format::Pdf { "document" } else { "image" });
    let target = (1..)
        .map(|n| if n == 1 { format!("{stem}.{}", format.ext()) } else { format!("{stem}-{n}.{}", format.ext()) })
        .map(|file| dir.join(file))
        .find(|p| !p.exists())
        .expect("an unused name always exists");
    crate::vault::atomic_write_bytes(&target, bytes)?;
    Ok(Imported::Ok { path: rel(&target), format, width, height, reused: false })
}

fn read_limited(path: &Path) -> io::Result<Vec<u8>> {
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Files dropped on the window or chosen in the dialog (absolute paths).
#[tauri::command]
pub async fn import_files(state: State<'_, VaultState>, paths: Vec<String>) -> CmdResult<Vec<Imported>> {
    let root = current_root(&state)?;
    paths
        .iter()
        .map(|p| {
            let path = Path::new(p);
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            import(&root, &name, &read_limited(path)?)
        })
        .collect()
}

/// Pasted image (clipboard): raw bytes in the body, the suggested name in `x-ursa-name` (URI-encoded).
#[tauri::command]
pub async fn import_bytes(state: State<'_, VaultState>, request: tauri::ipc::Request<'_>) -> CmdResult<Imported> {
    let root = current_root(&state)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new(ErrorKind::Other, "expected raw bytes"));
    };
    let name = request
        .headers()
        .get("x-ursa-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    import(&root, &name, bytes)
}

/// Image in the system clipboard (a Win+Shift+S capture…), when the paste event
/// itself carried no file. Encoded as PNG and imported; `None` if there is none.
#[tauri::command]
pub async fn import_clipboard_image(state: State<'_, VaultState>, name: String) -> CmdResult<Option<Imported>> {
    let root = current_root(&state)?;
    let image = match arboard::Clipboard::new().and_then(|mut c| c.get_image()) {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let Some(rgba) = image::RgbaImage::from_raw(image.width as u32, image.height as u32, image.bytes.into_owned()) else {
        return Ok(None);
    };
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(CmdError::other)?;
    import(&root, &name, &png).map(Some)
}

/// Native picker for "Insert image or PDF…"; absolute paths, empty if cancelled.
#[tauri::command]
pub async fn pick_attachments(app: AppHandle, title: String) -> CmdResult<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter("Images, PDF", &["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "heic", "heif"])
        .blocking_pick_files()
        .unwrap_or_default();
    Ok(picked.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect())
}

#[derive(Debug, Serialize)]
pub struct AssetInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: u64,
}

/// Size of attachments already referenced by notes (vault-relative), for stable layout before they load.
#[tauri::command]
pub async fn asset_info(state: State<'_, VaultState>, paths: Vec<String>) -> CmdResult<Vec<Option<AssetInfo>>> {
    let root = current_root(&state)?;
    Ok(paths
        .iter()
        .map(|rel| {
            let path = resolve(&root, rel).ok()?;
            let bytes = fs::metadata(&path).ok()?.len();
            let mut head = vec![0u8; 64 * 1024];
            let n = fs::File::open(&path).ok()?.read(&mut head).ok()?;
            head.truncate(n);
            let dims = match detect(&head) {
                Detected::Ok(Format::Svg) => fs::read(&path).ok().and_then(|b| dimensions(Format::Svg, &b)),
                Detected::Ok(f) => dimensions(f, &head).or_else(|| imagesize::size(&path).ok().map(|s| (s.width as u32, s.height as u32))),
                Detected::Refused(_) => None,
            };
            Some(AssetInfo { width: dims.map(|d| d.0), height: dims.map(|d| d.1), bytes })
        })
        .collect())
}

pub(crate) fn percent_decode(s: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Paths the protocol may serve: attachments and notes' files, plus the
/// thumbnail and preview caches; never settings or other internal files.
fn servable(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or_default();
    if first == INTERNAL_DIR {
        return rel.starts_with(".ursa/thumbs/") || rel.starts_with(".ursa/previews/");
    }
    !rel.split('/').any(|part| part.starts_with('.'))
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// `vault://localhost/<path>` (`http://vault.localhost/<path>` on Windows).
pub fn serve(app: &AppHandle, request: &tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).expect("valid response");
    let Some(root) = root_of(&app.state::<VaultState>()) else { return not_found() };
    let rel = percent_decode(request.uri().path().trim_start_matches('/'));
    if !servable(&rel) {
        return not_found();
    }
    let Ok(path) = resolve(&root, &rel) else { return not_found() };
    let Ok(bytes) = fs::read(&path) else { return not_found() };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type(&path))
        .header("X-Content-Type-Options", "nosniff")
        // The crop dialog draws images on a canvas: readable pixels need CORS (local files only).
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // Defence in depth: SVG is only ever shown through <img>, where scripts never run.
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(bytes)
        .expect("valid response")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0, 0x9D, 0x2B, 0x6E, 0x50,
    ];

    #[test]
    fn detects_formats_from_bytes() {
        assert!(matches!(detect(PNG_1X1), Detected::Ok(Format::Png)));
        assert!(matches!(detect(&[0xFF, 0xD8, 0xFF, 0xE0]), Detected::Ok(Format::Jpeg)));
        assert!(matches!(detect(b"GIF89a...."), Detected::Ok(Format::Gif)));
        assert!(matches!(detect(b"RIFF\0\0\0\0WEBPVP8 "), Detected::Ok(Format::Webp)));
        assert!(matches!(detect(b"%PDF-1.7"), Detected::Ok(Format::Pdf)));
        assert!(matches!(detect(b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\">"), Detected::Ok(Format::Svg)));
        assert!(matches!(detect(b"\0\0\0\x18ftypheic\0\0\0\0"), Detected::Refused(Refusal::Heic)));
        assert!(matches!(detect(b"<html><script>"), Detected::Refused(Refusal::Unsupported)));
        assert!(matches!(detect(b"MZ\x90\0"), Detected::Refused(Refusal::Unsupported)));
    }

    #[test]
    fn reads_dimensions() {
        assert_eq!(dimensions(Format::Png, PNG_1X1), Some((3, 2)));
        assert_eq!(dimensions(Format::Svg, br#"<svg width="120" height="80px">"#), Some((120, 80)));
        assert_eq!(dimensions(Format::Svg, br#"<svg viewBox="0 0 640 360">"#), Some((640, 360)));
    }

    #[test]
    fn slugs_names() {
        assert_eq!(slug("Capture d’écran 2026-10-03 à 14.32.00", "image"), "capture-d-ecran-2026-10-03-a-14-32-00");
        assert_eq!(slug("Œuvre ÉTÉ", "image"), "oeuvre-ete");
        assert_eq!(slug("???", "image"), "image");
        assert!(slug(&"long ".repeat(40), "image").len() <= MAX_STEM);
    }

    #[test]
    fn imports_with_clean_unique_names_and_reuses_identical_files() {
        let v = tempfile::tempdir().unwrap();
        let first = import(v.path(), "Photo été.png", PNG_1X1).unwrap();
        assert!(matches!(&first, Imported::Ok { path, reused: false, width: Some(3), .. } if path == "assets/photo-ete.png"));
        // Same bytes: the existing file is reused, whatever the name.
        let again = import(v.path(), "autre.png", PNG_1X1).unwrap();
        assert!(matches!(&again, Imported::Ok { path, reused: true, .. } if path == "assets/photo-ete.png"));
        // Same name, other content: suffixed.
        let mut other = PNG_1X1.to_vec();
        other.push(0);
        let second = import(v.path(), "Photo été.png", &other).unwrap();
        assert!(matches!(&second, Imported::Ok { path, .. } if path == "assets/photo-ete-2.png"));
        // The extension follows the real format.
        let renamed = import(v.path(), "fake.gif", b"%PDF-1.4 rest").unwrap();
        assert!(matches!(&renamed, Imported::Ok { path, format: Format::Pdf, .. } if path == "assets/fake.pdf"));
        assert!(matches!(import(v.path(), "IMG_0001.HEIC", b"\0\0\0\x18ftypheic\0\0\0\0").unwrap(), Imported::Refused { reason: Refusal::Heic, .. }));
    }

    #[test]
    fn protocol_serves_only_attachments_and_caches() {
        assert!(servable("assets/photo.png"));
        assert!(servable("sous dossier/image.png"));
        assert!(servable(".ursa/thumbs/abc.jpg"));
        assert!(servable(".ursa/previews/abc/image.png"));
        assert!(!servable(".ursa/tags.json"));
        assert!(!servable(".ursa/backups/x/a.md"));
        assert!(!servable("assets/.secret"));
        assert_eq!(percent_decode("assets/mon%20image%C3%A9.png"), "assets/mon imageé.png");
    }
}
