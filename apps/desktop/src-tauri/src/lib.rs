mod api;

use tauri::Manager;

// 앱 상태 원본은 임베드 API 서버의 SQLite다(architecture-decisions.md §9).
// axum 서버(mod api)가 127.0.0.1:4174를 점유한다 — 전 경계 Rust 네이티브(Option C 완료).

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

            // 임베드 API 서버. mono.secret.key는 비밀 복호화 마스터 키(§5).
            api::spawn(
                data_directory.join("mono.sqlite"),
                data_directory.join("mono.secret.key"),
            );

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 데스크톱 앱 빌드 실패");

    app.run(|_app_handle, _event| {});
}
