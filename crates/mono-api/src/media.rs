use std::collections::HashSet;

use axum::extract::{Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::db::DbExt;
use super::error::{ApiError, ApiResult};
use super::secret::{get_r2_config, R2Config, SecretState};

// apps/api/src/repositories/r2-media-store.ts + routes/media.ts 이식.
// R2는 S3 호환. AWS SigV4로 서명해 reqwest로 직접 친다(aws-sdk 대신 — 6개 op뿐).
// 배치 DeleteObjects 대신 개별 DELETE 루프 (GC는 드문 op, 고아 수도 보통 적음).

const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const UPLOAD_LIMIT_BYTES: usize = 105 * 1024 * 1024;

// ---------- hex ----------

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        out.push(char::from_digit((b & 0xf) as u32, 16).unwrap());
    }
    out
}

fn sha256_hex(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

type HmacSha256 = Hmac<Sha256>;

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC any key size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

// RFC3986. AWS canonical: unreserved 외 전부 %XX. path에서 '/'는 보존 옵션.
fn uri_encode(s: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(b as char),
            b'/' if !encode_slash => out.push('/'),
            _ => {
                out.push('%');
                out.push(char::from_digit((b >> 4) as u32, 16).unwrap().to_ascii_uppercase());
                out.push(char::from_digit((b & 0xf) as u32, 16).unwrap().to_ascii_uppercase());
            }
        }
    }
    out
}

// ---------- SigV4 ----------

struct SignInput<'a> {
    method: &'a str,
    canonical_uri: &'a str,
    canonical_query: &'a str,
    // (lowercase name, value) — 서명 대상. 이름순 정렬은 함수가 한다.
    headers: &'a [(String, String)],
    payload_sha256_hex: &'a str,
    access_key: &'a str,
    secret_key: &'a str,
    region: &'a str,
    service: &'a str,
    amz_date: &'a str, // 20130524T000000Z
}

fn authorization_header(inp: &SignInput) -> String {
    let mut headers = inp.headers.to_vec();
    headers.sort_by(|a, b| a.0.cmp(&b.0));
    let canonical_headers: String =
        headers.iter().map(|(k, v)| format!("{k}:{}\n", v.trim())).collect();
    let signed_headers =
        headers.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        inp.method,
        inp.canonical_uri,
        inp.canonical_query,
        canonical_headers,
        signed_headers,
        inp.payload_sha256_hex,
    );

    let date_stamp = &inp.amz_date[..8];
    let scope = format!("{date_stamp}/{}/{}/aws4_request", inp.region, inp.service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        inp.amz_date,
        scope,
        sha256_hex(canonical_request.as_bytes()),
    );

    let k_date = hmac(format!("AWS4{}", inp.secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac(&k_date, inp.region.as_bytes());
    let k_service = hmac(&k_region, inp.service.as_bytes());
    let k_signing = hmac(&k_service, b"aws4_request");
    let signature = hex(&hmac(&k_signing, string_to_sign.as_bytes()));

    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        inp.access_key,
    )
}

// ---------- R2 클라이언트 ----------

pub(super) struct R2Client {
    endpoint: String, // 뒤 슬래시 없음
    bucket: String,
    access_key_id: String,
    secret_access_key: String,
    http: reqwest::Client,
}

fn now_amz_date() -> String {
    chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
}

fn host_of(endpoint: &str) -> &str {
    endpoint.split("://").nth(1).unwrap_or(endpoint)
}

impl R2Client {
    fn from_config(c: &R2Config) -> Self {
        Self {
            endpoint: format!("https://{}.r2.cloudflarestorage.com", c.account_id),
            bucket: c.bucket.clone(),
            access_key_id: c.access_key_id.clone(),
            secret_access_key: c.secret_access_key.clone(),
            http: reqwest::Client::new(),
        }
    }

    // 서명된 요청 빌더. canonical_uri/query는 이미 인코딩된 상태.
    fn signed(
        &self,
        method: reqwest::Method,
        canonical_uri: &str,
        canonical_query: &str,
        payload_hash: &str,
    ) -> reqwest::RequestBuilder {
        let amz_date = now_amz_date();
        let host = host_of(&self.endpoint).to_string();
        let headers = [
            ("host".to_string(), host.clone()),
            ("x-amz-content-sha256".to_string(), payload_hash.to_string()),
            ("x-amz-date".to_string(), amz_date.clone()),
        ];
        let auth = authorization_header(&SignInput {
            method: method.as_str(),
            canonical_uri,
            canonical_query,
            headers: &headers,
            payload_sha256_hex: payload_hash,
            access_key: &self.access_key_id,
            secret_key: &self.secret_access_key,
            region: "auto",
            service: "s3",
            amz_date: &amz_date,
        });
        let url = if canonical_query.is_empty() {
            format!("{}{canonical_uri}", self.endpoint)
        } else {
            format!("{}{canonical_uri}?{canonical_query}", self.endpoint)
        };
        self.http
            .request(method, url)
            .header("x-amz-date", amz_date)
            .header("x-amz-content-sha256", payload_hash)
            .header(header::AUTHORIZATION, auth)
    }

