use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::{header, HeaderName};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use reqwest::Url;
use serde::Deserialize;

use super::error::ApiError;

// apps/api/src/repositories/link-preview-image-provider.ts + routes/link-preview.ts 이식.
// 페이지를 받아 og:image/twitter:image 메타를 뽑고 그 이미지를 프록시한다. SSRF 방어:
// localhost/.local·사설 IP 차단, 리디렉션마다 호스트 재검증(최대 4회), 크기·시간 상한.

const HTML_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
const REDIRECT_LIMIT: u32 = 4;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(7);
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const CACHE_LIMIT: usize = 32;
const SUPPORTED_IMAGE_TYPES: [&str; 5] =
    ["image/avif", "image/webp", "image/png", "image/jpeg", "image/gif"];

type Fallible<T> = Result<T, String>;

#[derive(Clone)]
struct PreviewImage {
    content_type: String,
    body: Vec<u8>,
}

// (요청 URL, 캐시된 시각, 이미지 or None=이미지 없음) — LRU는 Vec 순서로 굴린다.
type CacheEntry = (String, Instant, Option<PreviewImage>);

// ---------- 캐시 (Node의 30분 TTL · 32개 LRU) ----------

#[derive(Clone)]
pub(super) struct LinkPreviewState {
    cache: Arc<Mutex<Vec<CacheEntry>>>,
}

pub(super) fn state() -> LinkPreviewState {
    LinkPreviewState { cache: Arc::new(Mutex::new(Vec::new())) }
}

impl LinkPreviewState {
    async fn get(&self, page_url: &str) -> Option<PreviewImage> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some((_, expires, image)) = cache.iter().find(|(u, _, _)| u == page_url) {
                if *expires > Instant::now() {
                    return image.clone();
                }
            }
        }
        let image = fetch_image(page_url).await.ok().flatten();
        let mut cache = self.cache.lock().unwrap();
        cache.retain(|(u, _, _)| u != page_url);
        if cache.len() >= CACHE_LIMIT {
            cache.remove(0);
        }
        cache.push((page_url.to_string(), Instant::now() + CACHE_TTL, image.clone()));
        image
    }
}

// ---------- SSRF 방어 ----------

// link-preview-image-provider.ts isPrivateAddress
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, _, _] = v4.octets();
            a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 198 && (b == 18 || b == 19))
                || a >= 224
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(&IpAddr::V4(v4));
            }
            let seg0 = v6.segments()[0];
            let hi = (seg0 >> 8) as u8;
            hi == 0xfc || hi == 0xfd || (0xfe80..=0xfebf).contains(&seg0)
        }
    }
}

fn require_http_url(raw: &str) -> Fallible<Url> {
    let url = Url::parse(raw).map_err(|_| "링크 형식이 올바르지 않습니다.".to_string())?;
    let scheme_ok = matches!(url.scheme(), "http" | "https");
    if !scheme_ok || !url.username().is_empty() || url.password().is_some() {
        return Err("HTTP 또는 HTTPS 링크만 미리보기할 수 있습니다.".to_string());
    }
    Ok(url)
}

// 검증된 주소 목록을 돌려준다(첫 주소로 fetch를 pin). 이름은 DNS 조회.
async fn check_host(url: &Url) -> Fallible<Vec<IpAddr>> {
    let host = url.host_str().unwrap_or_default().to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("로컬 주소는 미리보기할 수 없습니다.".to_string());
    }
    let addresses: Vec<IpAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![ip]
    } else {
        let port = url.port_or_known_default().unwrap_or(443);
        tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| "링크 호스트를 확인할 수 없습니다.".to_string())?
            .map(|socket| socket.ip())
            .collect()
    };
    if addresses.is_empty() || addresses.iter().any(is_private_ip) {
        return Err("사설 네트워크 주소는 미리보기할 수 없습니다.".to_string());
    }
    Ok(addresses)
}

fn client_for(url: &Url, addresses: &[IpAddr]) -> Fallible<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT);
    if let Some(host) = url.host_str() {
        if host.parse::<IpAddr>().is_err() {
            if let Some(ip) = addresses.first() {
                let port = url.port_or_known_default().unwrap_or(443);
                builder = builder.resolve(host, SocketAddr::new(*ip, port));
            }
        }
    }
    builder.build().map_err(|e| e.to_string())
}

