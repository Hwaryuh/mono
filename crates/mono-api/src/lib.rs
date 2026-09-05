// The mono API server. An axum HTTP server — run in one of two ways:
//   1. Embedded: the Tauri binary spawns it on a thread via `spawn()`, occupying 127.0.0.1:4174 (offline mode).
//   2. Standalone: `crates/mono-api`'s `main.rs` runs it blocking via `serve(Config)` (multi-device sharing).
// The old Node/Fastify (apps/api) has been fully rewritten to Rust across the board (Option C) — the sidecar/proxy is gone.

mod ai;
mod auth;
pub mod backup;
mod calendar;
mod category;
mod change;
mod color;
mod common;
mod dashboard;
mod db;
mod error;
mod inbox;
mod ledger;
mod link_preview;
mod media;
mod routine;
mod scrap;
mod secret;
mod todo;
mod version;

use std::path::PathBuf;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::{error::Error, fmt};

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, Method};
use axum::middleware;
use axum::routing::get;
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

use secret::{SecretCrypto, SecretState};

const EMBED_BIND_ADDR: &str = "127.0.0.1:4174";

/// The server startup config. For embedded, `spawn()`'s caller fills in the defaults; for standalone, env vars fill it in.
pub struct Config {
    /// The bind address. `127.0.0.1:4174` for embedded, `0.0.0.0:4174` by default for standalone.
    pub bind_addr: String,
    pub db_path: PathBuf,
    pub secret_key_path: PathBuf,
    /// The allowed CORS origins. If empty, falls back to a hardcoded list (the desktop app's origin is fixed regardless of the server's location).
    pub cors_origins: Vec<String>,
    /// If set, requires `Authorization: Bearer <token>` on every request except `/health`.
    /// No auth if empty (embedded, Tailscale-only deployments).
    pub api_token: Option<String>,
}

#[derive(Debug)]
pub enum ServeError {
    Database(rusqlite::Error),
    SecretKey(std::io::Error),
    Runtime(std::io::Error),
    Bind {
        address: String,
        source: std::io::Error,
    },
    Server(std::io::Error),
}

impl fmt::Display for ServeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "API DB 초기화 실패: {error}"),
            Self::SecretKey(error) => write!(formatter, "마스터 키 로드 실패: {error}"),
            Self::Runtime(error) => write!(formatter, "API 런타임 생성 실패: {error}"),
            Self::Bind { address, source } => {
                write!(formatter, "API 서버 바인딩 실패({address}): {source}")
            }
            Self::Server(error) => write!(formatter, "API 서버 종료: {error}"),
        }
    }
}

impl Error for ServeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::SecretKey(error)
            | Self::Runtime(error)
            | Self::Bind { source: error, .. }
            | Self::Server(error) => Some(error),
        }
    }
}

// The embedded-mode entry point. The signature is kept as-is — Tauri's `lib.rs` calls it directly.
// Takes the mono.sqlite + mono.secret.key paths and starts the server on a thread.
pub fn spawn(db_path: PathBuf, secret_key_path: PathBuf) -> JoinHandle<()> {
    let config = Config {
        bind_addr: EMBED_BIND_ADDR.to_string(),
        db_path,
        secret_key_path,
        cors_origins: Vec::new(),
        api_token: None,
    };
    thread::Builder::new()
        .name("mono-api".into())
        .spawn(move || {
            if let Err(error) = serve(config) {
                eprintln!("{error} - 화면에 연결 오류가 뜰 수 있습니다.");
            }
        })
        .expect("API 서버 스레드 생성 실패")
}

