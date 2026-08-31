use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

// apps/api/src/server.ts setErrorHandler 와 같은 시맨틱:
//   ZodError            -> 422  {"error": [{"message": ...}, ...]}
//   "...찾을 수 없습니다" -> 404  {"error": "..."}
//   그 외                -> 400  {"error": "..."}
#[derive(Debug)]
pub enum ApiError {
    NotFound(String),
    Validation(Vec<String>),
    BadRequest(String),
    // 낙관적 동시성 충돌 — 다른 기기가 먼저 같은 레코드를 수정했다. If-Match 버전 불일치.
    Conflict(String),
    Internal(String),
}

impl ApiError {
    pub fn validation(message: impl Into<String>) -> Self {
        ApiError::Validation(vec![message.into()])
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::NotFound(m) | ApiError::BadRequest(m) | ApiError::Conflict(m) | ApiError::Internal(m) => write!(f, "{m}"),
            ApiError::Validation(ms) => write!(f, "{}", ms.join(", ")),
        }
    }
}

impl std::error::Error for ApiError {}

impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        ApiError::Internal(error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::NotFound(message) => {
                (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
            }
            ApiError::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
            }
            ApiError::Conflict(message) => {
                (StatusCode::CONFLICT, Json(json!({ "error": message }))).into_response()
            }
            ApiError::Internal(message) => {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
            }
            ApiError::Validation(messages) => {
                let issues: Vec<_> = messages.into_iter().map(|m| json!({ "message": m })).collect();
                (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "error": issues }))).into_response()
            }
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
