use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures_util::stream::{self, Stream};
use serde::Serialize;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 128;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    revision: u64,
    modules: Vec<String>,
}

#[derive(Clone)]
pub struct ChangeHub {
    sender: broadcast::Sender<ChangeEvent>,
    revision: Arc<AtomicU64>,
}

impl ChangeHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            sender,
            revision: Arc::new(AtomicU64::new(0)),
        }
    }

    fn publish(&self, modules: &[&str]) {
        if modules.is_empty() {
            return;
        }
        let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        let event = ChangeEvent {
            revision,
            modules: modules.iter().map(|module| (*module).to_string()).collect(),
        };
        // 구독자가 없는 것은 정상이다. 변경 저장 성공 여부와 알림 연결 여부는 결합하지 않는다.
        let _ = self.sender.send(event);
    }

    fn subscribe(&self) -> broadcast::Receiver<ChangeEvent> {
        self.sender.subscribe()
    }
}

impl Default for ChangeHub {
    fn default() -> Self {
        Self::new()
    }
}

pub fn routes(hub: ChangeHub) -> Router {
    Router::new()
        .route("/events", get(events_handler))
        .with_state(hub)
}

async fn events_handler(
    State(hub): State<ChangeHub>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = hub.subscribe();
    let stream = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(change) => {
                    let event = Event::default()
                        .event("change")
                        .id(change.revision.to_string())
                        .json_data(change)
                        .expect("ChangeEvent JSON 직렬화 실패");
                    return Some((Ok(event), receiver));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // 느린 클라이언트는 빠진 이벤트를 병합하려 하지 않고 전체 재검증한다.
                    return Some((Ok(Event::default().event("resync").data("{}")), receiver));
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

pub async fn publish_successful_mutation(
    State(hub): State<ChangeHub>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let response = next.run(request).await;
    if matches!(method, Method::POST | Method::PUT | Method::DELETE)
        && response.status().is_success()
    {
        hub.publish(modules_for_path(&path));
    }
    response
}

fn modules_for_path(path: &str) -> &'static [&'static str] {
    if path.starts_with("/todo") {
        &["todo", "routine", "dashboard"]
    } else if path.starts_with("/routine") {
        &["routine", "todo", "dashboard"]
    } else if path.starts_with("/calendar") {
        &["calendar", "dashboard"]
    } else if path.starts_with("/scrap") {
        &["scrap", "dashboard"]
    } else if path.starts_with("/ledger") {
        &["ledger", "dashboard"]
    } else if path.starts_with("/inbox") {
        &["inbox", "todo", "calendar", "scrap", "ledger", "dashboard"]
    } else if path.starts_with("/dashboard") {
        &["dashboard", "inbox", "todo", "routine"]
    } else {
        &[]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn publishes_revisioned_module_changes() {
        let hub = ChangeHub::new();
        let mut receiver = hub.subscribe();
        hub.publish(modules_for_path("/inbox/items/1/approve"));

        let event = receiver.recv().await.unwrap();
        assert_eq!(event.revision, 1);
        assert_eq!(
            event.modules,
            ["inbox", "todo", "calendar", "scrap", "ledger", "dashboard"]
        );
    }

    #[test]
    fn excludes_non_snapshot_routes() {
        assert!(modules_for_path("/media/gc").is_empty());
        assert!(modules_for_path("/settings/ai").is_empty());
    }

    // 클라이언트 realtimeChangeEventSchema(packages/contracts 의 realtimeModuleIds)와 반드시 같아야
    // 하는 정식 모듈 집합. Rust가 이 밖의 이름을 publish하면 SSE 이벤트가 클라이언트 Zod parse에서
    // 조용히 드롭돼 화면이 stale해진다. 두 언어의 유일한 계약 지점이라 이 테스트로 drift를 막는다.
    const REALTIME_MODULE_IDS: [&str; 7] =
        ["dashboard", "inbox", "todo", "routine", "calendar", "scrap", "ledger"];

    #[test]
    fn published_modules_match_client_realtime_set() {
        // 각 모듈의 대표 mutating 경로. modules_for_path는 prefix 매칭이라 대표 하나면 충분하다.
        let mutating_paths = [
            "/todo/items",
            "/routine/items",
            "/calendar/events",
            "/scrap/items",
            "/ledger/expenses",
            "/inbox/items/1/approve",
            "/dashboard/capture",
        ];
        let mut seen = std::collections::HashSet::new();
        for path in mutating_paths {
            for module in modules_for_path(path) {
                assert!(
                    REALTIME_MODULE_IDS.contains(module),
                    "modules_for_path({path:?})가 realtime 집합에 없는 모듈 {module:?}을 publish함 — 클라이언트가 이벤트를 드롭한다"
                );
                seen.insert(*module);
            }
        }
        // 반대 방향: 모든 realtime 모듈이 최소 한 경로에서 실제 갱신 신호를 받는지도 확인한다.
        for id in REALTIME_MODULE_IDS {
            assert!(seen.contains(id), "realtime 모듈 {id:?}이 어떤 경로에서도 publish되지 않음");
        }
    }
}
