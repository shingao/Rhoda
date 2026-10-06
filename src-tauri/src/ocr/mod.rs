//! Local OCR of note images and scanned PDF pages.
//!
//! The engine sits behind [`Engine`]: Windows.Media.Ocr on Windows
//! (`windows.rs`), nothing elsewhere (the app works without OCR), and a fake
//! one in tests. Around it, everything here is portable and tested: EXIF
//! orientation, small images enlarged, large ones cut into overlapping tiles
//! (never shrunk, so small text is kept), words and their boxes in the
//! coordinates of the image as displayed, cache in `.ursa/ocr/` by content.

#[cfg(windows)]
mod windows;

use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::{DynamicImage, ImageDecoder, ImageReader, RgbaImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{current_root, resolve, VaultState, INTERNAL_DIR};

/// Version of the cache files: bumped when results would differ.
const CACHE_VERSION: u32 = 1;
const OCR_DIR: &str = "ocr";
/// Images smaller than this (longest side) are enlarged ×2: the engine reads small text badly.
const ENLARGE_BELOW: u32 = 1000;
/// Overlap between tiles, so that every word lies whole in at least one tile.
const TILE_OVERLAP: u32 = 256;

/// A recognized word and its box, in pixels of the image as displayed (orientation applied).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub words: Vec<Word>,
}

impl Line {
    pub fn text(&self) -> String {
        self.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ")
    }
}

/// Text of one image, or of one PDF page (`page` from 1; `source` = "text" for a PDF text layer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    pub source: String,
    pub width: u32,
    pub height: u32,
    /// Lines with words (OCR); a PDF text layer has `text` only.
    #[serde(default)]
    pub lines: Vec<Line>,
    #[serde(default)]
    pub text: String,
}

/// What is cached for a file: its pages, and the languages used.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Doc {
    pub version: u32,
    pub langs: Vec<String>,
    pub pages: Vec<Page>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Language {
    pub tag: String,
    pub name: String,
}

/// An OCR engine: recognizes one RGBA image no larger than `max_dimension`.
pub trait Engine {
    fn languages(&self) -> Vec<Language>;
    fn max_dimension(&self) -> u32;
    fn recognize(&self, image: &RgbaImage, lang: &str) -> Result<Vec<Line>, String>;
}

/// The engine of this system, if any.
pub fn system_engine() -> Option<Box<dyn Engine>> {
    #[cfg(windows)]
    {
        windows::WindowsEngine::new().map(|e| Box::new(e) as Box<dyn Engine>)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Decodes an image file and applies its EXIF orientation (as `<img>` does).
pub fn decode_oriented(bytes: &[u8]) -> Result<DynamicImage, String> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    Ok(image)
}

/// Origins of tiles of at most `max` px covering `len` px, overlapping by `overlap`.
fn tile_starts(len: u32, max: u32, overlap: u32) -> Vec<u32> {
    if len <= max {
        return vec![0];
    }
    let step = max.saturating_sub(overlap).max(1);
    let mut starts: Vec<u32> = (0..).map(|i| i * step).take_while(|&s| s + max < len).collect();
    starts.push(len - max);
    starts
}

fn iou(a: &Word, b: &Word) -> f32 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.w).min(b.x + b.w);
    let y2 = (a.y + a.h).min(b.y + b.h);
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let union = a.w * a.h + b.w * b.h - inter;
    if union <= 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// Recognizes an image of any size with one language: enlarged if small, tiled if
