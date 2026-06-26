//! HTTP route handlers for all Bullarchy commands.

use axum::{Json, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ── Response type ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CommandResult {
    pub ok:     bool,
    pub output: String,
}

fn ok(output: String) -> Json<CommandResult> {
    Json(CommandResult { ok: true, output })
}

// ── Output capture ────────────────────────────────────────────────────────────
//
// Redirects fd 1 & 2 to a pipe for the duration of the closure, then reads
// everything back.  Must be called from a blocking thread (spawn_blocking).

fn capture<F: FnOnce() + Send + 'static>(f: F) -> String {
    let (reader, writer) = os_pipe::pipe().unwrap();
    let writer2 = writer.try_clone().unwrap();

    let old_stdout = redirect_fd(1, &writer);
    let old_stderr = redirect_fd(2, &writer2);
    drop(writer);
    drop(writer2);

    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok();

    restore_fd(1, old_stdout);
    restore_fd(2, old_stderr);

    let mut buf = String::new();
    use std::io::Read;
    let mut r = reader;
    let _ = r.read_to_string(&mut buf);
    buf
}

#[cfg(unix)]
fn redirect_fd(fd: i32, writer: &os_pipe::PipeWriter) -> i32 {
    use std::os::unix::io::AsRawFd;
    unsafe {
        let old = libc::dup(fd);
        libc::dup2(writer.as_raw_fd(), fd);
        old
    }
}

#[cfg(unix)]
fn restore_fd(fd: i32, old: i32) {
    unsafe { libc::dup2(old, fd); libc::close(old); }
}

#[cfg(windows)]
fn redirect_fd(_fd: i32, _writer: &os_pipe::PipeWriter) -> i32 { -1 }
#[cfg(windows)]
fn restore_fd(_fd: i32, _old: i32) {}

// ── /api/init ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InitRequest {
    pub name:      String,
    pub depth:     Option<u8>,
    pub lang:      Option<String>,
    pub libs:      Option<Vec<String>>,
    pub blueprint: Option<String>,
    pub path:      Option<String>,
}

pub async fn handle_init(Json(req): Json<InitRequest>) -> impl IntoResponse {
    let name      = req.name.clone();
    let depth     = req.depth.unwrap_or(2);
    let lang      = req.lang.clone();
    let libs      = req.libs.unwrap_or_default();
    let blueprint = req.blueprint.map(PathBuf::from);
    let path      = req.path.map(PathBuf::from);

    let output = tokio::task::spawn_blocking(move || {
        capture(move || { crate::cmd::cmd_init(name, depth, blueprint, lang, libs, path); })
    }).await.unwrap_or_default();

    ok(output)
}

// ── /api/convert ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ConvertRequest {
    pub target: Option<String>,
    pub second: Option<String>,
}

pub async fn handle_convert(Json(req): Json<ConvertRequest>) -> impl IntoResponse {
    let target = req.target.map(PathBuf::from);
    let second = req.second.clone();

    let output = tokio::task::spawn_blocking(move || {
        capture(move || { crate::cmd::cmd_convert(target, second); })
    }).await.unwrap_or_default();

    ok(output)
}

// ── /api/fmt ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct FmtRequest {
    pub folder:  Option<String>,
    pub dry_run: Option<bool>,
}

pub async fn handle_fmt(Json(req): Json<FmtRequest>) -> impl IntoResponse {
    let folder  = req.folder.map(PathBuf::from);
    let dry_run = req.dry_run.unwrap_or(false);

    let output = tokio::task::spawn_blocking(move || {
        capture(move || { crate::cmd::cmd_fmt(folder, dry_run); })
    }).await.unwrap_or_default();

    ok(output)
}

// ── /api/check ────────────────────────────────────────────────────────────────

pub async fn handle_check() -> impl IntoResponse {
    let output = tokio::task::spawn_blocking(|| {
        capture(|| { crate::cmd::cmd_check(); })
    }).await.unwrap_or_default();

    ok(output)
}

// ── /api/editor-setup ─────────────────────────────────────────────────────────

pub async fn handle_editor_setup() -> impl IntoResponse {
    let output = tokio::task::spawn_blocking(|| {
        capture(|| { crate::cmd::cmd_editor_setup(); })
    }).await.unwrap_or_default();

    ok(output)
}

// ── /api/update ───────────────────────────────────────────────────────────────
//
// `cargo install` is a long-running subprocess — we cannot capture it via
// the fd-redirect trick because the pipe would fill and block before the
// process finishes.  Instead we run it with stdout/stderr piped directly
// and collect the output after it exits.

pub async fn handle_update() -> impl IntoResponse {
    let output = tokio::task::spawn_blocking(|| {
        capture(|| { crate::cmd::cmd_update(); })
    }).await.unwrap_or_default();

    ok(output)
}

// ── /api/add ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddRequest {
    pub source: String,
}

pub async fn handle_add(Json(req): Json<AddRequest>) -> impl IntoResponse {
    let source = req.source.trim().to_string();
    let output = tokio::task::spawn_blocking(move || {
        capture(move || {
            let args: Vec<&str> = if source.is_empty() {
                vec![]
            } else {
                vec![source.as_str()]
            };
            // Leak source into 'static for the closure — safe because capture()
            // waits for the closure to finish before returning.
            let args_static: Vec<&'static str> = args
                .into_iter()
                .map(|s| Box::leak(s.to_string().into_boxed_str()) as &'static str)
                .collect();
            crate::cmd::cmd_add(&args_static);
        })
    })
    .await
    .unwrap_or_default();
    ok(output)
}

// ── /api/remove ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RemoveRequest {
    pub name: String,
}

pub async fn handle_remove(Json(req): Json<RemoveRequest>) -> impl IntoResponse {
    let name = req.name.trim().to_string();
    let output = tokio::task::spawn_blocking(move || {
        capture(move || {
            let name_static: &'static str =
                Box::leak(name.into_boxed_str());
            crate::cmd::cmd_remove(&[name_static]);
        })
    })
    .await
    .unwrap_or_default();
    ok(output)
}

// ── /api/blueprint/save ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct BlueprintSaveRequest {
    pub path:    String,
    pub content: String,
}

#[derive(Serialize)]
pub struct SaveResult {
    pub ok:    bool,
    pub error: Option<String>,
}

pub async fn handle_blueprint_save(Json(req): Json<BlueprintSaveRequest>) -> impl IntoResponse {
    let path = PathBuf::from(&req.path);

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(SaveResult { ok: false, error: Some(e.to_string()) });
        }
    }

    match std::fs::write(&path, &req.content) {
        Ok(_)  => Json(SaveResult { ok: true, error: None }),
        Err(e) => Json(SaveResult { ok: false, error: Some(e.to_string()) }),
    }
}
