use std::path::Path;
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use axum::extract::{Path as AxumPath, State};
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::db::Db;
use super::error::{ApiError, ApiResult};

// apps/api/src/security/secret-crypto.ts + repositories/secret-store.ts 이식.
// 비밀은 DB엔 암호문만, 마스터 키는 별도 파일(mono.secret.key)로 분리한다(§5).

// ---------- hex ----------

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        out.push(char::from_digit((b & 0xf) as u32, 16).unwrap());
    }
    out
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

// ---------- 마스터 키 + AES-256-GCM ----------

pub(super) struct SecretCrypto {
    key: [u8; 32],
}

impl SecretCrypto {
    // 키 파일이 있으면 로드, 없으면 32바이트 생성해 hex로 기록(0o600).
    pub(super) fn load_or_create(path: &Path) -> std::io::Result<Self> {
        if path.exists() {
            let raw = std::fs::read_to_string(path)?;
            let bytes = decode_hex(raw.trim())
                .filter(|b| b.len() == 32)
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "잘못된 마스터 키"))?;
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(Self { key });
        }
        let mut key = [0u8; 32];
        getrandom::getrandom(&mut key)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "난수 생성 실패"))?;
        std::fs::write(path, encode_hex(&key))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(Self { key })
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key))
    }

    // iv(12) : tag(16) : ciphertext, 전부 hex. secret-crypto.ts 포맷 동일.
    fn encrypt(&self, plaintext: &str) -> String {
        let mut iv = [0u8; 12];
        getrandom::getrandom(&mut iv).expect("getrandom iv");
        let mut sealed = self
            .cipher()
            .encrypt(Nonce::from_slice(&iv), plaintext.as_bytes())
            .expect("aes-gcm encrypt");
        let tag = sealed.split_off(sealed.len() - 16);
        format!("{}:{}:{}", encode_hex(&iv), encode_hex(&tag), encode_hex(&sealed))
    }

    fn decrypt(&self, payload: &str) -> ApiResult<String> {
        let fail = || ApiError::Internal("비밀 값을 복호화하지 못했습니다.".into());
        let mut parts = payload.splitn(3, ':');
        let iv = parts.next().and_then(decode_hex).filter(|v| v.len() == 12).ok_or_else(fail)?;
        let tag = parts.next().and_then(decode_hex).ok_or_else(fail)?;
        let mut data = parts.next().and_then(decode_hex).ok_or_else(fail)?;
        data.extend_from_slice(&tag);
        let plain =
            self.cipher().decrypt(Nonce::from_slice(&iv), data.as_ref()).map_err(|_| fail())?;
        String::from_utf8(plain).map_err(|_| fail())
    }

    #[cfg(test)]
    pub(super) fn test_arc() -> Arc<Self> {
        Arc::new(Self { key: [7u8; 32] })
    }
}

// ---------- 저장소 (secret-store.ts) ----------

const ACTIVE_PROVIDER_KEY: &str = "active_ai_provider";
const R2_KEYS: [&str; 4] =
    ["r2_account_id", "r2_access_key_id", "r2_secret_access_key", "r2_bucket"];

fn provider_storage_key(provider: &str) -> ApiResult<&'static str> {
    match provider {
        "gemini" => Ok("gemini_api_key"),
        "openai" => Ok("openai_api_key"),
        _ => Err(ApiError::BadRequest("알 수 없는 AI provider입니다.".into())),
    }
}

fn provider_label(provider: &str) -> &'static str {
    if provider == "openai" { "OpenAI" } else { "Gemini" }
}

fn has_key(conn: &Connection, key: &str) -> ApiResult<bool> {
    Ok(conn.query_row("SELECT 1 FROM secrets WHERE key = ?1", [key], |_| Ok(())).optional()?.is_some())
}

fn set_key(conn: &Connection, crypto: &SecretCrypto, key: &str, value: &str) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO secrets (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, crypto.encrypt(value)],
    )?;
    Ok(())
}

fn delete_key(conn: &Connection, key: &str) -> ApiResult<()> {
    conn.execute("DELETE FROM secrets WHERE key = ?1", [key])?;
    Ok(())
}

fn set_plain(conn: &Connection, key: &str, value: &str) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO secrets (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn has_api_key(conn: &Connection, provider: &str) -> ApiResult<bool> {
    has_key(conn, provider_storage_key(provider)?)
}

// ai 경계 + dashboard capture가 쓴다 — 복호화한 API 키. 알 수 없는 provider면 BadRequest.
pub(super) fn get_api_key(
    conn: &Connection,
    crypto: &SecretCrypto,
    provider: &str,
) -> ApiResult<Option<String>> {
    let storage_key = provider_storage_key(provider)?;
    match conn
        .query_row("SELECT value FROM secrets WHERE key = ?1", [storage_key], |r| r.get::<_, String>(0))
        .optional()?
    {
        Some(enc) => Ok(Some(crypto.decrypt(&enc)?)),
        None => Ok(None),
    }
}

fn set_api_key(conn: &Connection, crypto: &SecretCrypto, provider: &str, api_key: &str) -> ApiResult<()> {
    let storage_key = provider_storage_key(provider)?;
    if api_key.trim().is_empty() {
        return Err(ApiError::BadRequest(format!(
            "{} API 키를 입력해야 합니다.",
            provider_label(provider)
        )));
    }
    set_key(conn, crypto, storage_key, api_key)
}

fn delete_api_key(conn: &Connection, provider: &str) -> ApiResult<()> {
    delete_key(conn, provider_storage_key(provider)?)
}

pub(super) fn get_active_provider(conn: &Connection) -> ApiResult<String> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM secrets WHERE key = ?1", [ACTIVE_PROVIDER_KEY], |row| row.get(0))
        .optional()?;
    Ok(if value.as_deref() == Some("openai") { "openai".into() } else { "gemini".into() })
}

