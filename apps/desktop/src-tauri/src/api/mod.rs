// 임베드 API 서버. Node/Fastify(apps/api)를 Rust로 대체하는 중.
// 포팅된 경계는 네이티브 처리, 나머지는 proxy.rs가 Node sidecar(127.0.0.1:4175)로 넘긴다.
// 이관이 끝나면 proxy·sidecar를 삭제하고 이게 유일한 백엔드가 된다(계획: Option C).

mod calendar;
mod color;
mod dashboard;
mod db;
mod error;
mod inbox;
mod ledger;
mod media;
mod proxy;
mod routine;
mod scrap;
mod secret;
mod todo;

use std::path::PathBuf;
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, Method};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

use secret::{SecretCrypto, SecretState};

const BIND_ADDR: &str = "127.0.0.1:4174";

// 마이그레이션 중 Rust와 Node가 같은 SQLite 파일 + 같은 마스터 키 파일을 쓴다. release에서
// lib.rs가 두 프로세스에 동일 경로를 넘긴다(dev는 DB·키 경로 정합이 원래 안 맞음 — E2E 주의).
pub fn spawn(db_path: PathBuf, secret_key_path: PathBuf) -> JoinHandle<()> {
    thread::Builder::new()
        .name("mono-api".into())
        .spawn(move || run(db_path, secret_key_path))
        .expect("API 서버 스레드 생성 실패")
}

fn run(db_path: PathBuf, secret_key_path: PathBuf) {
    let database = match db::open(&db_path) {
        Ok(database) => database,
        Err(error) => {
            eprintln!("API DB 초기화 실패: {error} - 화면에 연결 오류가 뜰 수 있습니다.");
            return;
        }
    };

    let crypto = match SecretCrypto::load_or_create(&secret_key_path) {
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

    runtime.block_on(async move {
        let listener = match tokio::net::TcpListener::bind(BIND_ADDR).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("API 서버 바인딩 실패({BIND_ADDR}): {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, build_router(database, crypto)).await {
            eprintln!("API 서버 종료: {error}");
        }
    });
}

fn build_router(database: db::Db, crypto: Arc<SecretCrypto>) -> Router {
    // apps/api/src/server.ts 의 origin 허용 목록과 동일.
    let origins: Vec<HeaderValue> = [
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "tauri://localhost",
        "http://tauri.localhost",
    ]
    .iter()
    .filter_map(|origin| origin.parse().ok())
    .collect();

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any);

    let secret_state = SecretState { db: database.clone(), crypto };

    Router::new()
        .merge(todo::routes(database.clone()))
        .merge(ledger::routes(database.clone()))
        .merge(calendar::routes(database.clone()))
        .merge(routine::routes(database.clone()))
        .merge(scrap::routes(database.clone()))
        .merge(inbox::routes(database.clone()))
        .merge(dashboard::routes(database.clone()))
        .merge(secret::routes(secret_state.clone()))
        .merge(media::routes(secret_state))
        .fallback(proxy::handler)
        // 프록시로 넘어가는 미디어 업로드(최대 100MB+)가 axum 기본 2MB 한도에 걸리지 않도록.
        // 실제 상한은 업스트림(Node) 또는 포팅된 라우트가 각자 검증한다.
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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc());
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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc());

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
        let router = build_router(db::open_memory(), SecretCrypto::test_arc());
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
    async fn unported_route_falls_through_to_proxy() {
        // 업스트림 sidecar(4175)가 없으니 502 — 프록시 fallback 배선 확인.
        // (아직 포팅 안 된 경계 하나를 골라 쓴다.)
        let router = build_router(db::open_memory(), SecretCrypto::test_arc());
        let response = router
            .oneshot(Request::builder().uri("/link-previews/image").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }
}
