// 선택적 베어러 토큰 게이트. `MONO_API_TOKEN`이 설정된 경우에만 켜진다 —
// 임베드 모드와 Tailscale 전용 배포는 토큰 없이 그대로 동작한다.
//
// `/health`, `/version`, CORS preflight(OPTIONS)는 항상 통과시킨다. preflight에는 인증 헤더가
// 실리지 않으므로 여기서 막으면 브라우저가 401 본문을 읽지 못한다. `/version`은 토큰이
// 틀렸을 때도 앱↔서버 버전 비교가 가능해야 해서 공개다(민감 정보 아님).
//
// ponytail: 전 기기 공유 단일 토큰. 기기별 폐기가 필요하면(기기 분실, 3대 이상)
// 해시 토큰 테이블로 바꾼다 — `apply`가 "1개 digest 비교" → "테이블 조회"로만 바뀜.

use std::sync::Arc;

use axum::{
    extract::Request,
    http::{header, Method, StatusCode},
    middleware::Next,
    response::IntoResponse,
    Router,
};
use sha2::{Digest, Sha256};

/// 토큰이 비어 있으면 라우터를 그대로 반환한다. 아니면 베어러 검사 레이어를 씌운다.
/// CORS보다 안쪽(먼저 요청을 보고, 나중에 응답을 넘김)에 두어야 401 응답에도
/// `access-control-allow-origin`이 붙는다 — 호출부에서 `.layer(auth).layer(cors)` 순서.
pub(crate) fn apply(router: Router, token: Option<&str>) -> Router {
    let token = token.map(str::trim).filter(|value| !value.is_empty());
    let Some(token) = token else { return router };

    let expected = Arc::new(Sha256::digest(token.as_bytes()));
    router.layer(axum::middleware::from_fn(move |request: Request, next: Next| {
        let expected = expected.clone();
        async move {
            let path = request.uri().path();
            if request.method() == Method::OPTIONS || path == "/health" || path == "/version" {
                return next.run(request).await;
            }
            let presented = request
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::trim);
            // 고정 길이 SHA-256 digest 비교 — 평문 `==`는 토큰 접두사 길이를 타이밍으로 흘린다.
            let ok = presented
                .map(|candidate| Sha256::digest(candidate.as_bytes()) == *expected)
                .unwrap_or(false);
            if ok {
                next.run(request).await
            } else {
                (StatusCode::UNAUTHORIZED, "유효한 API 토큰이 필요합니다.").into_response()
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request as HttpRequest, routing::get};
    use tower::ServiceExt;

    fn app(token: Option<&str>) -> Router {
        let router = Router::new()
            .route("/health", get(|| async { "ok" }))
            .route("/todo/snapshot", get(|| async { "secret" }));
        apply(router, token)
    }

    async fn status(router: Router, request: HttpRequest<Body>) -> StatusCode {
        router.oneshot(request).await.unwrap().status()
    }

    #[tokio::test]
    async fn no_token_configured_leaves_everything_open() {
        let router = app(None);
        assert_eq!(
            status(router, HttpRequest::get("/todo/snapshot").body(Body::empty()).unwrap()).await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn configured_token_gates_data_routes_but_not_health() {
        let make = || app(Some("s3cr3t"));

        assert_eq!(
            status(make(), HttpRequest::get("/health").body(Body::empty()).unwrap()).await,
            StatusCode::OK
        );
        assert_eq!(
            status(make(), HttpRequest::get("/todo/snapshot").body(Body::empty()).unwrap()).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status(
                make(),
                HttpRequest::get("/todo/snapshot")
                    .header(header::AUTHORIZATION, "Bearer wrong")
                    .body(Body::empty())
                    .unwrap()
            )
            .await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status(
                make(),
                HttpRequest::get("/todo/snapshot")
                    .header(header::AUTHORIZATION, "Bearer s3cr3t")
                    .body(Body::empty())
                    .unwrap()
            )
            .await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn blank_token_is_treated_as_unset() {
        let router = app(Some("   "));
        assert_eq!(
            status(router, HttpRequest::get("/todo/snapshot").body(Body::empty()).unwrap()).await,
            StatusCode::OK
        );
    }
}
