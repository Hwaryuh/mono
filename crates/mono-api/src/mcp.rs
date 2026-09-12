// 리모트 MCP 서버 — 기존 /todo, /routine, /scrap snapshot 라우트를 read-only 툴로 감싼 것 뿐이다.
// 새 쿼리 로직은 없음: 각 툴은 이미 검증된 snapshot 핸들러를 내부 oneshot 호출로 재사용한다.
// 인증은 이 모듈이 신경 쓰지 않는다 — lib.rs가 전체 라우터를 auth::apply()로 감싸므로
// /mcp도 다른 라우트와 동일한 Bearer 토큰 게이트를 그대로 통과한다.

use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::Router;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{tool, tool_handler, tool_router, ServerHandler};
use tower::ServiceExt;

#[derive(Clone)]
pub(crate) struct McpServer {
    router: Router,
    // `#[tool_handler]`가 매크로 확장 코드에서 읽는다 — dead_code lint는 그 경로를 못 본다(rmcp 공식
    // 예제도 동일 경고를 `#![allow(dead_code)]`로 무시함).
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl McpServer {
    fn new(router: Router) -> Self {
        Self { router, tool_router: Self::tool_router() }
    }

    /// 내부 GET 요청을 스냅샷 라우터에 직접 흘려보내고 JSON 본문을 문자열로 반환한다.
    async fn snapshot(&self, path: &'static str) -> String {
        let request = Request::builder().uri(path).body(Body::empty()).expect("고정 경로라 실패할 수 없음");
        let response = self.router.clone().oneshot(request).await.expect("내부 라우터는 Infallible");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[tool_router]
impl McpServer {
    #[tool(description = "할 일 목록 스냅샷(JSON). 라벨, 완료 여부, 마감일·마감시간, 우선순위를 포함한다.")]
    async fn list_todos(&self) -> String {
        self.snapshot("/todo/snapshot").await
    }

    #[tool(description = "오늘이 마감(dueDate)인 할 일만 필터링한 스냅샷(JSON). 나머지 필드는 list_todos와 동일하다.")]
    async fn list_todos_today(&self) -> String {
        filter_todos_due_today(self.snapshot("/todo/snapshot").await)
    }

    #[tool(description = "일정/루틴 목록 스냅샷(JSON). 오늘 체크 여부를 포함한다.")]
    async fn list_schedule(&self) -> String {
        self.snapshot("/routine/snapshot").await
    }

    #[tool(description = "스크랩(저장한 링크·메모) 목록 스냅샷(JSON). 태그와 댓글을 포함한다.")]
    async fn list_scraps(&self) -> String {
        self.snapshot("/scrap/snapshot").await
    }
}

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::default();
        info.server_info.name = "mono".into();
        info.server_info.version = env!("CARGO_PKG_VERSION").into();
        info.instructions = Some(
            "list_todos/list_schedule/list_scraps로 사용자의 현재 할 일·일정·스크랩을 확인한 뒤, \
             지금 상황에 맞는 답을 제안하세요."
                .into(),
        );
        info
    }
}

/// `/todo/snapshot` JSON에서 `dueDate`가 `today` 필드와 같은 항목만 남긴다. 파싱에 실패하면
/// (스냅샷 형태가 바뀌는 등) 원본을 그대로 돌려줘 — 필터링은 부가 기능이라 실패해도 정보 유실보단 낫다.
fn filter_todos_due_today(snapshot: String) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&snapshot) else {
        return snapshot;
    };
    let today = value.get("today").and_then(|v| v.as_str()).map(str::to_owned);
    if let (Some(today), Some(items)) = (today, value.get_mut("items").and_then(|v| v.as_array_mut())) {
        items.retain(|item| item.get("dueDate").and_then(|v| v.as_str()) == Some(today.as_str()));
    }
    value.to_string()
}

/// `/mcp`에 nest할 수 있는 tower 서비스. `snapshot_router`는 todo/routine/scrap 라우트만 merge된,
/// 인증·CORS 레이어가 없는 내부 전용 라우터 — 외부에 직접 노출되지 않고 `McpServer::snapshot`이
/// oneshot으로만 호출한다.
///
/// ponytail: allowed_hosts 검증은 끈다 — VPS 도메인/Tailscale 호스트명을 일일이 등록하는 대신,
/// 이미 전체 라우터를 감싸는 auth::apply()의 Bearer 토큰 검증에 맡긴다. 토큰 인증과 별개로
/// Host 헤더 화이트리스트가 필요해지면(공인 도메인 다중화 등) 그때 다시 켠다.
pub(crate) fn service(
    snapshot_router: Router,
) -> StreamableHttpService<McpServer, LocalSessionManager> {
    StreamableHttpService::new(
        move || Ok(McpServer::new(snapshot_router.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default().disable_allowed_hosts(),
    )
}

#[cfg(test)]
mod tests {
    use super::filter_todos_due_today;

    #[test]
    fn keeps_only_items_due_today_and_drops_the_rest() {
        let snapshot = r#"{"today":"2026-09-12","labels":[],"items":[
            {"id":"a","dueDate":"2026-09-12"},
            {"id":"b","dueDate":"2026-09-11"},
            {"id":"c","dueDate":null},
            {"id":"d","dueDate":"2026-09-12"}
        ]}"#;
        let filtered: serde_json::Value = serde_json::from_str(&filter_todos_due_today(snapshot.into())).unwrap();
        let ids: Vec<&str> = filtered["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["a", "d"]);
    }

    #[test]
    fn malformed_snapshot_passes_through_unchanged() {
        let snapshot = "not json";
        assert_eq!(filter_todos_due_today(snapshot.into()), snapshot);
    }
}
