const SERVICE: &str = "com.mono.platform.desktop";
const GEMINI_API_KEY_ACCOUNT: &str = "gemini-api-key";

pub trait SecretStore: Send + Sync {
    fn set_gemini_api_key(&self, api_key: &str) -> Result<(), String>;
    fn gemini_api_key(&self) -> Result<String, String>;
    fn has_gemini_api_key(&self) -> Result<bool, String>;
    fn delete_gemini_api_key(&self) -> Result<(), String>;
}

pub struct CredentialSecretStore;

impl CredentialSecretStore {
    pub fn of() -> Self {
        Self
    }

    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, GEMINI_API_KEY_ACCOUNT)
            .map_err(|error| format!("운영체제 보안 저장소를 열지 못했습니다: {error}"))
    }
}

impl SecretStore for CredentialSecretStore {
    fn set_gemini_api_key(&self, api_key: &str) -> Result<(), String> {
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            return Err("Gemini API 키를 입력해야 합니다.".to_owned());
        }
        self.entry()?
            .set_password(trimmed)
            .map_err(|error| format!("Gemini API 키를 보안 저장소에 저장하지 못했습니다: {error}"))
    }

    fn gemini_api_key(&self) -> Result<String, String> {
        self.entry()?.get_password().map_err(|error| match error {
            keyring::Error::NoEntry => "Gemini API 키가 설정되지 않았습니다.".to_owned(),
            other => format!("Gemini API 키를 보안 저장소에서 읽지 못했습니다: {other}"),
        })
    }

    fn has_gemini_api_key(&self) -> Result<bool, String> {
        match self.entry()?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(format!("Gemini API 키 상태를 확인하지 못했습니다: {error}")),
        }
    }

    fn delete_gemini_api_key(&self) -> Result<(), String> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Gemini API 키를 삭제하지 못했습니다: {error}")),
        }
    }
}
