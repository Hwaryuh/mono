mod ai_commands;
mod gemini;
mod platform_state_store;
mod secret_store;

use ai_commands::{
    analyze_capture, delete_gemini_api_key, has_gemini_api_key, set_gemini_api_key,
    test_gemini_connection,
};
use gemini::GeminiProvider;
use platform_state_store::SqlitePlatformStateStore;
use secret_store::CredentialSecretStore;
use tauri::Manager;

#[tauri::command]
fn load_platform_state(
    store: tauri::State<'_, SqlitePlatformStateStore>,
) -> Result<Option<String>, String> {
    store.load()
}

#[tauri::command]
fn save_platform_state(
    store: tauri::State<'_, SqlitePlatformStateStore>,
    payload: String,
) -> Result<(), String> {
    store.save(&payload)
}

#[tauri::command]
fn save_media(
    store: tauri::State<'_, SqlitePlatformStateStore>,
    id: String,
    data_url: String,
) -> Result<(), String> {
    store.save_media(&id, &data_url)
}

#[tauri::command]
fn load_media(
    store: tauri::State<'_, SqlitePlatformStateStore>,
    id: String,
) -> Result<Option<String>, String> {
    store.load_media(&id)
}

#[tauri::command]
fn delete_media(
    store: tauri::State<'_, SqlitePlatformStateStore>,
    id: String,
) -> Result<(), String> {
    store.delete_media(&id)
}

#[tauri::command]
fn gc_media(
    store: tauri::State<'_, SqlitePlatformStateStore>,
    keep_ids: Vec<String>,
) -> Result<usize, String> {
    store.gc_media(&keep_ids)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_directory = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("앱 데이터 경로 확인 실패: {error}"))?;
            std::fs::create_dir_all(&data_directory)
                .map_err(|error| format!("앱 데이터 디렉터리 생성 실패: {error}"))?;
            let store = SqlitePlatformStateStore::open(&data_directory.join("mono.sqlite3"))?;
            app.manage(store);
            app.manage(CredentialSecretStore::of());
            app.manage(GeminiProvider::of()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_platform_state,
            save_platform_state,
            save_media,
            load_media,
            delete_media,
            gc_media,
            set_gemini_api_key,
            has_gemini_api_key,
            delete_gemini_api_key,
            test_gemini_connection,
            analyze_capture
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 데스크톱 앱 실행 실패");
}
