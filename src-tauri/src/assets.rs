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

/// Imported sticker images ("Mine" in the drawer), inside the attachments folder.
pub(crate) const STICKERS_DIR: &str = "assets/stickers";
/// Formats accepted as stickers (SVG is always shown through `<img>`).
const STICKER_FORMATS: [Format; 3] = [Format::Png, Format::Webp, Format::Svg];

/// Writes `bytes` into `assets/` (or finds the identical file already there).
pub(crate) fn import(root: &Path, name: &str, bytes: &[u8]) -> CmdResult<Imported> {
    import_into(root, ASSETS_DIR, name, bytes, None)
}

/// Same as `import`, into the folder `sub` (vault-relative), optionally limited to some formats.
fn import_into(root: &Path, sub: &str, name: &str, bytes: &[u8], only: Option<&[Format]>) -> CmdResult<Imported> {
    let refused = |reason| Ok(Imported::Refused { name: name.to_string(), reason });
    if bytes.len() as u64 > MAX_BYTES {
        return refused(Refusal::TooLarge);
    }
    let format = match detect(&bytes[..bytes.len().min(4096)]) {
        Detected::Ok(f) if only.map_or(true, |list| list.contains(&f)) => f,
        Detected::Ok(_) => return refused(Refusal::Unsupported),
        Detected::Refused(r) => return refused(r),
    };
    let (width, height) = dimensions(format, bytes).map_or((None, None), |(w, h)| (Some(w), Some(h)));
    let dir = root.join(sub);
    fs::create_dir_all(&dir)?;
    let rel = |p: &Path| format!("{sub}/{}", p.file_name().unwrap_or_default().to_string_lossy());
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

/// Images imported as stickers ("Import image…" in the drawer, or dropped while it is open):
/// copied to `assets/stickers/`, PNG / WebP / SVG only, identical files reused.
#[tauri::command]
pub async fn import_stickers(state: State<'_, VaultState>, paths: Vec<String>) -> CmdResult<Vec<Imported>> {
    let root = current_root(&state)?;
    paths
        .iter()
        .map(|p| {
            let path = Path::new(p);
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            import_into(&root, STICKERS_DIR, &name, &read_limited(path)?, Some(&STICKER_FORMATS))
        })
        .collect()
}

/// Native picker for sticker images; absolute paths, empty if cancelled.
#[tauri::command]
pub async fn pick_stickers(app: AppHandle, title: String) -> CmdResult<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter("PNG, WebP, SVG", &["png", "webp", "svg"])
        .blocking_pick_files()
        .unwrap_or_default();
    Ok(picked.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect())
}

pub(crate) fn sticker_files(root: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(root.join(STICKERS_DIR)) else {
        return Vec::new();
    };
    let mut files: Vec<(std::time::SystemTime, String)> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let name = e.file_name().to_string_lossy().into_owned();
            let ext = Path::new(&name).extension()?.to_str()?.to_ascii_lowercase();
            (meta.is_file() && !name.starts_with('.') && ["png", "webp", "svg"].contains(&ext.as_str()))
                .then(|| (meta.modified().unwrap_or(std::time::UNIX_EPOCH), format!("{STICKERS_DIR}/{name}")))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    files.into_iter().map(|(_, rel)| rel).collect()
}

