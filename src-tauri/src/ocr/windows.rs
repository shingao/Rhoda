//! Windows.Media.Ocr: the recognizer built into Windows 10/11, with the OCR
//! languages installed in Windows (Settings › Time & language › Language).

use image::RgbaImage;
use windows::core::HSTRING;
use windows::Globalization::Language as WinLanguage;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority, SetThreadPriority, THREAD_PRIORITY, THREAD_PRIORITY_BELOW_NORMAL};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use super::{unrotate, Engine, Language, Line, Word};

pub struct WindowsEngine {
    max: u32,
}

/// WinRT on a worker thread: multithreaded apartment (an error means it already is one).
fn init_thread() {
    // SAFETY: plain WinRT initialisation of the current thread.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
}

impl WindowsEngine {
    /// None when the OCR API is missing (Windows N without media features, old builds).
    pub fn new() -> Option<Self> {
        init_thread();
        let max = OcrEngine::MaxImageDimension().ok()?;
        OcrEngine::AvailableRecognizerLanguages().ok()?;
        Some(Self { max })
    }
}

impl Engine for WindowsEngine {
    fn languages(&self) -> Vec<Language> {
        let Ok(list) = OcrEngine::AvailableRecognizerLanguages() else {
            return Vec::new();
        };
        let size = list.Size().unwrap_or(0);
        (0..size)
            .filter_map(|i| list.GetAt(i).ok())
            .map(|l| Language {
                tag: l.LanguageTag().map(|s| s.to_string()).unwrap_or_default(),
                name: l.DisplayName().map(|s| s.to_string()).unwrap_or_default(),
            })
            .collect()
    }

    fn max_dimension(&self) -> u32 {
        self.max
    }

    fn recognize(&self, image: &RgbaImage, lang: &str) -> Result<Vec<Line>, String> {
        let err = |e: windows::core::Error| e.message().to_string();
        let language = WinLanguage::CreateLanguage(&HSTRING::from(lang)).map_err(err)?;
        let engine = OcrEngine::TryCreateFromLanguage(&language).map_err(err)?;
        // RGBA → BGRA, the format SoftwareBitmap takes.
        let mut bgra = image.as_raw().clone();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let buffer = CryptographicBuffer::CreateFromByteArray(&bgra).map_err(err)?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, image.width() as i32, image.height() as i32).map_err(err)?;
        let result = engine.RecognizeAsync(&bitmap).map_err(err)?.join().map_err(err)?;
        // Tilted text: boxes are given in the straightened image.
        let angle = result.TextAngle().ok().and_then(|a| a.Value().ok()).unwrap_or(0.0);
        let lines = result.Lines().map_err(err)?;
        let mut out = Vec::new();
        for i in 0..lines.Size().map_err(err)? {
            let line = lines.GetAt(i).map_err(err)?;
            let words = line.Words().map_err(err)?;
            let mut list = Vec::new();
            for j in 0..words.Size().map_err(err)? {
                let word = words.GetAt(j).map_err(err)?;
                let r = word.BoundingRect().map_err(err)?;
                let located = Word { text: word.Text().map_err(err)?.to_string(), x: r.X, y: r.Y, w: r.Width, h: r.Height };
                list.push(unrotate(located, angle, image.width(), image.height()));
            }
            if !list.is_empty() {
                out.push(Line { words: list });
            }
        }
        Ok(out)
    }
}

/// Lowers the priority of the current (pooled) thread while OCR runs, then restores it.
pub struct BackgroundThread(THREAD_PRIORITY);

impl BackgroundThread {
    pub fn enter() -> Self {
        init_thread();
        // SAFETY: pseudo-handle of the current thread.
        unsafe {
            let previous = THREAD_PRIORITY(GetThreadPriority(GetCurrentThread()));
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
            Self(previous)
        }
    }
}

impl Drop for BackgroundThread {
    fn drop(&mut self) {
        // SAFETY: as above.
        let _ = unsafe { SetThreadPriority(GetCurrentThread(), self.0) };
    }
}

#[cfg(test)]
mod tests {
    //! Real OCR, run by the Windows CI (`cargo test --lib ocr::windows`). Nothing
    //! here is skipped: no engine, no English recognizer or a word not read fails.
    use super::super::{ocr_bytes, Page};
    use super::*;

    /// The engine and its English recognizer (the one Windows runners have).
    fn english() -> (WindowsEngine, String) {
        let engine = WindowsEngine::new().expect("Windows.Media.Ocr is not available");
        let languages = engine.languages();
        println!("OCR languages: {:?}, max {}", languages.iter().map(|l| &l.tag).collect::<Vec<_>>(), engine.max_dimension());
        let tag = languages.iter().find(|l| l.tag.starts_with("en")).map(|l| l.tag.clone()).expect("no English OCR language installed");
        (engine, tag)
    }

