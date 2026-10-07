//! PDF of an export page: a hidden window loads it from `ursa-export:`, waits
//! for its fonts and images, and WebView2 prints it (no dialog).

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::oneshot;

use super::webview2::{execute_script, print_to_pdf, PageInches};
use crate::error::{CmdError, CmdResult};

/// Label of the hidden window (left out of the saved window state, see `lib.rs`).
const WINDOW: &str = "export-pdf";
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);
/// True once the page's fonts and images are ready to be printed.
const READY: &str = "document.readyState === 'complete' && document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete)";

fn other(e: impl std::fmt::Display) -> CmdError {
    CmdError::other(e)
}

async fn within<T>(limit: Duration, what: &str, rx: oneshot::Receiver<T>) -> CmdResult<T> {
    tokio::time::timeout(limit, rx).await.map_err(|_| other(format!("PDF: {what} timed out")))?.map_err(|_| other(format!("PDF: {what} failed")))
}

async fn eval(window: &WebviewWindow, script: &'static str) -> CmdResult<String> {
    let (tx, rx) = oneshot::channel();
    window
        .with_webview(move |w| {
            if let Err(e) = execute_script(&w.controller(), script, move |json| {
                let _ = tx.send(json);
            }) {
                eprintln!("[ursa] export script: {e}");
            }
        })
        .map_err(other)?;
    within(READY_TIMEOUT, "script", rx).await
}

pub async fn print(app: &AppHandle, id: &str, path: &Path, (width, height): (f64, f64)) -> CmdResult<()> {
    let (loaded_tx, loaded_rx) = oneshot::channel::<()>();
    let loaded_tx = Arc::new(Mutex::new(Some(loaded_tx)));
    let url = format!("http://ursa-export.localhost/{id}").parse().map_err(other)?;
    // Same width as the page in CSS pixels: the layout is the printed one.
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::CustomProtocol(url))
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(width * 96.0, height * 96.0)
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(tx) = loaded_tx.lock().ok().and_then(|mut t| t.take()) {
                    let _ = tx.send(());
                }
            }
        })
        .build()
        .map_err(other)?;
    let result = async {
        within(LOAD_TIMEOUT, "page load", loaded_rx).await?;
        let start = std::time::Instant::now();
        while eval(&window, READY).await? != "true" {
            if start.elapsed() > READY_TIMEOUT {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let (tx, rx) = oneshot::channel();
        let target = path.to_string_lossy().into_owned();
        window
            .with_webview(move |w| {
                let page = PageInches { width, height };
                if let Err(e) = print_to_pdf(&w.controller(), &w.environment(), &target, &page, move |ok| {
                    let _ = tx.send(ok);
                }) {
                    eprintln!("[ursa] PrintToPdf: {e}");
                }
            })
            .map_err(other)?;
        if within(PRINT_TIMEOUT, "printing", rx).await? {
            Ok(())
        } else {
            Err(other("PDF: WebView2 could not print the page"))
        }
    }
    .await;
    let _ = window.destroy();
    result
}
