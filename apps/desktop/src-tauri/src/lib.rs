use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

mod alarm;
mod runtime_server;

use alarm::Alarm;
use runtime_server::{RuntimeServer, ServerMode, StoredConnection};

/// 실행 중인 앱이 실제로 사용하는 API 연결. `setup`에서 한 번 결정되고 바뀌지 않는다 —
/// 설정을 바꾸면 `server.json`만 갱신되고, 적용은 다음 실행부터다.
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
    /// `server.json`에 저장된 모드("embedded" | "remote").
    mode: &'static str,
    /// 저장된 원격 주소. embedded이거나 미설정이면 빈 문자열.
    remote_url: String,
    /// 저장된 베어러 토큰. 없으면 빈 문자열.
    remote_token: String,
    /// 지금 실행 중인 앱이 사용하는 주소.
    effective_api_base_url: String,
    /// 지금 실행 중인 앱이 임베드 서버를 켰는지.
    running_embedded: bool,
    /// `MONO_API_BASE_URL` 환경 변수가 설정되어 파일 설정이 무시되는 상태.
    env_override: bool,
    /// 이 화면에서 설정을 바꿀 수 있는지(환경 변수 override 시 false).
    manageable: bool,
    /// 저장된 설정과 실행 중인 연결이 달라, 적용하려면 재시작이 필요한지.
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

/// 미디어(사진·파일)를 사용자가 고른 경로에 저장한다. 취소하면 false.
/// 웹뷰의 <a download>는 macOS에서 경로 선택 없이 다운로드 폴더로만 떨어져서, 여기서 처리한다.
#[tauri::command]
async fn save_media_file(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // async 커맨드는 메인 스레드가 아니므로 blocking 대화상자를 써도 된다.
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| error.to_string())?;
    std::fs::write(&path, &bytes).map_err(|error| format!("파일 저장 실패: {error}"))?;
    Ok(true)
}

// 앱 상태 원본은 API 서버의 SQLite다(architecture-decisions.md §9).
// 임베드 모드: mono_api::spawn이 127.0.0.1:4174를 점유한다 — 서버 없이도 단독 실행.
// 멀티 기기 공유: crates/mono-api의 standalone 바이너리를 홈서버/VPS에서 돌리고
// server.json(설정 > 서버) 또는 MONO_API_BASE_URL로 그쪽을 가리킨다.

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    // 자동 업데이트는 데스크톱 전용. 모바일 타깃에는 updater/process 플러그인이 없다.
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
                // 임베드 API 서버. mono.secret.key는 비밀 복호화 마스터 키(§5).
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
