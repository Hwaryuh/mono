// A single collection of the small handler/time/color helpers that used to be copy-pasted across modules.
use axum::http::StatusCode;
use axum::Json;
use chrono::SecondsFormat;
use serde_json::{json, Value};

use super::color::normalize_color_to_oklch;
use super::error::{ApiError, ApiResult};

/// A success response body. `{ "ok": true }`.
pub fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// A 201 Created response.
pub fn created() -> (StatusCode, Json<Value>) {
    (StatusCode::CREATED, Json(json!({ "ok": true })))
}

/// Same format as JS `new Date().toISOString()`: 2026-08-27T00:38:50.792Z
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// The current time in Korea Standard Time (UTC+9, no DST). The same regardless of the server host's timezone.
pub fn kst_now() -> chrono::DateTime<chrono::FixedOffset> {
    chrono::Utc::now().with_timezone(&chrono::FixedOffset::east_opt(9 * 3600).expect("KST offset"))
}

/// Today's date in KST (YYYY-MM-DD).
pub fn today_iso() -> String {
    kst_now().date_naive().to_string()
}

/// Normalizes a color input to OKLCH, or a validation error.
pub fn validated_color(raw: &str) -> ApiResult<String> {
    normalize_color_to_oklch(raw)
        .ok_or_else(|| ApiError::validation("색상은 OKLCH 또는 6자리 HEX 값이어야 합니다."))
}
