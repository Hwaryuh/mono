use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

mod alarm;
mod runtime_server;

use alarm::Alarm;
use runtime_server::{RuntimeServer, ServerMode, StoredConnection};

/// The API connection the running app actually uses. Decided once in `setup` and never changes —
/// changing the setting only updates `server.json`; it takes effect starting from the next launch.
struct RunningServer {
    api_base_url: String,
    api_token: Option<String>,
    embedded: bool,
    env_override: bool,
    data_directory: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerConnectionDto {
    /// The mode stored in `server.json` ("embedded" | "remote").
    mode: &'static str,
    /// The stored remote address. An empty string if embedded or unset.
    remote_url: String,
    /// The stored bearer token. An empty string if none.
    remote_token: String,
    /// The address the currently running app uses.
    effective_api_base_url: String,
    /// Whether the currently running app started the embedded server.
    running_embedded: bool,
    /// Whether the `MONO_API_BASE_URL` environment variable is set, overriding the file-based setting.
    env_override: bool,
    /// Whether the setting can be changed from this screen (false when overridden by an environment variable).
    manageable: bool,
    /// Whether the stored setting differs from the running connection, requiring a restart to apply.
    restart_required: bool,
}

fn describe_connection(running: &RunningServer) -> Result<ServerConnectionDto, String> {
    let stored = runtime_server::read_stored_connection(&running.data_directory)?;
    let running_token = running.api_token.clone().unwrap_or_default();
    let restart_required = if running.env_override {
        false
    } else {
        runtime_server::target_api_base_url(&stored)? != running.api_base_url
            || stored.remote_token != running_token
    };
    Ok(ServerConnectionDto {
        mode: match stored.mode {
            ServerMode::Embedded => "embedded",
            ServerMode::Remote => "remote",
        },
        remote_token: stored.remote_token,
        remote_url: stored.remote_url,
        effective_api_base_url: running.api_base_url.clone(),
        running_embedded: running.embedded,
        env_override: running.env_override,
        manageable: !running.env_override,
        restart_required,
    })
}

#[tauri::command]
fn server_api_base_url(state: tauri::State<'_, RunningServer>) -> String {
    state.api_base_url.clone()
}

#[tauri::command]
fn server_api_token(state: tauri::State<'_, RunningServer>) -> String {
    state.api_token.clone().unwrap_or_default()
}

#[tauri::command]
fn server_connection(state: tauri::State<'_, RunningServer>) -> Result<ServerConnectionDto, String> {
    describe_connection(&state)
}

#[tauri::command]
fn save_server_connection(
    state: tauri::State<'_, RunningServer>,
    mode: String,
    api_base_url: Option<String>,
    api_token: Option<String>,
) -> Result<ServerConnectionDto, String> {
    if state.env_override {
        return Err(
            "MONO_API_BASE_URL 환경 변수가 설정되어 있어 이 화면에서 서버 설정을 바꿀 수 없습니다."
                .into(),
        );
    }
    let mode = match mode.as_str() {
        "embedded" => ServerMode::Embedded,
        "remote" => ServerMode::Remote,
        other => return Err(format!("알 수 없는 서버 모드입니다: {other}")),
    };
    let _: StoredConnection = runtime_server::write_stored_connection(
        &state.data_directory,
        mode,
        api_base_url.as_deref(),
        api_token.as_deref(),
    )?;
    describe_connection(&state)
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Saves media (photos/files) to a path the user chooses. Returns false if canceled.
/// The webview's <a download> lands only in the Downloads folder without a path picker on macOS, so this handles it instead.
#[tauri::command]
async fn save_media_file(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // An async command doesn't run on the main thread, so it's fine to use a blocking dialog.
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| error.to_string())?;
    std::fs::write(&path, &bytes).map_err(|error| format!("파일 저장 실패: {error}"))?;
    Ok(true)
}

// The app's source of truth is the API server's SQLite (architecture-decisions.md §9).
// Embedded mode: mono_api::spawn occupies 127.0.0.1:4174 — runs standalone without a separate server.
// Multi-device sharing: run the crates/mono-api standalone binary on a home server/VPS and
// point at it via server.json (Settings > Server) or MONO_API_BASE_URL.

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    // Auto-update is desktop-only. Mobile targets don't have the updater/process plugins.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .manage(Alarm::spawn())
        .invoke_handler(tauri::generate_handler![
            server_api_base_url,
            server_api_token,
            server_connection,
            save_server_connection,
            restart_app,
            save_media_file,
            alarm::alarm_start,
            alarm::alarm_stop
        ])
        .setup(|app| {
            let data_directory = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("앱 데이터 경로 확인 실패: {error}"))?;
            std::fs::create_dir_all(&data_directory)
                .map_err(|error| format!("앱 데이터 디렉터리 생성 실패: {error}"))?;

            let server = RuntimeServer::load(&data_directory)?;
            if server.uses_embedded_server() {
                // The embedded API server. mono.secret.key is the master key for decrypting secrets (§5).
                mono_api::spawn(
                    data_directory.join("mono.sqlite"),
                    data_directory.join("mono.secret.key"),
                );
            } else {
                eprintln!("mono-desktop: remote API {}", server.api_base_url());
            }
            app.manage(RunningServer {
                api_base_url: server.api_base_url().to_string(),
                api_token: server.api_token().map(str::to_string),
                embedded: server.uses_embedded_server(),
                env_override: server.env_override(),
                data_directory,
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 데스크톱 앱 빌드 실패");

    app.run(|_app_handle, _event| {});
}
