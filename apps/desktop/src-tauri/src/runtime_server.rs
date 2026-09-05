use std::path::Path;

use serde::{Deserialize, Serialize};
use url::Url;

pub(super) const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:4174";
const SETTINGS_FILE: &str = "server.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ServerSettings {
    mode: ServerMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_base_url: Option<String>,
    /// The bearer token to send when the server requires `MONO_API_TOKEN` in remote mode. Not sent if absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    api_token: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(super) enum ServerMode {
    Embedded,
    Remote,
}

/// The raw contents of `server.json`. Treated as embedded if the file doesn't exist. Represents the
/// setting that will apply "on the next launch", not the currently running server.
#[derive(Debug, PartialEq)]
pub(super) struct StoredConnection {
    pub(super) mode: ServerMode,
    pub(super) remote_url: String,
    /// The stored bearer token. An empty string if none.
    pub(super) remote_token: String,
}

#[derive(Debug, PartialEq)]
pub(super) struct RuntimeServer {
    api_base_url: String,
    api_token: Option<String>,
    embedded: bool,
    env_override: bool,
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
            let token = std::env::var("MONO_API_TOKEN")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let mut server = Self::remote(api_base_url, token)?;
            server.env_override = true;
            return Ok(server);
        }

        let settings_path = app_data_directory.join(SETTINGS_FILE);
        if !settings_path.exists() {
            return Ok(Self::embedded());
        }

        let settings = read_settings_file(&settings_path)?;
        match (settings.mode, settings.api_base_url) {
            (ServerMode::Embedded, None) => Ok(Self::embedded()),
            (ServerMode::Embedded, Some(_)) => {
                Err("embedded 모드에는 apiBaseUrl을 지정할 수 없습니다.".into())
            }
            (ServerMode::Remote, Some(api_base_url)) => {
                Self::remote(&api_base_url, normalize_token(settings.api_token))
            }
            (ServerMode::Remote, None) => Err("remote 모드에는 apiBaseUrl이 필요합니다.".into()),
        }
    }

    fn embedded() -> Self {
        Self {
            api_base_url: DEFAULT_API_BASE_URL.into(),
            api_token: None,
            embedded: true,
            env_override: false,
        }
    }

    fn remote(value: &str, token: Option<String>) -> Result<Self, String> {
        Ok(Self {
            api_base_url: normalize_remote_url(value)?,
            api_token: token,
            embedded: false,
            env_override: false,
        })
    }

    pub(super) fn api_base_url(&self) -> &str {
        &self.api_base_url
    }

    pub(super) fn api_token(&self) -> Option<&str> {
        self.api_token.as_deref()
    }

    pub(super) fn uses_embedded_server(&self) -> bool {
        self.embedded
    }

    pub(super) fn env_override(&self) -> bool {
        self.env_override
    }
}

/// Reads the currently stored `server.json`. Treated as embedded if the file doesn't exist. An error if the format is malformed.
pub(super) fn read_stored_connection(app_data_directory: &Path) -> Result<StoredConnection, String> {
    let settings_path = app_data_directory.join(SETTINGS_FILE);
    if !settings_path.exists() {
        return Ok(StoredConnection {
            mode: ServerMode::Embedded,
            remote_url: String::new(),
            remote_token: String::new(),
        });
    }
    let settings = read_settings_file(&settings_path)?;
    Ok(StoredConnection {
        mode: settings.mode,
        remote_url: settings.api_base_url.unwrap_or_default(),
        remote_token: normalize_token(settings.api_token).unwrap_or_default(),
    })
}

/// A whitespace-only or empty token is treated as "none".
fn normalize_token(value: Option<String>) -> Option<String> {
    value
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

/// Atomically replaces `server.json` (temp file → rename). The remote address is
/// normalized and validated before saving. The return value is the normalized connection setting actually written to the file.
pub(super) fn write_stored_connection(
    app_data_directory: &Path,
    mode: ServerMode,
    remote_url: Option<&str>,
    api_token: Option<&str>,
) -> Result<StoredConnection, String> {
    let settings = match mode {
        ServerMode::Embedded => ServerSettings {
            mode: ServerMode::Embedded,
            api_base_url: None,
            api_token: None,
        },
        ServerMode::Remote => {
            let raw = remote_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or("원격 서버 주소를 입력해야 합니다.")?;
            ServerSettings {
                mode: ServerMode::Remote,
                api_base_url: Some(normalize_remote_url(raw)?),
                api_token: normalize_token(api_token.map(str::to_string)),
            }
        }
    };

    let body = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("서버 설정을 직렬화하지 못했습니다: {error}"))?;

    let final_path = app_data_directory.join(SETTINGS_FILE);
    let temp_path = app_data_directory.join(format!("{SETTINGS_FILE}.{}.tmp", std::process::id()));
    std::fs::write(&temp_path, format!("{body}\n"))
        .map_err(|error| format!("서버 설정을 저장하지 못했습니다: {error}"))?;
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        format!("서버 설정을 교체하지 못했습니다: {error}")
    })?;

    Ok(StoredConnection {
        mode: settings.mode,
        remote_url: settings.api_base_url.unwrap_or_default(),
        remote_token: settings.api_token.unwrap_or_default(),
    })
}