/// larger than the engine allows. Boxes are in pixels of `image`.
pub fn recognize_image(engine: &dyn Engine, image: &RgbaImage, lang: &str) -> Result<Vec<Line>, String> {
    let max = engine.max_dimension().max(64);
    let (w, h) = image.dimensions();
    if w == 0 || h == 0 {
        return Ok(Vec::new());
    }
    let longest = w.max(h);
    let scale = if longest < ENLARGE_BELOW && longest * 2 <= max { 2 } else { 1 };
    let enlarged;
    let source = if scale > 1 {
        enlarged = image::imageops::resize(image, w * scale, h * scale, image::imageops::FilterType::CatmullRom);
        &enlarged
    } else {
        image
    };
    let (sw, sh) = source.dimensions();
    let overlap = TILE_OVERLAP.min(max / 4);
    let xs = tile_starts(sw, max, overlap);
    let ys = tile_starts(sh, max, overlap);
    let tiled = xs.len() > 1 || ys.len() > 1;
    let mut lines: Vec<Line> = Vec::new();
    let mut kept: Vec<Word> = Vec::new();
    for &ty in &ys {
        for &tx in &xs {
            let tw = max.min(sw - tx);
            let th = max.min(sh - ty);
            let tile = if tiled { image::imageops::crop_imm(source, tx, ty, tw, th).to_image() } else { source.clone() };
            for line in engine.recognize(&tile, lang)? {
                let words: Vec<Word> = line
                    .words
                    .into_iter()
                    .filter(|word| {
                        // A word cut by an inner tile edge is read whole in the neighbouring tile.
                        let edge = 2.0;
                        let cut_left = tx > 0 && word.x <= edge;
                        let cut_top = ty > 0 && word.y <= edge;
                        let cut_right = tx + tw < sw && word.x + word.w >= tw as f32 - edge;
                        let cut_bottom = ty + th < sh && word.y + word.h >= th as f32 - edge;
                        !(cut_left || cut_top || cut_right || cut_bottom)
                    })
                    .map(|word| Word {
                        text: word.text,
                        x: (word.x + tx as f32) / scale as f32,
                        y: (word.y + ty as f32) / scale as f32,
                        w: word.w / scale as f32,
                        h: word.h / scale as f32,
                    })
                    // The same word read again in an overlap.
                    .filter(|word| !kept.iter().any(|k| k.text == word.text && iou(k, word) > 0.5))
                    .collect();
                if words.is_empty() {
                    continue;
                }
                kept.extend(words.iter().cloned());
                lines.push(Line { words });
            }
        }
    }
    Ok(lines)
}

/// Several languages: the first one's lines, then the lines another language
/// reads differently (accents, other alphabet), so that both are searchable.
pub fn recognize_languages(engine: &dyn Engine, image: &RgbaImage, langs: &[String]) -> Result<Vec<Line>, String> {
    let mut all: Vec<Line> = Vec::new();
    for lang in langs {
        for line in recognize_image(engine, image, lang)? {
            let text = line.text().to_lowercase();
            if !all.iter().any(|l| l.text().to_lowercase() == text) {
                all.push(line);
            }
        }
    }
    Ok(all)
}

/// OCR of one image file: one page.
pub fn ocr_bytes(engine: &dyn Engine, bytes: &[u8], langs: &[String]) -> Result<Page, String> {
    let image = decode_oriented(bytes)?.to_rgba8();
    let lines = recognize_languages(engine, &image, langs)?;
    let text = lines.iter().map(Line::text).collect::<Vec<_>>().join("\n");
    Ok(Page { page: None, source: "ocr".into(), width: image.width(), height: image.height(), lines, text })
}

// ---------------------------------------------------------------------------
// Cache: `.ursa/ocr/<sha256>.json`, and `index.json` (path → size, date, hash)
// so that unchanged files are not hashed again.