async fn fetch_public(raw_url: &str, accept: &str) -> Fallible<(reqwest::Response, Url)> {
    let mut url = require_http_url(raw_url)?;
    for redirect in 0..=REDIRECT_LIMIT {
        let addresses = check_host(&url).await?;
        let client = client_for(&url, &addresses)?;
        let response = client
            .get(url.clone())
            .header(header::ACCEPT, accept)
            .header(header::USER_AGENT, "MonoLinkPreview/1.0")
            .send()
            .await
            .map_err(|e| format!("링크 요청이 실패했습니다. ({e})"))?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            let location = response.headers().get(header::LOCATION).and_then(|v| v.to_str().ok());
            match location {
                Some(loc) if redirect < REDIRECT_LIMIT => {
                    let joined = url.join(loc).map_err(|_| "링크 리디렉션이 올바르지 않습니다.".to_string())?;
                    url = require_http_url(joined.as_str())?;
                    continue;
                }
                _ => return Err("링크 리디렉션이 올바르지 않습니다.".to_string()),
            }
        }
        if !(200..300).contains(&status) {
            return Err(format!("링크 요청이 실패했습니다. ({status})"));
        }
        return Ok((response, url));
    }
    Err("링크 리디렉션이 너무 많습니다.".to_string())
}

fn content_type_of(response: &reqwest::Response) -> String {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .unwrap_or("")
        .trim()
        .to_lowercase()
}

async fn read_limited(mut response: reqwest::Response, limit: usize) -> Fallible<Vec<u8>> {
    if let Some(len) = response.content_length() {
        if len as usize > limit {
            return Err("미리보기 응답이 너무 큽니다.".to_string());
        }
    }
    let mut buffer = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if buffer.len() + chunk.len() > limit {
            return Err("미리보기 응답이 너무 큽니다.".to_string());
        }
        buffer.extend_from_slice(&chunk);
    }
    Ok(buffer)
}

fn youtube_video_id(raw_url: &str) -> Option<String> {
    let url = require_http_url(raw_url).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let mut path = url.path_segments()?;
    let candidate = match host.as_str() {
        "youtu.be" | "www.youtu.be" => path.next().map(str::to_string),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            match path.next() {
                Some("watch") => url
                    .query_pairs()
                    .find_map(|(key, value)| (key == "v").then(|| value.into_owned())),
                Some("shorts" | "embed" | "live") => path.next().map(str::to_string),
                _ => None,
            }
        }
        "youtube-nocookie.com" | "www.youtube-nocookie.com" => match path.next() {
            Some("embed") => path.next().map(str::to_string),
            _ => None,
        },
        _ => None,
    }?;
    (candidate.len() == 11
        && candidate
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
    .then_some(candidate)
}

fn youtube_thumbnail_url(raw_url: &str) -> Option<Url> {
    let video_id = youtube_video_id(raw_url)?;
    Url::parse(&format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")).ok()
}

async fn fetch_preview_image(image_url: &Url) -> Fallible<Option<PreviewImage>> {
    let (image, _) = fetch_public(
        image_url.as_str(),
        "image/avif,image/webp,image/png,image/jpeg,image/gif",
    )
    .await?;
    let image_type = content_type_of(&image);
    if !SUPPORTED_IMAGE_TYPES.contains(&image_type.as_str()) {
        return Ok(None);
    }
    let body = read_limited(image, IMAGE_LIMIT).await?;
    Ok(Some(PreviewImage {
        content_type: image_type,
        body,
    }))
}

async fn fetch_image(page_url: &str) -> Fallible<Option<PreviewImage>> {
    if let Some(image_url) = youtube_thumbnail_url(page_url) {
        return fetch_preview_image(&image_url).await;
    }

    let (page, final_url) = fetch_public(page_url, "text/html,application/xhtml+xml").await?;
    let page_type = content_type_of(&page);
    if !page_type.contains("text/html") && !page_type.contains("application/xhtml+xml") {
        return Ok(None);
    }
    let html_bytes = read_limited(page, HTML_LIMIT).await?;
    let html = String::from_utf8_lossy(&html_bytes);
    let Some(image_ref) = preview_image_ref(&html) else {
        return Ok(None);
    };
    let image_url = final_url.join(&image_ref).map_err(|e| e.to_string())?;
    fetch_preview_image(&image_url).await
}

// ---------- HTML 메타 파싱 (previewImageRefOf / attributesOf / decodeHtmlEntities) ----------

fn preview_image_ref(html: &str) -> Option<String> {
    let mut candidates: HashMap<String, String> = HashMap::new();
    for tag in meta_tags(html) {
        let attributes = attributes_of(&tag);
        let key = attributes
            .get("property")
            .or_else(|| attributes.get("name"))
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if let (false, Some(content)) = (key.is_empty(), attributes.get("content")) {
            candidates.entry(key).or_insert_with(|| decode_html_entities(content));
        }
    }
    ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]
        .into_iter()
        .find_map(|key| candidates.get(key).cloned())
}

