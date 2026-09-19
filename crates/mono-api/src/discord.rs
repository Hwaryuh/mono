use std::time::Duration;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use super::ai::CaptureImage;
use super::change::ChangeHub;
use super::common::*;
use super::dashboard::{self, CaptureInput};
use super::db::DbExt;
use super::error::{ApiError, ApiResult};
use super::media;
use super::secret::{self, SecretState};

// Discord channel → inbox. A bot token + channel ID are stored in `secrets`, and a background task polls
// the channel over REST and feeds each new message to dashboard::capture (same path as the quick-capture box).
// ponytail: polling instead of the Gateway websocket. Swap to serenity if seconds of latency ever matter.

const API: &str = "https://discord.com/api/v10";
const TOKEN_KEY: &str = "discord_bot_token";
const CHANNEL_KEY: &str = "discord_channel_id";
const CURSOR_KEY: &str = "discord_last_message_id";
const POLL_INTERVAL: Duration = Duration::from_secs(15);
const MAX_IMAGES: usize = 4;
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 2_000;

struct Attachment {
    url: String,
    name: String,
    mime_type: String,
    size: u64,
}

struct Message {
    id: String,
    text: String,
    attachments: Vec<Attachment>,
}

// Oldest first, bots (including ourselves) dropped. Snowflake IDs sort numerically, which is chronological.
fn parse_messages(body: &Value) -> Vec<Message> {
    let mut messages: Vec<(u64, Message)> = body
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| !m["author"]["bot"].as_bool().unwrap_or(false))
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            let numeric = id.parse::<u64>().ok()?;
            let attachments = m["attachments"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| {
                    let mime_type = a["content_type"].as_str()?.split(';').next()?.to_string();
                    mime_type.starts_with("image/").then(|| Attachment {
                        url: a["url"].as_str().unwrap_or_default().to_string(),
                        name: a["filename"].as_str().unwrap_or("image").to_string(),
                        mime_type,
                        size: a["size"].as_u64().unwrap_or(0),
                    })
                })
                .take(MAX_IMAGES)
                .collect();
            let text = m["content"].as_str().unwrap_or_default().trim().chars().take(MAX_TEXT_CHARS).collect();
            Some((numeric, Message { id, text, attachments }))
        })
        .collect();
    messages.sort_by_key(|(numeric, _)| *numeric);
    messages.into_iter().map(|(_, m)| m).collect()
}

const WAITING: &str = "%E2%8F%B3"; // ⏳
const DONE: &str = "%E2%9C%85"; // ✅
const FAILED: &str = "%E2%9D%8C"; // ❌