fn ocr_dir(root: &Path) -> PathBuf {
    root.join(INTERNAL_DIR).join(OCR_DIR)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct IndexEntry {
    size: u64,
    modified: u64,
    hash: String,
}

fn stamp(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    Some((meta.len(), modified))
}

/// Remembered hashes; one per vault, loaded once.
#[derive(Default)]
pub struct OcrState {
    index: Mutex<Option<(PathBuf, HashMap<String, IndexEntry>)>>,
    /// One recognition at a time (background work).
    busy: tokio::sync::Mutex<()>,
}

impl OcrState {
    fn with_index<T>(&self, root: &Path, f: impl FnOnce(&mut HashMap<String, IndexEntry>) -> T) -> T {
        let mut guard = self.index.lock().unwrap_or_else(|e| e.into_inner());
        if guard.as_ref().map(|(r, _)| r.as_path()) != Some(root) {
            let map = fs::read(ocr_dir(root).join("index.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            *guard = Some((root.to_path_buf(), map));
        }
        f(&mut guard.as_mut().expect("index loaded").1)
    }

    fn save_index(&self, root: &Path) {
        let guard = self.index.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, map)) = guard.as_ref() {
            if let Ok(json) = serde_json::to_vec(map) {
                let _ = fs::create_dir_all(ocr_dir(root));
                let _ = crate::vault::atomic_write_bytes(&ocr_dir(root).join("index.json"), &json);
            }
        }
    }

    /// Content hash of a vault file, from the index when its size and date did not change.
    fn hash_of(&self, root: &Path, rel: &str) -> CmdResult<String> {
        let path = resolve(root, rel)?;
        let (size, modified) = stamp(&path).ok_or_else(|| CmdError::new(ErrorKind::NotFound, rel.to_string()))?;
        let known = self.with_index(root, |map| map.get(rel).filter(|e| e.size == size && e.modified == modified).map(|e| e.hash.clone()));
        if let Some(hash) = known {
            return Ok(hash);
        }
        let hash = hex(&Sha256::digest(fs::read(&path)?));
        self.with_index(root, |map| map.insert(rel.to_string(), IndexEntry { size, modified, hash: hash.clone() }));
        self.save_index(root);
        Ok(hash)
    }

    fn forget(&self) {
        *self.index.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

fn read_cache(root: &Path, hash: &str, langs: &[String]) -> Option<Doc> {
    let doc: Doc = serde_json::from_slice(&fs::read(ocr_dir(root).join(format!("{hash}.json"))).ok()?).ok()?;
    (doc.version == CACHE_VERSION && doc.langs == langs).then_some(doc)
}

fn write_cache(root: &Path, hash: &str, doc: &Doc) -> CmdResult<()> {
    fs::create_dir_all(ocr_dir(root))?;
    let json = serde_json::to_vec(doc).map_err(CmdError::other)?;
    crate::vault::atomic_write_bytes(&ocr_dir(root).join(format!("{hash}.json")), &json)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub available: bool,
    pub languages: Vec<Language>,
    pub max_dimension: u32,
}

/// Whether OCR works here, and the recognition languages installed in Windows.
#[tauri::command]
pub async fn ocr_status() -> CmdResult<OcrStatus> {
    tauri::async_runtime::spawn_blocking(|| {
        let engine = system_engine();
        OcrStatus {
            available: engine.is_some(),
            languages: engine.as_ref().map(|e| e.languages()).unwrap_or_default(),
            max_dimension: engine.as_ref().map(|e| e.max_dimension()).unwrap_or(0),
        }
    })
    .await
    .map_err(CmdError::other)
}

/// Cached results of vault files (null: not done yet with these languages, or missing file).
#[tauri::command]
pub async fn ocr_cached(state: State<'_, VaultState>, ocr: State<'_, OcrState>, paths: Vec<String>, langs: Vec<String>) -> CmdResult<Vec<Option<Doc>>> {
    let root = current_root(&state)?;
    Ok(paths.iter().map(|rel| ocr.hash_of(&root, rel).ok().and_then(|hash| read_cache(&root, &hash, &langs))).collect())
}

/// Runs a blocking recognition in the background: one at a time, below normal priority.
async fn in_background<T: Send + 'static>(ocr: &OcrState, job: impl FnOnce(&dyn Engine) -> Result<T, String> + Send + 'static) -> CmdResult<T> {
    let _turn = ocr.busy.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let _priority = windows::BackgroundThread::enter();
        let engine = system_engine().ok_or_else(|| "OCR unavailable".to_string())?;
        job(engine.as_ref())
    })
    .await
    .map_err(CmdError::other)?
    .map_err(|e| CmdError::new(ErrorKind::Other, e))
}

/// OCR of an image of the vault (from the cache when the file did not change).
#[tauri::command]
pub async fn ocr_image(state: State<'_, VaultState>, ocr: State<'_, OcrState>, path: String, langs: Vec<String>) -> CmdResult<Doc> {
    let root = current_root(&state)?;
    let hash = ocr.hash_of(&root, &path)?;
    if let Some(doc) = read_cache(&root, &hash, &langs) {
        return Ok(doc);
    }
    let bytes = fs::read(resolve(&root, &path)?)?;
    let job_langs = langs.clone();
    let page = in_background(&ocr, move |engine| ocr_bytes(engine, &bytes, &job_langs)).await?;
    let doc = Doc { version: CACHE_VERSION, langs, pages: vec![page] };
    write_cache(&root, &hash, &doc)?;
    Ok(doc)
}