fn set_active_provider(conn: &Connection, provider: &str) -> ApiResult<()> {
    provider_storage_key(provider)?; // 검증만
    set_plain(conn, ACTIVE_PROVIDER_KEY, provider)
}

fn has_r2(conn: &Connection) -> ApiResult<bool> {
    for key in R2_KEYS {
        if !has_key(conn, key)? {
            return Ok(false);
        }
    }
    Ok(true)
}

// media 경계가 쓴다 — 복호화한 R2 자격증명.
pub(super) struct R2Config {
    pub(super) account_id: String,
    pub(super) access_key_id: String,
    pub(super) secret_access_key: String,
    pub(super) bucket: String,
}

pub(super) fn get_r2_config(
    conn: &Connection,
    crypto: &SecretCrypto,
) -> ApiResult<Option<R2Config>> {
    let read = |key: &str| -> ApiResult<Option<String>> {
        match conn
            .query_row("SELECT value FROM secrets WHERE key = ?1", [key], |r| r.get::<_, String>(0))
            .optional()?
        {
            Some(enc) => Ok(Some(crypto.decrypt(&enc)?)),
            None => Ok(None),
        }
    };
    let (Some(account_id), Some(access_key_id), Some(secret_access_key), Some(bucket)) = (
        read("r2_account_id")?,
        read("r2_access_key_id")?,
        read("r2_secret_access_key")?,
        read("r2_bucket")?,
    ) else {
        return Ok(None);
    };
    Ok(Some(R2Config { account_id, access_key_id, secret_access_key, bucket }))
}

fn set_r2(conn: &Connection, crypto: &SecretCrypto, creds: &R2Credentials) -> ApiResult<()> {
    let values = [&creds.account_id, &creds.access_key_id, &creds.secret_access_key, &creds.bucket];
    if values.iter().any(|v| v.trim().is_empty()) {
        return Err(ApiError::BadRequest("R2 자격증명을 모두 입력해야 합니다.".into()));
    }
    for (key, value) in R2_KEYS.iter().zip(values) {
        set_key(conn, crypto, key, value)?;
    }
    Ok(())
}

fn delete_r2(conn: &Connection) -> ApiResult<()> {
    for key in R2_KEYS {
        delete_key(conn, key)?;
    }
    Ok(())
}

// ---------- DTO ----------

#[derive(Deserialize)]
struct ApiKeyInput {
    #[serde(rename = "apiKey")]
    api_key: String,
}