// <meta ...> 태그 문자열들. 따옴표 안의 '>'는 고려 안 함(Node 정규식과 동일 한계).
fn meta_tags(html: &str) -> Vec<String> {
    let lower = html.to_lowercase();
    let bytes = lower.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(rel) = lower[i..].find("<meta") {
        let start = i + rel;
        let boundary = bytes.get(start + 5).copied();
        if !matches!(boundary, Some(b) if b == b'>' || b == b'/' || b.is_ascii_whitespace()) {
            i = start + 5;
            continue;
        }
        let end = html[start..].find('>').map(|e| start + e).unwrap_or(html.len());
        out.push(html[start..end].to_string());
        i = end + 1;
    }
    out
}

fn is_attr_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b':' || b == b'-'
}

fn attributes_of(tag: &str) -> HashMap<String, String> {
    let bytes = tag.as_bytes();
    let mut attributes = HashMap::new();
    let mut i = 5.min(bytes.len()); // "<meta" 건너뜀
    while i < bytes.len() {
        while i < bytes.len() && !is_attr_char(bytes[i]) {
            i += 1;
        }
        let key_start = i;
        while i < bytes.len() && is_attr_char(bytes[i]) {
            i += 1;
        }
        if key_start == i {
            break;
        }
        let key = tag[key_start..i].to_lowercase();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            attributes.entry(key).or_insert_with(String::new);
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let value = if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
            let quote = bytes[i];
            i += 1;
            let value_start = i;
            while i < bytes.len() && bytes[i] != quote {
                i += 1;
            }
            let value = tag[value_start..i].to_string();
            if i < bytes.len() {
                i += 1;
            }
            value
        } else {
            let value_start = i;
            while i < bytes.len()
                && !bytes[i].is_ascii_whitespace()
                && !matches!(bytes[i], b'"' | b'\'' | b'=' | b'<' | b'>' | b'`')
            {
                i += 1;
            }
            tag[value_start..i].to_string()
        };
        attributes.insert(key, value);
    }
    attributes
}