/// Imported stickers of the vault ("Mine"), newest first (vault-relative paths).
#[tauri::command]
pub async fn list_stickers(state: State<'_, VaultState>) -> CmdResult<Vec<String>> {
    Ok(sticker_files(&current_root(&state)?))
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

/// Side of the thumbnails of note cards (64 px shown, ×2 for high-DPI screens).
const THUMB: u32 = 128;
/// Prefix of thumbnail URLs: `vault://localhost/_thumb/assets/photo.png`.
const THUMB_PREFIX: &str = "_thumb/";

/// Names a cached derivative of a file: changes when the file is edited.
fn version_key(rel: &str, meta: &fs::Metadata) -> String {
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
    sha256(format!("{rel}\0{modified}\0{}", meta.len()).as_bytes()).iter().take(16).map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub bytes: u64,
    /// `.ursa/thumbs/<key>.png`, first page drawn by pdf.js, once.
    pub thumb: Option<String>,
    pub pages: Option<u32>,
}

fn pdf_cache(root: &Path, rel: &str) -> CmdResult<(PathBuf, PathBuf, u64)> {
    let meta = fs::metadata(resolve(root, rel)?)?;
    let key = version_key(rel, &meta);
    let dir = root.join(INTERNAL_DIR).join("thumbs");
    Ok((dir.join(format!("pdf-{key}.png")), dir.join(format!("pdf-{key}.json")), meta.len()))
}

/// Size of a PDF and its cached first-page preview, if made already.
#[tauri::command]
pub async fn pdf_info(state: State<'_, VaultState>, path: String) -> CmdResult<PdfInfo> {
    let root = current_root(&state)?;
    let (png, json, bytes) = pdf_cache(&root, &path)?;
    let pages = fs::read_to_string(&json).ok().and_then(|t| serde_json::from_str::<PdfInfo>(&t).ok()).and_then(|i| i.pages);
    let thumb = png.exists().then(|| png.strip_prefix(&root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default());
    Ok(PdfInfo { bytes, thumb, pages })
}

/// Keeps the first-page preview drawn by the frontend (raw PNG body; `x-ursa-path`, `x-ursa-pages` headers).
#[tauri::command]
pub async fn save_pdf_preview(state: State<'_, VaultState>, request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let root = current_root(&state)?;
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err(CmdError::new(ErrorKind::Other, "expected raw bytes"));
    };
    if !matches!(detect(png), Detected::Ok(Format::Png)) {
        return Err(CmdError::new(ErrorKind::Other, "expected a PNG"));
    }
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(percent_decode);
    let rel = header("x-ursa-path").unwrap_or_default();
    let pages = header("x-ursa-pages").and_then(|p| p.parse::<u32>().ok());
    let (png_path, json_path, bytes) = pdf_cache(&root, &rel)?;
    fs::create_dir_all(png_path.parent().unwrap_or(&root))?;
    crate::vault::atomic_write_bytes(&png_path, png)?;
    crate::vault::atomic_write(&json_path, &serde_json::to_string(&PdfInfo { bytes, thumb: None, pages }).map_err(CmdError::other)?)?;
    Ok(())
}

/// Opens an attachment of the vault with the system's default app (PDF reader…).
#[tauri::command]
pub async fn open_attachment(app: AppHandle, state: State<'_, VaultState>, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let root = current_root(&state)?;
    if !servable(&path) {
        return Err(CmdError::new(ErrorKind::InvalidName, "not an attachment"));
    }
    let abs = resolve(&root, &path)?;
    if !abs.is_file() {
        return Err(CmdError::new(ErrorKind::NotFound, format!("{path} not found")));
    }
    app.opener().open_path(abs.to_string_lossy(), None::<&str>).map_err(CmdError::other)
}

/// Thumbnail of an image of the vault, made once and kept in `.ursa/thumbs/`
/// (named after the path, date and size of the original, so an edit makes a new one).
/// SVG is served as is (it scales by itself).
pub(crate) fn thumbnail(root: &Path, rel: &str) -> CmdResult<PathBuf> {
    let src = resolve(root, rel)?;
    let meta = fs::metadata(&src)?;
    let mut head = [0u8; 4096];
    let n = fs::File::open(&src)?.read(&mut head)?;
    match detect(&head[..n]) {
        Detected::Ok(Format::Svg) => return Ok(src),
        Detected::Ok(Format::Pdf) | Detected::Refused(_) => return Err(CmdError::new(ErrorKind::Other, "not an image")),
        Detected::Ok(_) => {}
    }
    let key = version_key(rel, &meta);
    let dir = root.join(INTERNAL_DIR).join("thumbs");
    let thumb = dir.join(format!("{key}.png"));
    if thumb.exists() {
        return Ok(thumb);
    }
    let image = image::ImageReader::open(&src)?.with_guessed_format()?.decode().map_err(CmdError::other)?;
    let small = image.resize_to_fill(THUMB, THUMB, image::imageops::FilterType::Triangle);
    let mut png = Vec::new();
    small.write_to(&mut io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(CmdError::other)?;
    fs::create_dir_all(&dir)?;
    crate::vault::atomic_write_bytes(&thumb, &png)?;
    Ok(thumb)
}

/// `vault://localhost/<path>` (`http://vault.localhost/<path>` on Windows).
pub fn serve(app: &AppHandle, request: &tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).expect("valid response");
    let Some(root) = root_of(&app.state::<VaultState>()) else { return not_found() };
    let rel = percent_decode(request.uri().path().trim_start_matches('/'));
    let path = if let Some(original) = rel.strip_prefix(THUMB_PREFIX) {
        if !servable(original) {
            return not_found();
        }
        match thumbnail(&root, original) {
            Ok(p) => p,
            Err(_) => return not_found(),
        }
    } else {
        if !servable(&rel) {
            return not_found();
        }
        let Ok(p) = resolve(&root, &rel) else { return not_found() };
        p
    };
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
    fn stickers_go_to_their_folder_png_webp_svg_only() {
        let v = tempfile::tempdir().unwrap();
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>";
        let first = import_into(v.path(), STICKERS_DIR, "Chat.svg", svg, Some(&STICKER_FORMATS)).unwrap();
        assert!(matches!(&first, Imported::Ok { path, reused: false, .. } if path == "assets/stickers/chat.svg"));
        let again = import_into(v.path(), STICKERS_DIR, "copie.svg", svg, Some(&STICKER_FORMATS)).unwrap();
        assert!(matches!(&again, Imported::Ok { path, reused: true, .. } if path == "assets/stickers/chat.svg"));
        let png = import_into(v.path(), STICKERS_DIR, "Étoile.png", PNG_1X1, Some(&STICKER_FORMATS)).unwrap();
        assert!(matches!(&png, Imported::Ok { path, .. } if path == "assets/stickers/etoile.png"));
        let pdf = import_into(v.path(), STICKERS_DIR, "devis.pdf", b"%PDF-1.4 rest", Some(&STICKER_FORMATS)).unwrap();
        assert!(matches!(pdf, Imported::Refused { reason: Refusal::Unsupported, .. }));
        let mut listed = sticker_files(v.path());
        listed.sort();
        assert_eq!(listed, ["assets/stickers/chat.svg", "assets/stickers/etoile.png"]);
    }

    #[test]
    fn thumbnails_are_made_once_and_cover_the_square() {
        let v = tempfile::tempdir().unwrap();
        fs::create_dir_all(v.path().join("assets")).unwrap();
        let img = image::RgbImage::from_pixel(400, 200, image::Rgb([200, 100, 50]));
        img.save(v.path().join("assets/large.png")).unwrap();
        let thumb = thumbnail(v.path(), "assets/large.png").unwrap();
        assert!(thumb.starts_with(v.path().join(".ursa/thumbs")));
        let made = image::open(&thumb).unwrap();
        assert_eq!((made.width(), made.height()), (THUMB, THUMB));
        let again = thumbnail(v.path(), "assets/large.png").unwrap();
        assert_eq!(thumb, again);
        fs::write(v.path().join("assets/s.svg"), "<svg width=\"10\" height=\"10\"></svg>").unwrap();
        assert_eq!(thumbnail(v.path(), "assets/s.svg").unwrap(), v.path().join("assets/s.svg"));
        assert!(thumbnail(v.path(), "../x.png").is_err());
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