#[derive(Deserialize)]
struct ProviderInput {
    provider: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct R2Credentials {
    #[serde(default)]
    account_id: String,
    #[serde(default)]
    access_key_id: String,
    #[serde(default)]
    secret_access_key: String,
    #[serde(default)]
    bucket: String,
}

// ---------- 라우트 (routes/ai.ts + routes/media-credentials.ts, /test 변형은 프록시) ----------

#[derive(Clone)]
pub(super) struct SecretState {
    pub(super) db: Db,
    pub(super) crypto: Arc<SecretCrypto>,
}

pub(super) fn routes(state: SecretState) -> Router {
    Router::new()
        .route(
            "/ai/keys/{provider}",
            get(ai_key_get).post(ai_key_set).delete(ai_key_delete),
        )
        .route("/ai/provider", get(provider_get).post(provider_set))
        .route(
            "/media/credentials",
            get(r2_get).post(r2_set).delete(r2_delete),
        )
        .with_state(state)
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn created() -> (axum::http::StatusCode, Json<Value>) {
    (axum::http::StatusCode::CREATED, Json(json!({ "ok": true })))
}

async fn ai_key_get(
    State(st): State<SecretState>,
    AxumPath(provider): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let has = has_api_key(&st.db.lock().unwrap(), &provider)?;
    Ok(Json(json!({ "hasKey": has })))
}

async fn ai_key_set(
    State(st): State<SecretState>,
    AxumPath(provider): AxumPath<String>,
    Json(input): Json<ApiKeyInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    set_api_key(&st.db.lock().unwrap(), &st.crypto, &provider, &input.api_key)?;
    Ok(created())
}

async fn ai_key_delete(
    State(st): State<SecretState>,
    AxumPath(provider): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    delete_api_key(&st.db.lock().unwrap(), &provider)?;
    Ok(ok())
}

async fn provider_get(State(st): State<SecretState>) -> ApiResult<Json<Value>> {
    let provider = get_active_provider(&st.db.lock().unwrap())?;
    Ok(Json(json!({ "provider": provider })))
}

async fn provider_set(
    State(st): State<SecretState>,
    Json(input): Json<ProviderInput>,
) -> ApiResult<Json<Value>> {
    set_active_provider(&st.db.lock().unwrap(), &input.provider)?;
    Ok(ok())
}

async fn r2_get(State(st): State<SecretState>) -> ApiResult<Json<Value>> {
    let has = has_r2(&st.db.lock().unwrap())?;
    Ok(Json(json!({ "hasCredentials": has })))
}

async fn r2_set(
    State(st): State<SecretState>,
    Json(creds): Json<R2Credentials>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    set_r2(&st.db.lock().unwrap(), &st.crypto, &creds)?;
    Ok(created())
}

async fn r2_delete(State(st): State<SecretState>) -> ApiResult<Json<Value>> {
    delete_r2(&st.db.lock().unwrap())?;
    Ok(ok())
}

// ---------- 테스트 (secret-store.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::db;

    fn crypto() -> SecretCrypto {
        SecretCrypto { key: [3u8; 32] }
    }

    fn sample_r2() -> R2Credentials {
        R2Credentials {
            account_id: "acc-1".into(),
            access_key_id: "key-1".into(),
            secret_access_key: "secret-1".into(),
            bucket: "bucket-1".into(),
        }
    }

    #[test]
    fn encrypt_roundtrips() {
        let c = crypto();
        let sealed = c.encrypt("test-key-123");
        assert_eq!(sealed.split(':').count(), 3);
        assert_ne!(sealed, "test-key-123");
        assert_eq!(c.decrypt(&sealed).unwrap(), "test-key-123");
    }

    #[test]
    fn different_key_cannot_decrypt() {
        let sealed = crypto().encrypt("secret");
        let other = SecretCrypto { key: [9u8; 32] };
        assert!(other.decrypt(&sealed).is_err());
    }

    #[test]
    fn api_key_absent_then_set_then_deleted() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let c = crypto();
        for provider in ["gemini", "openai"] {
            assert!(!has_api_key(&conn, provider).unwrap());
            set_api_key(&conn, &c, provider, "test-key-123").unwrap();
            assert!(has_api_key(&conn, provider).unwrap());
            // 저장은 암호문
            let stored: String = conn
                .query_row(
                    "SELECT value FROM secrets WHERE key = ?1",
                    [provider_storage_key(provider).unwrap()],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(c.decrypt(&stored).unwrap(), "test-key-123");
            delete_api_key(&conn, provider).unwrap();
            assert!(!has_api_key(&conn, provider).unwrap());
        }
    }

    #[test]
    fn set_api_key_overwrites() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let c = crypto();
        set_api_key(&conn, &c, "gemini", "first").unwrap();
        set_api_key(&conn, &c, "gemini", "second").unwrap();
        let stored: String = conn
            .query_row("SELECT value FROM secrets WHERE key = 'gemini_api_key'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(c.decrypt(&stored).unwrap(), "second");
    }

    #[test]
    fn set_api_key_rejects_blank() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let err = set_api_key(&conn, &crypto(), "gemini", "  ").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("API 키를 입력해야 합니다")));
    }

    #[test]
    fn providers_are_independent() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let c = crypto();
        set_api_key(&conn, &c, "gemini", "gk").unwrap();
        set_api_key(&conn, &c, "openai", "sk").unwrap();
        delete_api_key(&conn, "openai").unwrap();
        assert!(!has_api_key(&conn, "openai").unwrap());
        assert!(has_api_key(&conn, "gemini").unwrap());
    }

    #[test]
    fn unknown_provider_is_rejected() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        assert!(has_api_key(&conn, "claude").is_err());
        assert!(set_active_provider(&conn, "claude").is_err());
    }

    #[test]
    fn active_provider_defaults_gemini_and_persists() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        assert_eq!(get_active_provider(&conn).unwrap(), "gemini");
        set_active_provider(&conn, "openai").unwrap();
        assert_eq!(get_active_provider(&conn).unwrap(), "openai");
        set_active_provider(&conn, "gemini").unwrap();
        assert_eq!(get_active_provider(&conn).unwrap(), "gemini");
    }

    #[test]
    fn r2_absent_then_set_then_deleted() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let c = crypto();
        assert!(!has_r2(&conn).unwrap());
        set_r2(&conn, &c, &sample_r2()).unwrap();
        assert!(has_r2(&conn).unwrap());
        let stored: String = conn
            .query_row("SELECT value FROM secrets WHERE key = 'r2_bucket'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(c.decrypt(&stored).unwrap(), "bucket-1");
        delete_r2(&conn).unwrap();
        assert!(!has_r2(&conn).unwrap());
    }

    #[test]
    fn r2_rejects_blank_field_and_writes_nothing() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let mut creds = sample_r2();
        creds.bucket = "  ".into();
        let err = set_r2(&conn, &crypto(), &creds).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("R2 자격증명을 모두")));
        assert!(!has_r2(&conn).unwrap());
        assert!(!has_key(&conn, "r2_account_id").unwrap());
    }
}
