// An optional bearer-token gate. Only turned on when `MONO_API_TOKEN` is set —
// embedded mode and Tailscale-only deployments work fine without a token.
//
// `/health`, `/version`, and CORS preflight (OPTIONS) always pass through. Since preflight requests
// carry no auth header, blocking it here would prevent the browser from reading the 401 body. `/version` stays public
// even with a wrong token, since app↔server version comparison must still work (it's not sensitive information).
//
// ponytail: a single token shared across all devices. If per-device revocation becomes necessary (a lost device, 3+ devices),
// switch to a hashed-token table — `apply` would just change from "compare against one digest" to "look up in a table".

use std::sync::Arc;

use axum::{
    extract::Request,
    http::{header, Method, StatusCode},
    middleware::Next,
    response::IntoResponse,
    Router,
};
use sha2::{Digest, Sha256};

/// Returns the router unchanged if the token is empty. Otherwise wraps it in a bearer-check layer.
/// Must sit inside CORS (sees the request first, passes the response through last) so that
/// `access-control-allow-origin` is attached even to a 401 response — hence `.layer(auth).layer(cors)` order at the call site.
pub(crate) fn apply(router: Router, token: Option<&str>) -> Router {
    let token = token.map(str::trim).filter(|value| !value.is_empty());
    let Some(token) = token else { return router };

    let expected = Arc::new(Sha256::digest(token.as_bytes()));
    router.layer(axum::middleware::from_fn(move |request: Request, next: Next| {
        let expected = expected.clone();
        async move {
            let path = request.uri().path();
            // `/events` (SSE) is also public — a browser EventSource can't carry a custom header (Bearer), and
            // passing the token as a URL query would expose it in logs/proxies. The event payload is just an
            // { revision, modules } invalidation signal with no actual data. Re-fetching the data is blocked by the gated snapshot route.
            if request.method() == Method::OPTIONS
                || path == "/health"
                || path == "/version"
                || path == "/events"
            {
                return next.run(request).await;
            }
            let presented = request
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::trim);
            // A constant-time SHA-256 digest comparison — a plain `==` would leak the matching token-prefix length via timing.
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
