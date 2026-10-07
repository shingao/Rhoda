//! The two WebView2 calls the PDF export needs, on the webview's (main) thread:
//! run a script and get its JSON result, and print the page to a PDF file
//! (`PrintToPdf`: no print dialog, fonts embedded by Chromium).

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::{ExecuteScriptCompletedHandler, PrintToPdfCompletedHandler};
use windows::core::{Interface, HSTRING};

/// Page size in inches; margins are drawn by the page itself (`@page { margin: 0 }`).
pub struct PageInches {
    pub width: f64,
    pub height: f64,
}

/// Runs `script`; `done` gets its result as JSON (`"null"` when it failed).
pub fn execute_script(controller: &ICoreWebView2Controller, script: &str, done: impl FnOnce(String) + 'static) -> windows::core::Result<()> {
    // SAFETY: COM calls on the webview's own thread, as `with_webview` guarantees.
    unsafe {
        let webview = controller.CoreWebView2()?;
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, json| {
            done(if result.is_ok() { json } else { "null".into() });
            Ok(())
        }));
        webview.ExecuteScript(&HSTRING::from(script), &handler)
    }
}

/// Prints the loaded page to `path`; `done` tells whether the file was written.
pub fn print_to_pdf(
    controller: &ICoreWebView2Controller,
    environment: &ICoreWebView2Environment,
    path: &str,
    page: &PageInches,
    done: impl FnOnce(bool) + 'static,
) -> windows::core::Result<()> {
    // SAFETY: as above.
    unsafe {
        let settings = environment.cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
        settings.SetPageWidth(page.width)?;
        settings.SetPageHeight(page.height)?;
        settings.SetMarginTop(0.0)?;
        settings.SetMarginBottom(0.0)?;
        settings.SetMarginLeft(0.0)?;
        settings.SetMarginRight(0.0)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        settings.SetShouldPrintSelectionOnly(false)?;
        let webview = controller.CoreWebView2()?.cast::<ICoreWebView2_7>()?;
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            done(result.is_ok() && ok);
            Ok(())
        }));
        webview.PrintToPdf(&HSTRING::from(path), &settings, &handler)
    }
}
