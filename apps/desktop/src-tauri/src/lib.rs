mod api_sidecar;
mod media_store;

use api_sidecar::ApiSidecar;
use media_store::SqliteMediaStore;
use tauri::Manager;

// 앱 상태 원본은 API 서버 SQLite다(architecture-decisions.md §9). Rust가 다루는 로컬 저장소는
// 사진·영상 바이트뿐이다 — 상태 blob용 load/save 커맨드는 HTTP 저장소 전환과 함께 제거했다.

#[tauri::command]
fn save_media(
    store: tauri::State<'_, SqliteMediaStore>,
    id: String,
    data_url: String,
) -> Result<(), String> {
    store.save_media(&id, &data_url)
}

#[tauri::command]
fn load_media(
    store: tauri::State<'_, SqliteMediaStore>,
    id: String,
) -> Result<Option<String>, String> {
    store.load_media(&id)
}

#[tauri::command]
fn delete_media(store: tauri::State<'_, SqliteMediaStore>, id: String) -> Result<(), String> {
    store.delete_media(&id)
}

#[tauri::command]
fn orphan_media_stats(
    store: tauri::State<'_, SqliteMediaStore>,
    keep_ids: Vec<String>,
) -> Result<(i64, i64), String> {
    store.orphan_media_stats(&keep_ids)
}

#[tauri::command]
fn gc_media(
    store: tauri::State<'_, SqliteMediaStore>,
    keep_ids: Vec<String>,
) -> Result<usize, String> {
    store.gc_media(&keep_ids)
}

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

            let store = SqliteMediaStore::open(&data_directory.join("mono.sqlite3"))?;
            app.manage(store);

            let sidecar = ApiSidecar::spawn(
                &data_directory.join("mono.sqlite"),
                &data_directory.join("mono.secret.key"),
            );
            app.manage(sidecar);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_media,
            load_media,
            delete_media,
            orphan_media_stats,
            gc_media
        ])
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