    fn object_uri(&self, key: &str) -> String {
        format!("/{}/{}", uri_encode(&self.bucket, true), uri_encode(key, true))
    }

    async fn put(&self, key: &str, body: Vec<u8>, content_type: &str) -> ApiResult<()> {
        let hash = sha256_hex(&body);
        let res = self
            .signed(reqwest::Method::PUT, &self.object_uri(key), "", &hash)
            .header(header::CONTENT_TYPE, content_type)
            .body(body)
            .send()
            .await
            .map_err(net_err)?;
        expect_ok(res, "미디어 업로드").await
    }

    async fn get(&self, key: &str) -> ApiResult<Option<(Vec<u8>, String)>> {
        let res = self
            .signed(reqwest::Method::GET, &self.object_uri(key), "", EMPTY_SHA256)
            .send()
            .await
            .map_err(net_err)?;
        if res.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !res.status().is_success() {
            return Err(status_err(res, "미디어 조회").await);
        }
        let content_type = res
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = res.bytes().await.map_err(net_err)?.to_vec();
        Ok(Some((bytes, content_type)))
    }

    async fn delete(&self, key: &str) -> ApiResult<()> {
        let res = self
            .signed(reqwest::Method::DELETE, &self.object_uri(key), "", EMPTY_SHA256)
            .send()
            .await
            .map_err(net_err)?;
        // S3 DeleteObject는 없는 키에도 204를 준다.
        if res.status() == StatusCode::NOT_FOUND || res.status().is_success() {
            return Ok(());
        }
        Err(status_err(res, "미디어 삭제").await)
    }

    async fn delete_many(&self, keys: &[String]) -> ApiResult<()> {
        for key in keys {
            self.delete(key).await?;
        }
        Ok(())
    }

    async fn head_bucket(&self) -> ApiResult<()> {
        let uri = format!("/{}", uri_encode(&self.bucket, true));
        let res = self
            .signed(reqwest::Method::HEAD, &uri, "", EMPTY_SHA256)
            .send()
            .await
            .map_err(net_err)?;
        if res.status().is_success() {
            Ok(())
        } else {
            Err(status_err(res, "R2 연결 확인").await)
        }
    }

    // 쓰기 권한까지 실제로 확인 — HEAD(읽기)만으로는 Object Read only 토큰을 못 잡아
    // "연결 성공"이 뜬 뒤 업로드가 403으로 실패한다. probe 객체를 PUT한 뒤 지운다.
    async fn verify_write(&self) -> ApiResult<()> {
        const PROBE_KEY: &str = ".mono-connection-probe";
        self.put(PROBE_KEY, b"ok".to_vec(), "text/plain").await.map_err(|error| match error {
            ApiError::BadRequest(detail) => ApiError::BadRequest(format!(
                "쓰기 권한 확인 실패 — R2 토큰에 Object Read & Write 권한이 필요합니다. {detail}"
            )),
            other => other,
        })?;
        // 정리 실패는 무시 — 쓰기 검증은 이미 통과했고 남은 probe는 미디어 GC가 정리한다.
        let _ = self.delete(PROBE_KEY).await;
        Ok(())
    }

    // ponytail: 페이지네이션 미구현 — R2 ListObjectsV2는 페이지당 1000개, 미디어 수가
    // 그보다 적으면 무의미. 넘어가면 continuation-token 루프 추가.
    async fn list_all(&self) -> ApiResult<Vec<(String, i64)>> {
        let uri = format!("/{}", uri_encode(&self.bucket, true));
        let res = self
            .signed(reqwest::Method::GET, &uri, "list-type=2", EMPTY_SHA256)
            .send()
            .await
            .map_err(net_err)?;
        if !res.status().is_success() {
            return Err(status_err(res, "미디어 목록 조회").await);
        }
        let xml = res.text().await.map_err(net_err)?;
        Ok(parse_list_objects(&xml))
    }
}

