mod api_sidecar;

use api_sidecar::ApiSidecar;
use tauri::Manager;

// 앱 상태 원본은 API 서버 SQLite다(architecture-decisions.md §9). 사진·영상 바이트도 이제 API
// 서버를 거쳐 R2에 저장된다 — Rust는 사이드카를 띄우는 것 외에 로컬 저장소를 다루지 않는다.

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
            );
            app.manage(sidecar);

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
