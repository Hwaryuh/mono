use std::path::Path;

use serde::Deserialize;
use url::Url;

const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:4174";
const SETTINGS_FILE: &str = "server.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ServerSettings {
    mode: ServerMode,
    api_base_url: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ServerMode {
    Embedded,
    Remote,
}

#[derive(Debug, PartialEq)]
pub(super) struct RuntimeServer {
    api_base_url: String,
    embedded: bool,
}

impl RuntimeServer {
    pub(super) fn load(app_data_directory: &Path) -> Result<Self, String> {
        Self::load_with_override(
            app_data_directory,
            std::env::var("MONO_API_BASE_URL").ok().as_deref(),
        )
    }

    fn load_with_override(
        app_data_directory: &Path,
        environment_api_base_url: Option<&str>,
    ) -> Result<Self, String> {
        if let Some(api_base_url) = environment_api_base_url {
            return Ok(Self::remote(api_base_url)?);
        }

        let settings_path = app_data_directory.join(SETTINGS_FILE);
        if !settings_path.exists() {
            return Ok(Self::embedded());
        }

        let raw = std::fs::read_to_string(&settings_path).map_err(|error| {
            format!(
                "서버 설정을 읽지 못했습니다({}): {error}",
                settings_path.display()
            )
        })?;
        let settings: ServerSettings = serde_json::from_str(&raw).map_err(|error| {
            format!(
                "서버 설정 형식이 잘못되었습니다({}): {error}",
                settings_path.display()
            )
        })?;

        match (settings.mode, settings.api_base_url) {
            (ServerMode::Embedded, None) => Ok(Self::embedded()),
            (ServerMode::Embedded, Some(_)) => {
                Err("embedded 모드에는 apiBaseUrl을 지정할 수 없습니다.".into())
            }
            (ServerMode::Remote, Some(api_base_url)) => Self::remote(&api_base_url),
            (ServerMode::Remote, None) => Err("remote 모드에는 apiBaseUrl이 필요합니다.".into()),
        }
    }

    fn embedded() -> Self {
        Self {
            api_base_url: DEFAULT_API_BASE_URL.into(),
            embedded: true,
        }
    }

    fn remote(value: &str) -> Result<Self, String> {
        let api_base_url = normalize_remote_url(value)?;
        Ok(Self {
            api_base_url,
            embedded: false,
        })
    }

    pub(super) fn api_base_url(&self) -> &str {
        &self.api_base_url
    }

    pub(super) fn uses_embedded_server(&self) -> bool {
        self.embedded
    }
}

fn normalize_remote_url(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value.trim())
        .map_err(|error| format!("원격 API 주소가 올바른 URL이 아닙니다: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("원격 API 주소는 http 또는 https만 사용할 수 있습니다.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("원격 API 주소에 사용자 이름이나 비밀번호를 포함할 수 없습니다.".into());
    }
    if url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return Err("원격 API 주소에는 경로, 쿼리 또는 fragment를 포함할 수 없습니다.".into());
    }

    let port = url.port_or_known_default();
    let allowed_port = match url.scheme() {
        "http" => port == Some(4174),
        "https" => matches!(port, Some(443 | 4174)),
        _ => false,
    };
    if !allowed_port {
        return Err("원격 API는 HTTP 4174 또는 HTTPS 443/4174 포트를 사용해야 합니다.".into());
    }

    url.set_path("");
    Ok(url.to_string().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mono-runtime-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn absent_settings_use_embedded_server() {
        let directory = test_directory("default");
        let config = RuntimeServer::load_with_override(&directory, None).unwrap();
        assert_eq!(config, RuntimeServer::embedded());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn remote_settings_disable_embedded_server() {
        let directory = test_directory("remote");
        std::fs::write(
            directory.join(SETTINGS_FILE),
            r#"{"mode":"remote","apiBaseUrl":"http://mono-server:4174/"}"#,
        )
        .unwrap();

        let config = RuntimeServer::load_with_override(&directory, None).unwrap();
        assert_eq!(config.api_base_url(), "http://mono-server:4174");
        assert!(!config.uses_embedded_server());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn environment_override_wins_over_file() {
        let directory = test_directory("override");
        std::fs::write(directory.join(SETTINGS_FILE), r#"{"mode":"embedded"}"#).unwrap();

        let config =
            RuntimeServer::load_with_override(&directory, Some("https://mono.example.com"))
                .unwrap();
        assert_eq!(config.api_base_url(), "https://mono.example.com");
        assert!(!config.uses_embedded_server());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_public_http_port_and_url_path() {
        let directory = test_directory("invalid");
        assert!(
            RuntimeServer::load_with_override(&directory, Some("http://example.com:8080")).is_err()
        );
        assert!(
            RuntimeServer::load_with_override(&directory, Some("https://example.com/api")).is_err()
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