fn net_err(error: reqwest::Error) -> ApiError {
    ApiError::BadRequest(format!("R2 요청 실패: {error}"))
}

async fn status_err(res: reqwest::Response, what: &str) -> ApiError {
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    ApiError::BadRequest(format!("{what} 실패({status}): {}", body.chars().take(200).collect::<String>()))
}

async fn expect_ok(res: reqwest::Response, what: &str) -> ApiResult<()> {
    if res.status().is_success() {
        Ok(())
    } else {
        Err(status_err(res, what).await)
    }
}

// <Contents><Key>..</Key><Size>..</Size></Contents> 반복 블록에서 (key, size) 추출.
fn parse_list_objects(xml: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    let mut idx = 0;
    while let Some(rel) = xml[idx..].find("<Contents>") {
        let start = idx + rel;
        let end = xml[start..]
            .find("</Contents>")
            .map(|e| start + e + "</Contents>".len())
            .unwrap_or(xml.len());
        let block = &xml[start..end];
        if let Some(key) = tag_text(block, "Key") {
            let size = tag_text(block, "Size").and_then(|s| s.trim().parse().ok()).unwrap_or(0);
            out.push((key.to_string(), size));
        }
        idx = end;
    }
    out
}

fn tag_text<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let rel_end = xml[start..].find(&close)?;
    Some(&xml[start..start + rel_end])
}

// ---------- 오프사이트 백업용 미러 ----------

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct MediaMirror {
    pub(crate) downloaded: usize,
    pub(crate) skipped: usize,
}

// R2 미디어 버킷을 로컬 디렉터리로 증분 미러링한다. DB 백업 번들 옆에 두면
// systemd의 rclone copy가 그대로 오프사이트로 쓸어담는다.
// ponytail: copy-only, prune 없음 — list_all은 1000개에서 잘리므로 삭제를 넣으면
//           1000번째 이후 로컬 사본을 날릴 수 있다. 고아 미러 파일은 무해한 용량일 뿐,
//           원본 정리는 앱의 미디어 GC가 R2에서 한다.
pub(crate) async fn mirror_bucket(
    config: &R2Config,
    dir: &std::path::Path,
) -> ApiResult<MediaMirror> {
    let client = R2Client::from_config(config);
    let remote = client.list_all().await?;
    std::fs::create_dir_all(dir).map_err(mirror_io_err)?;

    let mut result = MediaMirror::default();
    for (key, size) in &remote {
        if require_media_id(key).is_err() {
            continue; // probe 객체 등 uuid 아닌 키는 건너뛴다
        }
        let path = dir.join(key);
        if mirror_is_current(&path, *size) {
            result.skipped += 1;
            continue;
        }
        let Some((bytes, _)) = client.get(key).await? else {
            continue;
        };
        std::fs::write(&path, &bytes).map_err(mirror_io_err)?;
        result.downloaded += 1;
    }
    Ok(result)
}

// 로컬 파일이 있고 크기가 R2와 같으면 이미 받은 것으로 본다(R2 객체는 불변).
fn mirror_is_current(path: &std::path::Path, remote_size: i64) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.len() as i64 == remote_size)
        .unwrap_or(false)
}

fn mirror_io_err(error: std::io::Error) -> ApiError {
    ApiError::BadRequest(format!("미디어 미러 파일 오류: {error}"))
}

// ---------- 미디어 참조 (media-reference-repository.ts) ----------

fn referenced_media_ids(conn: &Connection) -> ApiResult<HashSet<String>> {
    let mut ids = HashSet::new();
    let scrap_ids = conn
        .prepare("SELECT media_id FROM scrap_items WHERE media_id IS NOT NULL")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.extend(scrap_ids);

    let comment_ids = conn
        .prepare("SELECT file_media_id FROM scrap_comments WHERE file_media_id IS NOT NULL")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.extend(comment_ids);

    let inbox_json = conn
        .prepare("SELECT images_json, videos_json FROM inbox_items")?
        .query_map([], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (images, videos) in inbox_json {
        for raw in [images, videos].into_iter().flatten() {
            if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&raw) {
                for entry in arr {
                    if let Some(id) = entry.get("mediaId").and_then(|v| v.as_str()) {
                        ids.insert(id.to_string());
                    }
                }
            }
        }
    }
    Ok(ids)
}

fn orphans_of(objects: &[(String, i64)], referenced: &HashSet<String>) -> Vec<(String, i64)> {
    objects.iter().filter(|(key, _)| !referenced.contains(key)).cloned().collect()
}