/// The standalone entry point — blocks the current thread.
pub fn serve(config: Config) -> Result<(), ServeError> {
    let database = db::open(&config.db_path).map_err(ServeError::Database)?;
    let crypto = Arc::new(
        SecretCrypto::load_or_create(&config.secret_key_path).map_err(ServeError::SecretKey)?,
    );
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(ServeError::Runtime)?;

    let bind_addr = config.bind_addr;
    let router = build_router(database, crypto, &config.cors_origins, config.api_token.as_deref());
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(&bind_addr)
            .await
            .map_err(|source| ServeError::Bind {
                address: bind_addr,
                source,
            })?;
        axum::serve(listener, router)
            .await
            .map_err(ServeError::Server)
    })
}

/// The result of mirroring media. `Skipped` if there are no R2 credentials.
#[derive(Debug, PartialEq, Eq)]
pub enum MediaMirrorOutcome {
    Skipped,
    Mirrored { downloaded: usize, skipped: usize },
}

/// For offsite backup — incrementally mirrors the R2 media bucket into `dir`.
/// Placed next to the DB backup bundle (`<backup-root>/media`), systemd's rclone copy uploads it along with it.
/// Does nothing and returns `Skipped` if there are no R2 credentials (a local-only deployment).
pub fn mirror_media(
    db_path: &std::path::Path,
    secret_key_path: &std::path::Path,
    dir: &std::path::Path,
) -> Result<MediaMirrorOutcome, String> {
    let crypto = SecretCrypto::load_or_create(secret_key_path).map_err(|e| e.to_string())?;
    let conn = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("DB 열기 실패: {e}"))?;
    let Some(config) = secret::get_r2_config(&conn, &crypto).map_err(|e| e.to_string())? else {
        return Ok(MediaMirrorOutcome::Skipped);
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("런타임 생성 실패: {e}"))?;
    let mirror = runtime
        .block_on(media::mirror_bucket(&config, dir))
        .map_err(|e| e.to_string())?;
    Ok(MediaMirrorOutcome::Mirrored {
        downloaded: mirror.downloaded,
        skipped: mirror.skipped,
    })
}

