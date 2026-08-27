use tauri::Manager;

// 앱 상태 원본은 API 서버의 SQLite다(architecture-decisions.md §9).
// 임베드 모드: mono_api::spawn이 127.0.0.1:4174를 점유한다 — 서버 없이도 단독 실행.
// 멀티 기기 공유: crates/mono-api의 standalone 바이너리를 홈서버/VPS에서 돌리고
// VITE_API_BASE_URL로 그쪽을 가리킨다.

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
            mono_api::spawn(
                data_directory.join("mono.sqlite"),
                data_directory.join("mono.secret.key"),
            );

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 데스크톱 앱 빌드 실패");

    app.run(|_app_handle, _event| {});
}