// mediaId는 R2 객체 키로 그대로 쓰인다 — uuid 형식만 허용해 경로·키 주입을 막는다.
fn require_media_id(id: &str) -> ApiResult<()> {
    let valid = id.len() == 36
        && id.as_bytes().iter().enumerate().all(|(i, &b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_hexdigit(),
        });
    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest("올바르지 않은 미디어 id입니다.".into()))
    }
}

// ---------- 라우트 (routes/media.ts, /credentials/test는 프록시) ----------

pub(super) fn routes(state: SecretState) -> Router {
    Router::new()
        .route("/media", post(upload_handler))
        .route("/media/orphan-stats", get(orphan_stats_handler))
        .route("/media/gc", post(gc_handler))
        .route("/media/credentials/test", post(credentials_test_handler))
        .route("/media/{id}", get(download_handler).delete(delete_handler))
        .with_state(state)
}

fn client_from(state: &SecretState) -> ApiResult<R2Client> {
    let config = {
        let conn = state.db.conn();
        get_r2_config(&conn, &state.crypto)?
    };
    config
        .map(|c| R2Client::from_config(&c))
        .ok_or_else(|| ApiError::BadRequest("R2 자격증명이 설정되지 않았습니다.".into()))
}

async fn upload_handler(
    State(state): State<SecretState>,
    mut multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let mut id: Option<String> = None;
    let mut file: Option<(Vec<u8>, String)> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        ApiError::BadRequest(format!("멀티파트 파싱 실패: {e}"))
    })? {
        match field.name() {
            Some("id") => {
                id = Some(field.text().await.map_err(|e| ApiError::BadRequest(e.to_string()))?)
            }
            Some("file") => {
                let content_type =
                    field.content_type().unwrap_or("application/octet-stream").to_string();
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| ApiError::BadRequest(format!("파일 읽기 실패: {e}")))?;
                if bytes.len() > UPLOAD_LIMIT_BYTES {
                    return Err(ApiError::validation("업로드 크기 한도를 초과했습니다."));
                }
                file = Some((bytes.to_vec(), content_type));
            }
            _ => {}
        }
    }
    let id = id.ok_or_else(|| ApiError::BadRequest("업로드할 파일이 없습니다.".into()))?;
    require_media_id(&id)?;
    let (bytes, content_type) = file.ok_or_else(|| ApiError::BadRequest("업로드할 파일이 없습니다.".into()))?;
    // 0바이트를 그대로 R2에 올리면 "저장은 성공, 사진은 없음"이 되어 조용히 깨진다. 명시적으로 거부.
    if bytes.is_empty() {
        return Err(ApiError::validation("빈 파일은 업로드할 수 없습니다."));
    }
    client_from(&state)?.put(&id, bytes, &content_type).await?;
    Ok((StatusCode::CREATED, Json(json!({ "ok": true }))))
}

async fn download_handler(
    State(state): State<SecretState>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    require_media_id(&id)?;
    let object = client_from(&state)?.get(&id).await?;
    match object {
        Some((bytes, content_type)) => {
            Ok(([(header::CONTENT_TYPE, content_type)], bytes).into_response())
        }
        None => Err(ApiError::NotFound(format!("미디어를 찾을 수 없습니다: {id}"))),
    }
}