fn build_router(
    database: db::Db,
    crypto: Arc<SecretCrypto>,
    cors_origins: &[String],
    api_token: Option<&str>,
) -> Router {
    // The desktop app's origin is fixed regardless of the server's location. If standalone needs a different origin,
    // override it with MONO_CORS_ORIGINS (same default list as apps/api/src/server.ts).
    const DEFAULT_ORIGINS: [&str; 4] = [
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "tauri://localhost",
        "http://tauri.localhost",
    ];
    let origins: Vec<HeaderValue> = if cors_origins.is_empty() {
        DEFAULT_ORIGINS.iter().filter_map(|origin| origin.parse().ok()).collect()
    } else {
        cors_origins.iter().filter_map(|origin| origin.parse().ok()).collect()
    };

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any);

    let secret_state = SecretState { db: database.clone(), crypto };
    let change_hub = change::ChangeHub::new();

    let router = Router::new()
        .route("/health", get(|| async { "ok" }))
        // Used by the client to detect app↔server version drift (when only the server falls behind in remote mode).
        .route(
            "/version",
            get(|| async {
                axum::Json(serde_json::json!({ "version": env!("CARGO_PKG_VERSION") }))
            }),
        )
        .merge(todo::routes(database.clone()))
        .merge(ledger::routes(database.clone()))
        .merge(calendar::routes(database.clone()))
        .merge(routine::routes(database.clone()))
        .merge(scrap::routes(database.clone()))
        .merge(inbox::routes(database))
        .merge(dashboard::routes(secret_state.clone()))
        .merge(secret::routes(secret_state.clone()))
        .merge(media::routes(secret_state.clone()))
        .merge(ai::routes(secret_state))
        .merge(link_preview::routes(link_preview::state()))
        .merge(change::routes(change_hub.clone()))
        // Detects a successful mutation response and publishes a module-change event (an invalidation signal to SSE subscribers).
        .layer(middleware::from_fn_with_state(
            change_hub,
            change::publish_successful_mutation,
        ))
        // So that media uploads (up to 100MB+) don't hit axum's default 2MB limit. The actual cap
        // is validated per route (media.rs UPLOAD_LIMIT_BYTES, dashboard capture, etc.).
        .layer(DefaultBodyLimit::disable());

    // The bearer check sits inside CORS — even a 401 response must carry CORS headers for the browser to read its body.
    auth::apply(router, api_token).layer(cors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn body_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn snapshot_serializes_camel_case_and_seeds_other() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], None);
        let response = router
            .oneshot(Request::builder().uri("/todo/snapshot").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let json = body_json(response).await;
        assert_eq!(json["labels"][0]["name"], "기타");
        assert!(json["today"].is_string());
    }

    #[tokio::test]
    async fn create_label_and_item_over_http() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], None);

        let created = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todo/labels")
                    .header("content-type", "application/json")
                    .body(Body::from(r##"{"name":"업무","color":"#b03a55"}"##))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);

        let snapshot = body_json(
            router
                .clone()
                .oneshot(Request::builder().uri("/todo/snapshot").body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        let label_id = snapshot["labels"][0]["id"].as_str().unwrap().to_string();

        let item = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todo/items")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"title":"HTTP 할 일","labelId":"{label_id}","dueDate":null,"dueTime":null,"note":""}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(item.status(), StatusCode::CREATED);

        let after = body_json(
            router
                .oneshot(Request::builder().uri("/todo/snapshot").body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(after["items"][0]["title"], "HTTP 할 일");
    }

    #[tokio::test]
    async fn missing_item_toggle_is_404_json() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], None);
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todo/items/nope/toggle")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let json = body_json(response).await;
        assert!(json["error"].as_str().unwrap().contains("찾을 수 없습니다"));
    }

    #[tokio::test]
    async fn unrouted_path_is_404() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], None);
        let response = router
            .oneshot(Request::builder().uri("/__unrouted__").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn version_endpoint_reports_crate_version_without_auth() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], Some("s3cr3t"));
        let response = router
            .oneshot(Request::builder().uri("/version").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_json(response).await["version"], env!("CARGO_PKG_VERSION"));
    }

    #[tokio::test]
    async fn stale_item_update_is_409_over_http() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], None);
        router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todo/items")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"title":"원본","labelId":"other","dueDate":null,"dueTime":null,"note":""}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let snapshot = body_json(
            router
                .clone()
                .oneshot(Request::builder().uri("/todo/snapshot").body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        let item_id = snapshot["items"][0]["id"].as_str().unwrap();
        let body = r#"{"title":"수정","labelId":"other","dueDate":null,"dueTime":null,"note":""}"#;

        let first = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/todo/items/{item_id}"))
                    .header("content-type", "application/json")
                    .header("if-match", "\"1\"")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        // Saving again with the same version gives a 409 — the same as another device having edited it first.
        let stale = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/todo/items/{item_id}"))
                    .header("content-type", "application/json")
                    .header("if-match", "\"1\"")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        assert!(body_json(stale).await["error"].as_str().unwrap().contains("다른 기기"));
    }

    #[tokio::test]
    async fn successful_mutation_emits_sse_change() {
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[], None);
        let events = router
            .clone()
            .oneshot(Request::builder().uri("/events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(events.status(), StatusCode::OK);
        let mut event_body = events.into_body();

        let created = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todo/items")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"title":"알림","labelId":"other","dueDate":null,"dueTime":null,"note":""}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);

        let frame = tokio::time::timeout(std::time::Duration::from_secs(1), event_body.frame())
            .await
            .expect("SSE 변경 이벤트 시간 초과")
            .expect("SSE 스트림 종료")
            .expect("SSE 프레임 읽기 실패");
        let payload = String::from_utf8(frame.into_data().expect("SSE 데이터 프레임 아님").to_vec()).unwrap();
        assert!(payload.contains("event: change"));
        assert!(payload.contains("\"todo\""));
        assert!(payload.contains("\"dashboard\""));
    }
}
