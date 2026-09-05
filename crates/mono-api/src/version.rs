use axum::http::header::IF_MATCH;
use axum::http::HeaderMap;

use crate::error::{ApiError, ApiResult};

pub fn expected_version(headers: &HeaderMap) -> ApiResult<Option<i64>> {
    let Some(value) = headers.get(IF_MATCH) else {
        // During a server-first rollout window, an older client is allowed.
        return Ok(None);
    };
    let raw = value
        .to_str()
        .map_err(|_| ApiError::validation("If-Match 버전 헤더가 올바르지 않습니다."))?;
    let version = raw
        .trim()
        .trim_matches('"')
        .parse::<i64>()
        .map_err(|_| ApiError::validation("If-Match 버전 헤더가 올바르지 않습니다."))?;
    if version < 1 {
        return Err(ApiError::validation(
            "If-Match 버전은 1 이상의 정수여야 합니다.",
        ));
    }
    Ok(Some(version))
}

pub fn ensure_versioned_update(changed: usize, expected: Option<i64>) -> ApiResult<()> {
    if changed == 0 && expected.is_some() {
        return Err(ApiError::Conflict(
            "다른 기기에서 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn parses_quoted_etag_version() {
        let mut headers = HeaderMap::new();
        headers.insert(IF_MATCH, HeaderValue::from_static("\"7\""));
        assert_eq!(expected_version(&headers).unwrap(), Some(7));
    }

    #[test]
    fn rejects_stale_update() {
        assert!(matches!(
            ensure_versioned_update(0, Some(1)),
            Err(ApiError::Conflict(_))
        ));
        assert!(ensure_versioned_update(1, Some(1)).is_ok());
        assert!(ensure_versioned_update(1, None).is_ok());
    }
}
