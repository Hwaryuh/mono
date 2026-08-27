use std::sync::OnceLock;

use axum::body::{Body, Bytes};
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

// 아직 Rust로 포팅 안 된 라우트는 Node sidecar(apps/api)로 넘긴다.
// api_sidecar.rs 가 PORT=4175 로 띄운다. 마지막 경계 이관 시 이 파일과 sidecar를 통째로 삭제.
const UPSTREAM: &str = "http://127.0.0.1:4175";

// ponytail: 요청·응답 바디를 통째로 버퍼링(스트리밍 X). 미디어 업로드 100MB도 프록시를
// 거치지만 로컬 단일 사용자 마이그레이션 하네스라 허용. Phase 9에서 media 경계가 넘어가면 무의미.
const MAX_BODY: usize = 128 * 1024 * 1024;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

pub async fn handler(req: Request) -> Response {
    match forward(req).await {
        Ok(response) => response,
        Err(message) => (
            StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({ "error": format!("API 프록시 실패: {message}") })),
        )
            .into_response(),
    }
}

async fn forward(req: Request) -> Result<Response, String> {
    let (parts, body) = req.into_parts();
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or_else(|| parts.uri.path());
    let url = format!("{UPSTREAM}{path_and_query}");

    let body_bytes = axum::body::to_bytes(body, MAX_BODY)
        .await
        .map_err(|error| error.to_string())?;

    let mut request = client().request(parts.method, &url);
    for (name, value) in filtered(&parts.headers) {
        request = request.header(name, value);
    }
    if !body_bytes.is_empty() {
        request = request.body(body_bytes);
    }

    let upstream = request.send().await.map_err(|error| error.to_string())?;
    let status = upstream.status();
    let headers = upstream.headers().clone();
    let payload: Bytes = upstream.bytes().await.map_err(|error| error.to_string())?;

    let mut response = Response::builder().status(status);
    for (name, value) in filtered(&headers) {
        response = response.header(name, value);
    }
    response
        .body(Body::from(payload))
        .map_err(|error| error.to_string())
}

// hop-by-hop 및 길이 관련 헤더는 재전송하지 않는다(양쪽 HTTP 스택이 다시 설정).
fn filtered(headers: &HeaderMap) -> impl Iterator<Item = (&axum::http::HeaderName, &axum::http::HeaderValue)> {
    headers.iter().filter(|(name, _)| {
        !matches!(
            name.as_str(),
            "connection" | "transfer-encoding" | "content-length" | "host" | "keep-alive" | "upgrade"
        )
    })
}
