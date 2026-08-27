// mono API 서버. axum HTTP 서버 — 두 가지로 구동된다:
//   1. 임베드: Tauri 바이너리가 `spawn()`으로 스레드에 띄워 127.0.0.1:4174 점유(오프라인 모드).
//   2. standalone: `crates/mono-api`의 `main.rs`가 `serve(Config)`로 블로킹 실행(멀티 기기 공유).
// 예전 Node/Fastify(apps/api)를 전 경계 Rust로 재작성 완료(Option C) — sidecar·proxy 제거됨.

mod ai;
mod calendar;
mod color;
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

use std::path::PathBuf;
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, Method};
use axum::routing::get;
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

use secret::{SecretCrypto, SecretState};

const EMBED_BIND_ADDR: &str = "127.0.0.1:4174";

/// 서버 구동 설정. 임베드 호출부는 `spawn()`이 기본값을 채우고, standalone은 env로 채운다.
pub struct Config {
    /// 바인드 주소. 임베드 `127.0.0.1:4174`, standalone 기본 `0.0.0.0:4174`.
    pub bind_addr: String,
    pub db_path: PathBuf,
    pub secret_key_path: PathBuf,
    /// 허용 CORS origin. 비면 하드코딩 목록(데스크톱 앱 origin은 서버 위치와 무관하게 고정).
    pub cors_origins: Vec<String>,
}

// 임베드 모드 진입점. 시그니처 유지 — Tauri `lib.rs`가 그대로 호출한다.
// mono.sqlite + mono.secret.key 경로를 받아 스레드에 서버를 띄운다.
pub fn spawn(db_path: PathBuf, secret_key_path: PathBuf) -> JoinHandle<()> {
    let config = Config {
        bind_addr: EMBED_BIND_ADDR.to_string(),
        db_path,
        secret_key_path,
        cors_origins: Vec::new(),
    };
    thread::Builder::new()
        .name("mono-api".into())
        .spawn(move || serve(config))
        .expect("API 서버 스레드 생성 실패")
}

/// standalone 진입점 — 현재 스레드를 블로킹한다.
pub fn serve(config: Config) {
    let database = match db::open(&config.db_path) {
        Ok(database) => database,
        Err(error) => {
            eprintln!("API DB 초기화 실패: {error} - 화면에 연결 오류가 뜰 수 있습니다.");
            return;
        }
    };

    let crypto = match SecretCrypto::load_or_create(&config.secret_key_path) {
        Ok(crypto) => Arc::new(crypto),
        Err(error) => {
            eprintln!("마스터 키 로드 실패: {error} - AI/미디어 자격증명 라우트가 실패합니다.");
            return;
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("API 런타임 생성 실패: {error}");
            return;
        }
    };

    let bind_addr = config.bind_addr;
    let router = build_router(database, crypto, &config.cors_origins);
    runtime.block_on(async move {
        let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("API 서버 바인딩 실패({bind_addr}): {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("API 서버 종료: {error}");
        }
    });
}

fn build_router(database: db::Db, crypto: Arc<SecretCrypto>, cors_origins: &[String]) -> Router {
    // 데스크톱 앱 origin은 서버 위치와 무관하게 고정. standalone에서 다른 origin이 필요하면
    // MONO_CORS_ORIGINS로 덮어쓴다(apps/api/src/server.ts 의 기본 목록과 동일).
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

    Router::new()
        .route("/health", get(|| async { "ok" }))
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
        // 미디어 업로드(최대 100MB+)가 axum 기본 2MB 한도에 걸리지 않도록. 실제 상한은
        // 각 라우트가 검증한다(media.rs UPLOAD_LIMIT_BYTES, dashboard capture 등).
        .layer(DefaultBodyLimit::disable())
        .layer(cors)
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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[]);
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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[]);

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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[]);
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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc(), &[]);
        let response = router
            .oneshot(Request::builder().uri("/__unrouted__").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
