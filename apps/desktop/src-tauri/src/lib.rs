mod api;
mod api_sidecar;

use api_sidecar::ApiSidecar;
use tauri::Manager;

// 앱 상태 원본은 API 서버 SQLite다(architecture-decisions.md §9). Node/Fastify API를 Rust로
// 이관하는 중(계획: Option C) — 임베드 axum 서버(mod api)가 127.0.0.1:4174를 점유하고,
// 아직 포팅 안 된 라우트는 Node sidecar(PORT 4175)로 프록시한다.

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_directory = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("앱 데이터 경로 확인 실패: {error}"))?;
            std::fs::create_dir_all(&data_directory)
                .map_err(|error| format!("앱 데이터 디렉터리 생성 실패: {error}"))?;

            let sidecar = ApiSidecar::spawn(
                &data_directory.join("mono.sqlite"),
                &data_directory.join("mono.secret.key"),
                &data_directory.join("sidecar"),
            );
            app.manage(sidecar);

            // 임베드 API 서버. 포팅된 경계는 네이티브, 나머지는 sidecar로 프록시.
            api::spawn(data_directory.join("mono.sqlite"));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 데스크톱 앱 빌드 실패");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(sidecar) = app_handle.try_state::<ApiSidecar>() {
                sidecar.shutdown();
            }
        }
    });
}