// Needs the bot's "Add Reactions" permission; without it this just logs and the capture is unaffected.
// Discord wants ~250ms between reaction calls, hence the sleep.
async fn react(client: &reqwest::Client, token: &str, channel: &str, message: &str, emoji: &str, add: bool) {
    let method = if add { reqwest::Method::PUT } else { reqwest::Method::DELETE };
    let result = client
        .request(method, format!("{API}/channels/{channel}/messages/{message}/reactions/{emoji}/@me"))
        .header("Authorization", format!("Bot {token}"))
        .header("Content-Length", "0")
        .send()
        .await
        .and_then(|r| r.error_for_status());
    if let Err(error) = result {
        eprintln!("discord: 리액션 실패({message}): {error}");
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
}

async fn discord_get(client: &reqwest::Client, token: &str, path: &str) -> ApiResult<Value> {
    let fail = |message: String| ApiError::BadRequest(format!("Discord 요청 실패: {message}"));
    let response = client
        .get(format!("{API}{path}"))
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| fail(e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(fail(format!("HTTP {status}")));
    }
    let text = response.text().await.map_err(|e| fail(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| fail(e.to_string()))
}

// Downloads image attachments and stores them in R2 so the inbox item can show them. Without R2 credentials
// the images are skipped (the text still goes through).
async fn load_images(state: &SecretState, client: &reqwest::Client, attachments: &[Attachment]) -> Vec<CaptureImage> {
    let Ok(r2) = media::client_from(state) else {
        return Vec::new();
    };
    let mut images = Vec::new();
    for attachment in attachments.iter().filter(|a| a.size <= MAX_IMAGE_BYTES) {
        let result: Result<CaptureImage, String> = async {
            let bytes = client
                .get(&attachment.url)
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
            let media_id = uuid::Uuid::new_v4().to_string();
            r2.put(&media_id, bytes.to_vec(), &attachment.mime_type).await.map_err(|e| e.to_string())?;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(CaptureImage {
                name: attachment.name.clone(),
                mime_type: attachment.mime_type.clone(),
                size: bytes.len() as i64,
                media_id,
                data_url: Some(format!("data:{};base64,{encoded}", attachment.mime_type)),
            })
        }
        .await;
        match result {
            Ok(image) => images.push(image),
            Err(error) => eprintln!("discord: 이미지 {} 건너뜀: {error}", attachment.name),
        }
    }
    images
}

async fn poll_once(state: &SecretState, hub: &ChangeHub, client: &reqwest::Client) -> ApiResult<()> {
    let (token, channel, cursor) = {
        let conn = state.db.conn();
        (
            secret::get_secret(&conn, &state.crypto, TOKEN_KEY)?,
            secret::get_plain(&conn, CHANNEL_KEY)?,
            secret::get_plain(&conn, CURSOR_KEY)?,
        )
    };
    let (Some(token), Some(channel)) = (token, channel) else {
        return Ok(());
    };

    // First run: anchor at the newest message so the channel's history isn't imported.
    let Some(mut cursor) = cursor else {
        let latest = discord_get(client, &token, &format!("/channels/{channel}/messages?limit=1")).await?;
        let anchor = latest[0]["id"].as_str().unwrap_or("0");
        secret::set_plain(&state.db.conn(), CURSOR_KEY, anchor)?;
        return Ok(());
    };

    loop {
        let body =
            discord_get(client, &token, &format!("/channels/{channel}/messages?limit=100&after={cursor}")).await?;
        let fetched = body.as_array().map_or(0, Vec::len);
        // Bot messages are filtered out of `messages`, so the cursor has to follow the raw maximum ID.
        let newest = body
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|m| m["id"].as_str())
            .max_by_key(|id| id.parse::<u64>().unwrap_or(0))
            .map(str::to_string);
        for message in parse_messages(&body) {
            let images = load_images(state, client, &message.attachments).await;
            if message.text.is_empty() && images.is_empty() {
                continue;
            }
            react(client, &token, &channel, &message.id, WAITING, true).await;
            let input = CaptureInput { raw: message.text, images, videos: vec![] };
            // A message that fails validation is logged and skipped — retrying it every poll would never succeed.
            let analyzed = match dashboard::capture(state, input).await {
                Ok(analyzed) => analyzed,
                Err(error) => {
                    eprintln!("discord: 메시지 {} 수집 실패: {error:?}", message.id);
                    false
                }
            };
            react(client, &token, &channel, &message.id, WAITING, false).await;
            react(client, &token, &channel, &message.id, if analyzed { DONE } else { FAILED }, true).await;
            secret::set_plain(&state.db.conn(), CURSOR_KEY, &message.id)?;
            hub.publish(&["dashboard", "inbox", "todo", "routine"]);
        }
        let Some(newest) = newest else { break };
        secret::set_plain(&state.db.conn(), CURSOR_KEY, &newest)?;
        cursor = newest;
        if fetched < 100 {
            break;
        }
    }
    Ok(())
}

pub(super) fn spawn(state: SecretState, hub: ChangeHub) {
    tokio::spawn(async move {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().expect("reqwest client");
        loop {
            if let Err(error) = poll_once(&state, &hub, &client).await {
                eprintln!("discord: 폴링 실패: {error:?}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

// ---------- Routes ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigInput {
    // Empty/absent keeps the stored token, so the channel can be changed without retyping it.
    #[serde(default)]
    token: String,
    channel_id: String,
}

pub(super) fn routes(state: SecretState) -> Router {
    Router::new().route("/discord/config", get(config_get).post(config_set).delete(config_delete)).with_state(state)
}

async fn config_get(State(st): State<SecretState>) -> ApiResult<Json<Value>> {
    let conn = st.db.conn();
    Ok(Json(json!({
        "hasToken": secret::has_key(&conn, TOKEN_KEY)?,
        "channelId": secret::get_plain(&conn, CHANNEL_KEY)?,
    })))
}

async fn config_set(
    State(st): State<SecretState>,
    Json(input): Json<ConfigInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    let channel = input.channel_id.trim();
    if channel.is_empty() || !channel.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::BadRequest("채널 ID는 숫자여야 합니다.".into()));
    }
    let token = match input.token.trim() {
        "" => secret::get_secret(&st.db.conn(), &st.crypto, TOKEN_KEY)?,
        given => Some(given.to_string()),
    }
    .ok_or_else(|| ApiError::BadRequest("봇 토큰을 입력해야 합니다.".into()))?;

    // Catches a wrong token / channel / missing permission now instead of failing silently in the poller.
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("reqwest client");
    discord_get(&client, &token, &format!("/channels/{channel}/messages?limit=1")).await?;

    let conn = st.db.conn();
    secret::set_key(&conn, &st.crypto, TOKEN_KEY, &token)?;
    secret::set_plain(&conn, CHANNEL_KEY, channel)?;
    // Re-anchor: the next poll starts from the channel's newest message.
    secret::delete_key(&conn, CURSOR_KEY)?;
    Ok(created())
}

async fn config_delete(State(st): State<SecretState>) -> ApiResult<Json<Value>> {
    let conn = st.db.conn();
    for key in [TOKEN_KEY, CHANNEL_KEY, CURSOR_KEY] {
        secret::delete_key(&conn, key)?;
    }
    Ok(ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_oldest_first_and_drops_bots() {
        let body = json!([
            { "id": "30", "content": "  셋째 ", "author": {}, "attachments": [] },
            { "id": "20", "content": "봇", "author": { "bot": true }, "attachments": [] },
            { "id": "10", "content": "첫째", "author": {}, "attachments": [
                { "url": "https://cdn/x.png", "filename": "x.png", "content_type": "image/png; charset=x", "size": 5 },
                { "url": "https://cdn/y.pdf", "filename": "y.pdf", "content_type": "application/pdf", "size": 5 }
            ] }
        ]);
        let messages = parse_messages(&body);
        assert_eq!(messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["10", "30"]);
        assert_eq!(messages[1].text, "셋째");
        assert_eq!(messages[0].attachments.len(), 1);
        assert_eq!(messages[0].attachments[0].mime_type, "image/png");
    }
}
