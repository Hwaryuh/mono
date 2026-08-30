// 모듈 전반에서 복붙되던 자잘한 핸들러/시간/색상 헬퍼 한 곳 모음.
use axum::http::StatusCode;
use axum::Json;
use chrono::SecondsFormat;
use serde_json::{json, Value};

use super::color::normalize_color_to_oklch;
use super::error::{ApiError, ApiResult};

/// 성공 응답 본문. `{ "ok": true }`.
pub fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// 201 Created 응답.
pub fn created() -> (StatusCode, Json<Value>) {
    (StatusCode::CREATED, Json(json!({ "ok": true })))
}

/// JS `new Date().toISOString()` 과 동일 형식: 2026-08-27T00:38:50.792Z
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// 로컬 타임존 기준 오늘 날짜 (YYYY-MM-DD).
pub fn today_iso() -> String {
    chrono::Local::now().date_naive().to_string()
}

/// 색상 입력을 OKLCH로 정규화하거나 검증 에러.
pub fn validated_color(raw: &str) -> ApiResult<String> {
    normalize_color_to_oklch(raw)
        .ok_or_else(|| ApiError::validation("색상은 OKLCH 또는 6자리 HEX 값이어야 합니다."))
}