    fn read(engine: &WindowsEngine, bytes: &[u8], tag: &str) -> Page {
        let page = ocr_bytes(engine, bytes, &[tag.to_string()]).expect("OCR failed");
        println!("{} × {}\n{}", page.width, page.height, page.text);
        for word in page.lines.iter().flat_map(|l| &l.words) {
            println!("  {:?} at {:.0},{:.0} {:.0}×{:.0}", word.text, word.x, word.y, word.w, word.h);
        }
        page
    }

    /// The words read as `name`; fails when there are none.
    fn found<'a>(page: &'a Page, name: &str) -> Vec<&'a Word> {
        let words: Vec<&Word> = page.lines.iter().flat_map(|l| &l.words).filter(|w| w.text.to_uppercase().contains(name)).collect();
        assert!(!words.is_empty(), "{name} not read in {:?}", page.text);
        words
    }

    fn centre(word: &Word) -> (f32, f32) {
        (word.x + word.w / 2.0, word.y + word.h / 2.0)
    }

    #[test]
    fn reads_known_text_with_windows_ocr() {
        let (engine, tag) = english();
        let page = read(&engine, include_bytes!("../../tests/fixtures/ocr-text.png"), &tag);
        for name in ["SHINKANSEN", "KYOTO", "NARA"] {
            found(&page, name);
        }
        let kyoto = found(&page, "KYOTO")[0];
        assert!(kyoto.w > 10.0 && kyoto.h > 5.0 && kyoto.x >= 0.0 && kyoto.x + kyoto.w <= page.width as f32);
    }

    /// A photo of a ticket tilted by 4°, saved sideways by the camera with EXIF
    /// orientation 6 (scripts/make-ocr-fixtures.mjs): read upright, boxes where
    /// the words are seen.
    #[test]
    fn reads_a_tilted_photo_saved_sideways() {
        let (engine, tag) = english();
        let page = read(&engine, include_bytes!("../../tests/fixtures/ocr-photo.jpg"), &tag);
        assert_eq!((page.width, page.height), (1600, 1067), "EXIF orientation not applied");
        // Centres measured in the browser that drew the scene.
        for (name, x, y) in [("HAKONE", 440.0, 334.0), ("ODAWARA", 448.0, 481.0), ("TOGENDAI", 880.0, 451.0)] {
            let word = found(&page, name)[0];
            let (cx, cy) = centre(word);
            assert!((cx - x).abs() < 16.0 && (cy - y).abs() < 16.0, "{name} centred at {cx:.0},{cy:.0}, expected {x},{y}");
        }
    }

    /// A picture wider than the engine accepts: read in overlapping tiles at full
    /// resolution, every word once (one across the first tile's edge), boxes in
    /// the whole picture.
    #[test]
    fn reads_a_picture_wider_than_the_engine_limit() {
        let (engine, tag) = english();
        let max = engine.max_dimension();
        let (width, height) = (max + 2500, 1000);
        // ocr-words.png: one word per 120 px row, drawn 24 px from the left.
        let words = image::load_from_memory(include_bytes!("../../tests/fixtures/ocr-words.png")).unwrap().to_rgba8();
        let mut picture = RgbaImage::from_pixel(width, height, image::Rgba([246, 244, 238, 255]));
        let places = [("SAPPORO", 300, 150), ("HAKODATE", max / 2 - 600, 350), ("KUSHIRO", max - 150, 550), ("OTARU", width - 600, 750)];
        for (row, &(_, x, y)) in places.iter().enumerate() {
            let strip = image::imageops::crop_imm(&words, 0, row as u32 * 120, words.width(), 120).to_image();
            image::imageops::overlay(&mut picture, &strip, x.into(), y.into());
        }
        let mut png = Vec::new();
        picture.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let page = read(&engine, &png, &tag);
        assert_eq!((page.width, page.height), (width, height));
        assert!(width > max, "the picture must need tiles");
        let all: Vec<&str> = page.lines.iter().flat_map(|l| &l.words).map(|w| w.text.as_str()).collect();
        assert_eq!(all.len(), places.len(), "each word once, no piece of a cut word: {all:?}");
        for (name, x, y) in places {
            let word = found(&page, name)[0];
            let (left, top) = ((x + 24) as f32, y as f32);
            assert!((word.x - left).abs() < 12.0 && word.y > top && word.y + word.h < top + 120.0, "{name} at {:.0},{:.0}, expected near {left},{top}", word.x, word.y);
        }
        let kushiro = found(&page, "KUSHIRO")[0];
        assert!(kushiro.x < max as f32 && kushiro.x + kushiro.w > max as f32, "KUSHIRO should cross x = {max}");
    }
}