/// The `api_base_url` the stored setting would produce on the next launch. Used to determine whether a restart is needed.
pub(super) fn target_api_base_url(stored: &StoredConnection) -> Result<String, String> {
    match stored.mode {
        ServerMode::Embedded => Ok(DEFAULT_API_BASE_URL.to_string()),
        ServerMode::Remote => normalize_remote_url(&stored.remote_url),
    }
}

fn read_settings_file(settings_path: &Path) -> Result<ServerSettings, String> {
    let raw = std::fs::read_to_string(settings_path).map_err(|error| {
        format!(
            "서버 설정을 읽지 못했습니다({}): {error}",
            settings_path.display()
        )
    })?;
    serde_json::from_str(&raw).map_err(|error| {
        format!(
            "서버 설정 형식이 잘못되었습니다({}): {error}",
            settings_path.display()
        )
    })
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
            RuntimeServer::load_with_override(&directory, Some("https://mono.example.com")).unwrap();
        assert_eq!(config.api_base_url(), "https://mono.example.com");
        assert!(!config.uses_embedded_server());
        assert!(config.env_override());
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

    #[test]
    fn writes_then_reads_remote_connection_in_normalized_form() {
        let directory = test_directory("write-remote");
        let written = write_stored_connection(
            &directory,
            ServerMode::Remote,
            Some("  http://100.80.12.34:4174/  "),
            Some("  s3cr3t  "),
        )
        .unwrap();
        assert_eq!(written.mode, ServerMode::Remote);
        assert_eq!(written.remote_url, "http://100.80.12.34:4174");
        assert_eq!(written.remote_token, "s3cr3t");

        let stored = read_stored_connection(&directory).unwrap();
        assert_eq!(stored, written);

        // The file reloads as a valid RuntimeServer.
        let config = RuntimeServer::load_with_override(&directory, None).unwrap();
        assert_eq!(config.api_base_url(), "http://100.80.12.34:4174");
        assert_eq!(config.api_token(), Some("s3cr3t"));
        assert!(!config.uses_embedded_server());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn writing_embedded_removes_remote_url_and_token() {
        let directory = test_directory("write-embedded");
        write_stored_connection(
            &directory,
            ServerMode::Remote,
            Some("https://mono.example.com"),
            Some("s3cr3t"),
        )
        .unwrap();
        let stored = write_stored_connection(&directory, ServerMode::Embedded, None, None).unwrap();
        assert_eq!(stored.mode, ServerMode::Embedded);
        assert_eq!(stored.remote_url, "");
        assert_eq!(stored.remote_token, "");
        assert_eq!(target_api_base_url(&stored).unwrap(), DEFAULT_API_BASE_URL);

        let raw = std::fs::read_to_string(directory.join(SETTINGS_FILE)).unwrap();
        assert!(!raw.contains("apiBaseUrl"));
        assert!(!raw.contains("apiToken"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn remote_without_token_is_allowed_and_omits_the_field() {
        let directory = test_directory("write-no-token");
        let written =
            write_stored_connection(&directory, ServerMode::Remote, Some("https://mono.example.com"), None)
                .unwrap();
        assert_eq!(written.remote_token, "");
        let raw = std::fs::read_to_string(directory.join(SETTINGS_FILE)).unwrap();
        assert!(!raw.contains("apiToken"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_saving_remote_without_or_with_bad_url() {
        let directory = test_directory("write-bad");
        assert!(write_stored_connection(&directory, ServerMode::Remote, None, None).is_err());
        assert!(write_stored_connection(&directory, ServerMode::Remote, Some("   "), None).is_err());
        assert!(
            write_stored_connection(&directory, ServerMode::Remote, Some("ftp://host:4174"), None)
                .is_err()
        );
        // A failed save does not create the file.
        assert!(!directory.join(SETTINGS_FILE).exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
