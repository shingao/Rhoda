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

use super::{Engine, Language, Line, Word};

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
        let lines = result.Lines().map_err(err)?;
        let mut out = Vec::new();
        for i in 0..lines.Size().map_err(err)? {
            let line = lines.GetAt(i).map_err(err)?;
            let words = line.Words().map_err(err)?;
            let mut list = Vec::new();
            for j in 0..words.Size().map_err(err)? {
                let word = words.GetAt(j).map_err(err)?;
                let r = word.BoundingRect().map_err(err)?;
                list.push(Word { text: word.Text().map_err(err)?.to_string(), x: r.X, y: r.Y, w: r.Width, h: r.Height });
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
    use super::*;

    /// Real OCR on the Windows runner: a picture of known text, in French if
    /// that recognizer is installed, otherwise English.
    #[test]
    fn reads_known_text_with_windows_ocr() {
        let engine = WindowsEngine::new().expect("Windows.Media.Ocr available");
        let languages = engine.languages();
        println!("OCR languages: {:?}, max {}", languages.iter().map(|l| &l.tag).collect::<Vec<_>>(), engine.max_dimension());
        let tag = languages
            .iter()
            .find(|l| l.tag.starts_with("fr"))
            .or_else(|| languages.iter().find(|l| l.tag.starts_with("en")))
            .map(|l| l.tag.clone())
            .expect("a French or English OCR language installed");
        let bytes = include_bytes!("../../tests/fixtures/ocr-text.png");
        let page = super::super::ocr_bytes(&engine, bytes, &[tag]).unwrap();
        let text = page.text.to_uppercase();
        println!("{text}");
        for word in ["SHINKANSEN", "KYOTO", "NARA"] {
            assert!(text.contains(word), "{word} not found in {text:?}");
        }
        let kyoto = page.lines.iter().flat_map(|l| &l.words).find(|w| w.text.to_uppercase().contains("KYOTO")).unwrap();
        assert!(kyoto.w > 10.0 && kyoto.h > 5.0 && kyoto.x >= 0.0 && kyoto.x + kyoto.w <= page.width as f32);
    }
}