async fn delete_handler(
    State(state): State<SecretState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_media_id(&id)?;
    client_from(&state)?.delete(&id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn orphan_stats_handler(State(state): State<SecretState>) -> ApiResult<Json<Value>> {
    let referenced = {
        let conn = state.db.conn();
        referenced_media_ids(&conn)?
    };
    let objects = client_from(&state)?.list_all().await?;
    let orphans = orphans_of(&objects, &referenced);
    let bytes: i64 = orphans.iter().map(|(_, size)| size).sum();
    Ok(Json(json!({ "count": orphans.len(), "bytes": bytes })))
}

async fn credentials_test_handler(State(state): State<SecretState>) -> ApiResult<Json<Value>> {
    let client = client_from(&state)?;
    client.head_bucket().await?;
    client.verify_write().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn gc_handler(State(state): State<SecretState>) -> ApiResult<Json<Value>> {
    let referenced = {
        let conn = state.db.conn();
        referenced_media_ids(&conn)?
    };
    let client = client_from(&state)?;
    let objects = client.list_all().await?;
    let orphans = orphans_of(&objects, &referenced);
    let keys: Vec<String> = orphans.iter().map(|(key, _)| key.clone()).collect();
    client.delete_many(&keys).await?;
    Ok(Json(json!({ "deleted": keys.len() })))
}

// ---------- 테스트 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::params;

    // AWS 문서 "Example: GET Object" 서명 벡터 — canonical request + signing key 전체 검증.
    #[test]
    fn sigv4_matches_aws_get_object_vector() {
        let auth = authorization_header(&SignInput {
            method: "GET",
            canonical_uri: "/test.txt",
            canonical_query: "",
            headers: &[
                ("host".into(), "examplebucket.s3.amazonaws.com".into()),
                ("range".into(), "bytes=0-9".into()),
                (
                    "x-amz-content-sha256".into(),
                    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
                ),
                ("x-amz-date".into(), "20130524T000000Z".into()),
            ],
            payload_sha256_hex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            access_key: "AKIAIOSFODNN7EXAMPLE",
            secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region: "us-east-1",
            service: "s3",
            amz_date: "20130524T000000Z",
        });
        assert!(
            auth.contains(
                "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
            ),
            "{auth}"
        );
        assert!(auth.contains(
            "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date"
        ));
        assert!(auth.contains(
            "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request"
        ));
    }

    #[test]
    fn uri_encode_leaves_unreserved_encodes_rest() {
        assert_eq!(uri_encode("abc-1_2.3~", true), "abc-1_2.3~");
        assert_eq!(uri_encode("a/b", false), "a/b");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
        assert_eq!(uri_encode("a+b=c", true), "a%2Bb%3Dc");
    }

    #[test]
    fn media_id_validation() {
        assert!(require_media_id("11111111-1111-4111-8111-111111111111").is_ok());
        assert!(require_media_id("not-a-uuid").is_err());
        assert!(require_media_id("11111111111143111811111111111111111").is_err());
    }

    #[test]
    fn parse_list_objects_extracts_key_and_size() {
        let xml = r#"<?xml version="1.0"?><ListBucketResult>
            <Contents><Key>a</Key><Size>10</Size><ETag>x</ETag></Contents>
            <Contents><Key>b</Key><Size>20</Size></Contents>
            <IsTruncated>false</IsTruncated></ListBucketResult>"#;
        assert_eq!(
            parse_list_objects(xml),
            vec![("a".to_string(), 10), ("b".to_string(), 20)]
        );
    }

    #[test]
    fn referenced_ids_from_scrap_and_inbox() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO scrap_items (id, seq, kind, title, memo, tag, saved_at, url, media_id) \
             VALUES ('s1', 1, 'image', 't', '', '기타', 'now', NULL, 'media-scrap')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO inbox_items \
             (id, seq, source, raw, target, confidence, status, pinned, received_at, fields_json, images_json, videos_json) \
             VALUES ('i1', 1, 'image', 'r', 'scrap', 0.5, 'pending', 0, 'now', '[]', ?1, ?2)",
            params![
                r#"[{"mediaId":"media-img","name":"a.png"}]"#,
                r#"[{"mediaId":"media-vid"}]"#
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO scrap_comments (id, scrap_id, seq, created_at, text, file_media_id, file_name, file_size) \
             VALUES ('c1', 's1', 1, 'now', '', 'media-comment', 'a.pdf', 10)",
            [],
        )
        .unwrap();

        let ids = referenced_media_ids(&conn).unwrap();
        assert_eq!(ids.len(), 4);
        assert!(ids.contains("media-scrap"));
        assert!(ids.contains("media-img"));
        assert!(ids.contains("media-vid"));
        assert!(ids.contains("media-comment"));
    }

    #[test]
    fn orphans_are_unreferenced_objects() {
        let mut referenced = HashSet::new();
        referenced.insert("kept".to_string());
        let objects = vec![("kept".to_string(), 10), ("orphan".to_string(), 20)];
        let orphans = orphans_of(&objects, &referenced);
        assert_eq!(orphans, vec![("orphan".to_string(), 20)]);
    }

    #[test]
    fn client_missing_credentials_errors_before_network() {
        let db = db::open_memory();
        let state = SecretState { db, crypto: crate::secret::SecretCrypto::test_arc() };
        assert!(matches!(
            client_from(&state),
            Err(ApiError::BadRequest(m)) if m.contains("R2 자격증명이 설정되지 않았습니다")
        ));
    }

    #[test]
    fn mirror_skips_only_when_local_size_matches() {
        let dir = std::env::temp_dir().join(format!("mono-mirror-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("obj");
        std::fs::write(&path, b"abc").unwrap();

        assert!(mirror_is_current(&path, 3));
        assert!(!mirror_is_current(&path, 4));
        assert!(!mirror_is_current(&dir.join("missing"), 3));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