fn decode_html_entities(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < value.len() {
        if bytes[i] == b'&' {
            if let Some(semi) = value[i..].find(';').map(|e| i + e) {
                let entity = &value[i + 1..semi];
                let decoded = match entity {
                    "amp" => Some('&'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                        u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
                    }
                    _ if entity.starts_with('#') => {
                        entity[1..].parse::<u32>().ok().and_then(char::from_u32)
                    }
                    _ => None,
                };
                if let Some(c) = decoded {
                    out.push(c);
                    i = semi + 1;
                    continue;
                }
            }
        }
        let ch = value[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

// ---------- 라우트 ----------

#[derive(Deserialize)]
struct UrlQuery {
    url: Option<String>,
}

pub(super) fn routes(state: LinkPreviewState) -> Router {
    Router::new().route("/link-previews/image", get(image_handler)).with_state(state)
}

async fn image_handler(
    State(state): State<LinkPreviewState>,
    Query(query): Query<UrlQuery>,
) -> Result<Response, ApiError> {
    let url = query.url.ok_or_else(|| ApiError::BadRequest("미리보기할 링크가 없습니다.".into()))?;
    match state.get(&url).await {
        Some(image) => Ok((
            [
                (header::CONTENT_TYPE, image.content_type),
                (header::CACHE_CONTROL, "private, max-age=1800".to_string()),
                (HeaderName::from_static("x-content-type-options"), "nosniff".to_string()),
            ],
            image.body,
        )
            .into_response()),
        None => Err(ApiError::BadRequest("링크 미리보기 이미지를 찾을 수 없습니다.".into())),
    }
}

// ---------- 테스트 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ip_ranges() {
        for addr in ["10.0.0.1", "127.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.0.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1"] {
            assert!(is_private_ip(&addr.parse().unwrap()), "{addr} should be private");
        }
        for addr in ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:2800:220:1::1"] {
            assert!(!is_private_ip(&addr.parse().unwrap()), "{addr} should be public");
        }
    }

    #[test]
    fn require_http_url_rejects_non_http_and_credentials() {
        assert!(require_http_url("file:///etc/passwd").is_err());
        assert!(require_http_url("ftp://example.com").is_err());
        assert!(require_http_url("http://user:pass@example.com").is_err());
        assert!(require_http_url("https://example.com/x").is_ok());
    }

    #[test]
    fn youtube_urls_resolve_to_direct_thumbnail() {
        for url in [
            "https://youtu.be/-XJXbxTMkUQ?si=share-token",
            "https://www.youtube.com/watch?v=-XJXbxTMkUQ&list=WL",
            "https://m.youtube.com/shorts/-XJXbxTMkUQ",
            "https://www.youtube.com/embed/-XJXbxTMkUQ",
            "https://www.youtube-nocookie.com/embed/-XJXbxTMkUQ",
        ] {
            assert_eq!(
                youtube_thumbnail_url(url).as_ref().map(Url::as_str),
                Some("https://i.ytimg.com/vi/-XJXbxTMkUQ/hqdefault.jpg"),
                "{url}"
            );
        }
    }

    #[test]
    fn youtube_thumbnail_rejects_invalid_or_lookalike_urls() {
        for url in [
            "https://youtu.be/short",
            "https://youtu.be/abcdefghijk%2Fprivate",
            "https://youtube.example/watch?v=-XJXbxTMkUQ",
            "https://www.youtube.com/watch?v=invalid.id",
            "javascript:alert(1)",
        ] {
            assert_eq!(youtube_thumbnail_url(url), None, "{url}");
        }
    }

    #[tokio::test]
    async fn check_host_blocks_local_and_private_literals() {
        assert!(check_host(&Url::parse("http://localhost/x").unwrap()).await.is_err());
        assert!(check_host(&Url::parse("http://foo.local/x").unwrap()).await.is_err());
        assert!(check_host(&Url::parse("http://127.0.0.1/x").unwrap()).await.is_err());
        assert!(check_host(&Url::parse("http://10.1.2.3/x").unwrap()).await.is_err());
    }

    #[test]
    fn parses_og_image_with_entities() {
        let html = r#"<meta content="/cover.jpg?x=1&amp;y=2" property="og:image">"#;
        assert_eq!(preview_image_ref(html).as_deref(), Some("/cover.jpg?x=1&y=2"));
    }

    #[test]
    fn falls_back_to_twitter_image_single_quotes() {
        let html = "<meta name='twitter:image' content='https://cdn.example.com/card.webp'>";
        assert_eq!(
            preview_image_ref(html).as_deref(),
            Some("https://cdn.example.com/card.webp")
        );
    }

    #[test]
    fn og_image_wins_over_twitter() {
        let html = "<meta property=\"og:image\" content=\"a.png\">\n<meta name=\"twitter:image\" content=\"b.png\">";
        assert_eq!(preview_image_ref(html).as_deref(), Some("a.png"));
    }

    #[test]
    fn no_meta_returns_none() {
        assert_eq!(preview_image_ref("<html><body>hi</body></html>"), None);
    }

    #[test]
    fn relative_ref_resolves_against_final_url() {
        let base = Url::parse("https://example.com/article").unwrap();
        assert_eq!(
            base.join("/cover.jpg?x=1&y=2").unwrap().as_str(),
            "https://example.com/cover.jpg?x=1&y=2"
        );
    }

    #[test]
    fn decode_entities_handles_numeric() {
        assert_eq!(decode_html_entities("A&#66;C"), "ABC");
        assert_eq!(decode_html_entities("&#x41;&amp;&#x42;"), "A&B");
        assert_eq!(decode_html_entities("plain & text"), "plain & text");
    }
}
