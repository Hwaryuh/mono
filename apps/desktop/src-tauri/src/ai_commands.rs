use crate::gemini::{
    inline_image_of, AiProvider, CaptureAnalysisRequest, CaptureAnalysisResult, GeminiProvider,
    ProviderRequest,
};
use crate::platform_state_store::SqlitePlatformStateStore;
use crate::secret_store::{CredentialSecretStore, SecretStore};

#[tauri::command]
pub fn set_gemini_api_key(
    secret_store: tauri::State<'_, CredentialSecretStore>,
    api_key: String,
) -> Result<(), String> {
    secret_store.set_gemini_api_key(&api_key)
}

#[tauri::command]
pub fn has_gemini_api_key(
    secret_store: tauri::State<'_, CredentialSecretStore>,
) -> Result<bool, String> {
    secret_store.has_gemini_api_key()
}

#[tauri::command]
pub fn delete_gemini_api_key(
    secret_store: tauri::State<'_, CredentialSecretStore>,
) -> Result<(), String> {
    secret_store.delete_gemini_api_key()
}

#[tauri::command]
pub async fn test_gemini_connection(
    secret_store: tauri::State<'_, CredentialSecretStore>,
    provider: tauri::State<'_, GeminiProvider>,
) -> Result<(), String> {
    let api_key = secret_store.gemini_api_key()?;
    provider.test_connection(&api_key).await
}

#[tauri::command]
pub async fn analyze_capture(
    request: CaptureAnalysisRequest,
    secret_store: tauri::State<'_, CredentialSecretStore>,
    provider: tauri::State<'_, GeminiProvider>,
    platform_store: tauri::State<'_, SqlitePlatformStateStore>,
) -> Result<CaptureAnalysisResult, String> {
    let api_key = secret_store.gemini_api_key()?;
    let images = request
        .images
        .into_iter()
        .map(|image| {
            let data_url = platform_store
                .load_media(&image.media_id)?
                .ok_or_else(|| format!("이미지 원본을 찾을 수 없습니다: {}", image.media_id))?;
            inline_image_of(&data_url, &image.mime_type)
        })
        .collect::<Result<Vec<_>, String>>()?;
    provider
        .analyze(
            &api_key,
            ProviderRequest {
                raw: request.raw,
                images,
            },
        )
        .await
}