/// OCR of a rendered PDF page (PNG in the raw body, page number in `x-ursa-page`).
#[tauri::command]
pub async fn ocr_page(ocr: State<'_, OcrState>, request: tauri::ipc::Request<'_>) -> CmdResult<Page> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new(ErrorKind::Other, "expected raw bytes"));
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let page = header("x-ursa-page").and_then(|p| p.parse().ok());
    let langs: Vec<String> = header("x-ursa-langs").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
    let bytes = bytes.clone();
    let mut result = in_background(&ocr, move |engine| ocr_bytes(engine, &bytes, &langs)).await?;
    result.page = page;
    Ok(result)
}

/// Keeps the text of a PDF (text layer and OCR of its scanned pages), assembled by the frontend.
#[tauri::command]
pub async fn ocr_store(state: State<'_, VaultState>, ocr: State<'_, OcrState>, path: String, doc: Doc) -> CmdResult<()> {
    let root = current_root(&state)?;
    let hash = ocr.hash_of(&root, &path)?;
    write_cache(&root, &hash, &Doc { version: CACHE_VERSION, ..doc })
}

/// Settings › OCR › "Reindex": forgets every result.
#[tauri::command]
pub async fn ocr_clear(state: State<'_, VaultState>, ocr: State<'_, OcrState>) -> CmdResult<()> {
    let root = current_root(&state)?;
    ocr.forget();
    match fs::remove_dir_all(ocr_dir(&root)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Reads the "text" painted as black rectangles: each dark run of a row
    /// becomes a word named after its position, so tiling can be checked.
    struct Fake {
        max: u32,
        calls: RefCell<Vec<(u32, u32)>>,
    }

    impl Engine for Fake {
        fn languages(&self) -> Vec<Language> {
            vec![Language { tag: "en-US".into(), name: "English".into() }]
        }
        fn max_dimension(&self) -> u32 {
            self.max
        }
        fn recognize(&self, image: &RgbaImage, lang: &str) -> Result<Vec<Line>, String> {
            assert!(image.width() <= self.max && image.height() <= self.max, "tile too large");
            self.calls.borrow_mut().push(image.dimensions());
            // Dark boxes: find their bounding rectangles by flood over rows.
            let mut words = Vec::new();
            let mut seen = vec![false; (image.width() * image.height()) as usize];
            for y in 0..image.height() {
                for x in 0..image.width() {
                    let i = (y * image.width() + x) as usize;
                    if seen[i] || image.get_pixel(x, y)[0] > 100 {
                        continue;
                    }
                    let (mut x2, mut y2) = (x, y);
                    while x2 + 1 < image.width() && image.get_pixel(x2 + 1, y)[0] <= 100 {
                        x2 += 1;
                    }
                    while y2 + 1 < image.height() && image.get_pixel(x, y2 + 1)[0] <= 100 {
                        y2 += 1;
                    }
                    for yy in y..=y2 {
                        for xx in x..=x2 {
                            seen[(yy * image.width() + xx) as usize] = true;
                        }
                    }
                    words.push(Word { text: format!("{lang}-{}x{}", x2 - x + 1, y2 - y + 1), x: x as f32, y: y as f32, w: (x2 - x + 1) as f32, h: (y2 - y + 1) as f32 });
                }
            }
            Ok(words.into_iter().map(|w| Line { words: vec![w] }).collect())
        }
    }

    fn page_with_boxes(w: u32, h: u32, boxes: &[(u32, u32, u32, u32)]) -> RgbaImage {
        let mut image = RgbaImage::from_pixel(w, h, image::Rgba([255, 255, 255, 255]));
        for &(x, y, bw, bh) in boxes {
            for yy in y..y + bh {
                for xx in x..x + bw {
                    image.put_pixel(xx, yy, image::Rgba([0, 0, 0, 255]));
                }
            }
        }
        image
    }

    #[test]
    fn tiles_cover_the_image_with_overlap() {
        assert_eq!(tile_starts(800, 1000, 100), vec![0]);
        assert_eq!(tile_starts(2500, 1000, 200), vec![0, 800, 1500]);
        assert_eq!(tile_starts(1001, 1000, 200), vec![0, 1]);
    }

    #[test]
    fn large_images_are_tiled_never_shrunk_and_words_kept_once() {
        let fake = Fake { max: 1000, calls: RefCell::new(Vec::new()) };
        // A small word across the tile seam (x = 744–1000 overlap), others far apart.
        let image = page_with_boxes(2400, 1300, &[(100, 100, 40, 12), (790, 600, 60, 12), (2300, 1250, 30, 10)]);
        let lines = recognize_image(&fake, &image, "en").unwrap();
        let mut words: Vec<_> = lines.iter().flat_map(|l| l.words.clone()).collect();
        words.sort_by(|a, b| a.x.total_cmp(&b.x));
        assert_eq!(words.iter().map(|w| (w.x, w.y, w.w, w.h)).collect::<Vec<_>>(), vec![(100.0, 100.0, 40.0, 12.0), (790.0, 600.0, 60.0, 12.0), (2300.0, 1250.0, 30.0, 10.0)]);
        // Small text kept: every tile at full resolution.
        assert!(fake.calls.borrow().iter().all(|&(w, h)| w <= 1000 && h <= 1000));
        assert!(fake.calls.borrow().len() >= 4);
    }

    #[test]
    fn small_images_are_enlarged_and_boxes_mapped_back() {
        let fake = Fake { max: 4000, calls: RefCell::new(Vec::new()) };
        let lines = recognize_image(&fake, &page_with_boxes(300, 200, &[(10, 20, 30, 8)]), "en").unwrap();
        assert_eq!(fake.calls.borrow()[0], (600, 400));
        assert_eq!(lines[0].words[0], Word { text: "en-60x16".into(), x: 10.0, y: 20.0, w: 30.0, h: 8.0 });
    }

    #[test]
    fn exif_orientation_is_applied() {
        // A 4×2 JPEG tagged "rotate 90° CW" (orientation 6) is shown 2×4.
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg).encode(&[255u8; 4 * 2 * 3], 4, 2, image::ExtendedColorType::Rgb8).unwrap();
        let exif: &[u8] = &[
            0xFF, 0xE1, 0x00, 0x22, b'E', b'x', b'i', b'f', 0, 0, b'M', b'M', 0, 0x2A, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0,
        ];
        let tagged = [&jpeg[..2], exif, &jpeg[2..]].concat();
        let image = decode_oriented(&tagged).unwrap();
        assert_eq!((image.width(), image.height()), (2, 4));
    }

    #[test]
    fn languages_add_only_new_lines() {
        let fake = Fake { max: 4000, calls: RefCell::new(Vec::new()) };
        let image = page_with_boxes(1200, 400, &[(10, 10, 50, 10)]);
        let lines = recognize_languages(&fake, &image, &["fr".into(), "en".into()]).unwrap();
        // Different text per language here: both kept.
        assert_eq!(lines.iter().map(Line::text).collect::<Vec<_>>(), vec!["fr-50x10", "en-50x10"]);
    }

    #[test]
    fn cache_is_keyed_by_content_and_languages() {
        let v = tempfile::tempdir().unwrap();
        fs::create_dir_all(v.path().join("assets")).unwrap();
        fs::write(v.path().join("assets/a.png"), b"one").unwrap();
        let state = OcrState::default();
        let hash = state.hash_of(v.path(), "assets/a.png").unwrap();
        let doc = Doc { version: CACHE_VERSION, langs: vec!["fr".into()], pages: vec![] };
        write_cache(v.path(), &hash, &doc).unwrap();
        assert_eq!(read_cache(v.path(), &hash, &["fr".into()]), Some(doc));
        assert_eq!(read_cache(v.path(), &hash, &["en".into()]), None);
        // Same content elsewhere: same entry; changed content: another one.
        fs::write(v.path().join("assets/b.png"), b"one").unwrap();
        assert_eq!(state.hash_of(v.path(), "assets/b.png").unwrap(), hash);
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(v.path().join("assets/a.png"), b"two!").unwrap();
        assert_ne!(state.hash_of(v.path(), "assets/a.png").unwrap(), hash);
        assert!(v.path().join(".ursa/ocr/index.json").exists());
    }
}
