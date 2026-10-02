//! Errors returned to the frontend: a stable `kind` it can explain to the user,
//! plus the raw message for logs.

use std::io;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// Another program holds the file (sharing or lock violation).
    Locked,
    PermissionDenied,
    DiskFull,
    ReadOnly,
    NotFound,
    AlreadyExists,
    InvalidName,
    Other,
}

#[derive(Debug, Serialize)]
pub struct CmdError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type CmdResult<T> = Result<T, CmdError>;

impl CmdError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn other(message: impl std::fmt::Display) -> Self {
        Self::new(ErrorKind::Other, message.to_string())
    }
}

pub fn io_kind(e: &io::Error) -> ErrorKind {
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    if cfg!(windows) && matches!(e.raw_os_error(), Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION)) {
        return ErrorKind::Locked;
    }
    match e.kind() {
        io::ErrorKind::ResourceBusy => ErrorKind::Locked,
        io::ErrorKind::PermissionDenied => ErrorKind::PermissionDenied,
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => ErrorKind::DiskFull,
        io::ErrorKind::ReadOnlyFilesystem => ErrorKind::ReadOnly,
        io::ErrorKind::NotFound => ErrorKind::NotFound,
        io::ErrorKind::AlreadyExists => ErrorKind::AlreadyExists,
        _ => ErrorKind::Other,
    }
}

impl From<io::Error> for CmdError {
    fn from(e: io::Error) -> Self {
        Self::new(io_kind(&e), e.to_string())
    }
}

impl<T> From<std::sync::PoisonError<T>> for CmdError {
    fn from(e: std::sync::PoisonError<T>) -> Self {
        Self::other(e)
    }
}

impl From<tauri::Error> for CmdError {
    fn from(e: tauri::Error) -> Self {
        Self::other(e)
    }
}
