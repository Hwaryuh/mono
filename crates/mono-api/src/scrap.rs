use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::SecondsFormat;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::db::Db;
use super::error::{ApiError, ApiResult};

// apps/api/src/db/schema.ts SCRAP_OTHER_TAG
const OTHER_TAG: &str = "기타";

// ---------- DTO (packages/contracts/src/index.ts scrap* 스키마) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapComment {
    id: String,
    created_at: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapItem {
    id: String,
    kind: String,
    title: String,
    memo: String,
    tag: String,
    saved_at: String,
    url: Option<String>,
    media_id: Option<String>,
    comments: Vec<ScrapComment>,
}

#[derive(Serialize)]
struct ScrapSnapshot {
    tags: Vec<String>,
    items: Vec<ScrapItem>,
}

#[derive(Deserialize)]
struct ScrapWriteInput {
    title: String,
    #[serde(default)]
    memo: String,
    #[serde(default)]
    url: String,
    tag: String,
    #[serde(default)]
    #[serde(rename = "mediaId")]
    media_id: Option<String>,
}

#[derive(Deserialize)]
struct CommentInput {
    text: String,
}

#[derive(Deserialize)]
struct AddTagInput {
    tag: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameTagInput {
    next_tag: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteTagInput {
    replacement_tag: String,
}

// ---------- 검증 ----------

fn validated_title(raw: &str) -> ApiResult<String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(ApiError::validation("제목을 입력해야 합니다."));
    }
    if title.chars().count() > 500 {
        return Err(ApiError::validation("제목은 500자 이하여야 합니다."));
    }
    Ok(title.to_string())
}

fn validated_memo(raw: &str) -> ApiResult<String> {
    if raw.chars().count() > 4_000 {
        return Err(ApiError::validation("메모는 4000자 이하여야 합니다."));
    }
    Ok(raw.to_string())
}

fn validated_url(raw: &str) -> ApiResult<String> {
    let url = raw.trim();
    if url.chars().count() > 2_000 {
        return Err(ApiError::validation("링크는 2000자 이하여야 합니다."));
    }
    Ok(url.to_string())
}

// contracts scrapWriteInputSchema.shape.tag: z.string().trim().min(1).max(100)
fn validated_tag(raw: &str) -> ApiResult<String> {
    let tag = raw.trim();
    if tag.is_empty() {
        return Err(ApiError::validation("라벨 이름을 입력해야 합니다."));
    }
    if tag.chars().count() > 100 {
        return Err(ApiError::validation("라벨 이름은 100자 이하여야 합니다."));
    }
    Ok(tag.to_string())
}

fn validated_media_id(raw: Option<&str>) -> ApiResult<Option<String>> {
    let Some(id) = raw else {
        return Ok(None);
    };
    let valid = id.len() == 36
        && id.as_bytes().iter().enumerate().all(|(index, &byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });
    if !valid {
        return Err(ApiError::validation("올바르지 않은 미디어 id입니다."));
    }
    Ok(Some(id.to_string()))
}

fn validated_comment(raw: &str) -> ApiResult<String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(ApiError::validation("댓글 내용을 입력해야 합니다."));
    }
    if text.chars().count() > 2_000 {
        return Err(ApiError::validation("댓글은 2000자 이하여야 합니다."));
    }
    Ok(text.to_string())
}

// ---------- 저장소 로직 (apps/api/src/repositories/scrap-repository.ts 1:1) ----------

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn get_snapshot(conn: &Connection) -> ApiResult<ScrapSnapshot> {
    let tags: Vec<String> = conn
        .prepare("SELECT tag FROM scrap_tags ORDER BY rowid")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let mut items = conn
        .prepare(
            "SELECT id, kind, title, memo, tag, saved_at, url, media_id FROM scrap_items ORDER BY seq DESC",
        )?
        .query_map([], |row| {
            Ok(ScrapItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                memo: row.get(3)?,
                tag: row.get(4)?,
                saved_at: row.get(5)?,
                url: row.get(6)?,
                media_id: row.get(7)?,
                comments: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let comments = conn
        .prepare("SELECT id, scrap_id, created_at, text FROM scrap_comments ORDER BY seq ASC")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                ScrapComment { id: row.get(0)?, created_at: row.get(2)?, text: row.get(3)? },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for (scrap_id, comment) in comments {
        if let Some(item) = items.iter_mut().find(|item| item.id == scrap_id) {
            item.comments.push(comment);
        }
    }

    Ok(ScrapSnapshot { tags, items })
}

fn require_scrap(conn: &Connection, id: &str) -> ApiResult<()> {
    conn.query_row("SELECT 1 FROM scrap_items WHERE id = ?1", [id], |_| Ok(()))
        .map_err(|_| ApiError::NotFound(format!("스크랩을 찾을 수 없습니다: {id}")))
}

fn require_comment(conn: &Connection, scrap_id: &str, comment_id: &str) -> ApiResult<()> {
    let owner: Option<String> = conn
        .query_row("SELECT scrap_id FROM scrap_comments WHERE id = ?1", [comment_id], |row| row.get(0))
        .ok();
    if owner.as_deref() == Some(scrap_id) {
        Ok(())
    } else {
        Err(ApiError::NotFound(format!("댓글을 찾을 수 없습니다: {comment_id}")))
    }
}

fn require_tag(conn: &Connection, tag: &str) -> ApiResult<()> {
    conn.query_row("SELECT 1 FROM scrap_tags WHERE tag = ?1", [tag], |_| Ok(()))
        .map_err(|_| ApiError::NotFound(format!("라벨을 찾을 수 없습니다: {tag}")))
}

fn create_scrap(conn: &mut Connection, input: ScrapWriteInput) -> ApiResult<()> {
    let title = validated_title(&input.title)?;
    let memo = validated_memo(&input.memo)?;
    let url = validated_url(&input.url)?;
    let tag = validated_tag(&input.tag)?;
    let media_id = validated_media_id(input.media_id.as_deref())?;
    let kind = if media_id.is_some() {
        "image"
    } else if url.is_empty() {
        "text"
    } else {
        "url"
    };

    let tx = conn.transaction()?;
    tx.execute("INSERT OR IGNORE INTO scrap_tags (tag) VALUES (?1)", [&tag])?;
    let next_seq: i64 =
        tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM scrap_items", [], |row| row.get(0))?;
    tx.execute(
        "INSERT INTO scrap_items (id, seq, kind, title, memo, tag, saved_at, url, media_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            kind,
            title,
            memo,
            tag,
            now_iso(),
            if url.is_empty() { None } else { Some(url) },
            media_id,
        ],
    )?;
    tx.commit()?;
    Ok(())
}

fn delete_scrap(conn: &mut Connection, id: &str) -> ApiResult<()> {
    require_scrap(conn, id)?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM scrap_comments WHERE scrap_id = ?1", [id])?;
    tx.execute("DELETE FROM scrap_items WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

fn add_tag(conn: &Connection, tag: &str) -> ApiResult<()> {
    let tag = validated_tag(tag)?;
    conn.execute("INSERT OR IGNORE INTO scrap_tags (tag) VALUES (?1)", [&tag])?;
    Ok(())
}

fn rename_tag(conn: &mut Connection, tag: &str, next_tag: &str) -> ApiResult<()> {
    let parsed = validated_tag(next_tag)?;
    require_tag(conn, tag)?;
    if parsed != tag {
        let clash = conn
            .query_row("SELECT 1 FROM scrap_tags WHERE tag = ?1", [&parsed], |_| Ok(()))
            .is_ok();
        if clash {
            return Err(ApiError::BadRequest("같은 이름의 라벨이 이미 있습니다.".into()));
        }
    }
    let tx = conn.transaction()?;
    tx.execute("UPDATE scrap_tags SET tag = ?1 WHERE tag = ?2", params![parsed, tag])?;
    tx.execute("UPDATE scrap_items SET tag = ?1 WHERE tag = ?2", params![parsed, tag])?;
    tx.commit()?;
    Ok(())
}

fn delete_tag(conn: &mut Connection, tag: &str, replacement: &str) -> ApiResult<()> {
    require_tag(conn, tag)?;
    if tag == OTHER_TAG {
        return Err(ApiError::BadRequest("기타 라벨은 삭제할 수 없습니다.".into()));
    }
    require_tag(conn, replacement)?;
    if tag == replacement {
        return Err(ApiError::BadRequest("삭제할 라벨과 이동할 라벨은 달라야 합니다.".into()));
    }
    let tx = conn.transaction()?;
    tx.execute("UPDATE scrap_items SET tag = ?1 WHERE tag = ?2", params![replacement, tag])?;
    tx.execute("DELETE FROM scrap_tags WHERE tag = ?1", [tag])?;
    tx.commit()?;
    Ok(())
}

fn add_comment(conn: &Connection, scrap_id: &str, text: &str) -> ApiResult<()> {
    require_scrap(conn, scrap_id)?;
    let text = validated_comment(text)?;
    let next_seq: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM scrap_comments WHERE scrap_id = ?1",
        [scrap_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO scrap_comments (id, scrap_id, seq, created_at, text) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![uuid::Uuid::new_v4().to_string(), scrap_id, next_seq + 1, now_iso(), text],
    )?;
    Ok(())
}

fn update_comment(conn: &Connection, scrap_id: &str, comment_id: &str, text: &str) -> ApiResult<()> {
    require_scrap(conn, scrap_id)?;
    require_comment(conn, scrap_id, comment_id)?;
    let text = validated_comment(text)?;
    conn.execute("UPDATE scrap_comments SET text = ?1 WHERE id = ?2", params![text, comment_id])?;
    Ok(())
}

fn delete_comment(conn: &Connection, scrap_id: &str, comment_id: &str) -> ApiResult<()> {
    require_scrap(conn, scrap_id)?;
    require_comment(conn, scrap_id, comment_id)?;
    conn.execute("DELETE FROM scrap_comments WHERE id = ?1", [comment_id])?;
    Ok(())
}

// ---------- 라우트 (apps/api/src/routes/scrap.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/scrap/snapshot", get(snapshot_handler))
        .route("/scrap/items", post(create_scrap_handler))
        .route("/scrap/items/{id}", axum::routing::delete(delete_scrap_handler))
        .route("/scrap/tags", post(add_tag_handler))
        .route(
            "/scrap/tags/{tag}",
            put(rename_tag_handler).delete(delete_tag_handler),
        )
        .route("/scrap/items/{id}/comments", post(add_comment_handler))
        .route(
            "/scrap/items/{id}/comments/{commentId}",
            put(update_comment_handler).delete(delete_comment_handler),
        )
        .with_state(db)
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn created() -> (axum::http::StatusCode, Json<Value>) {
    (axum::http::StatusCode::CREATED, Json(json!({ "ok": true })))
}

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<ScrapSnapshot>> {
    Ok(Json(get_snapshot(&db.lock().unwrap())?))
}

async fn create_scrap_handler(
    State(db): State<Db>,
    Json(input): Json<ScrapWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_scrap(&mut db.lock().unwrap(), input)?;
    Ok(created())
}

async fn delete_scrap_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    delete_scrap(&mut db.lock().unwrap(), &id)?;
    Ok(ok())
}

async fn add_tag_handler(
    State(db): State<Db>,
    Json(input): Json<AddTagInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    add_tag(&db.lock().unwrap(), &input.tag)?;
    Ok(created())
}

async fn rename_tag_handler(
    State(db): State<Db>,
    Path(tag): Path<String>,
    Json(input): Json<RenameTagInput>,
) -> ApiResult<Json<Value>> {
    rename_tag(&mut db.lock().unwrap(), &tag, &input.next_tag)?;
    Ok(ok())
}

async fn delete_tag_handler(
    State(db): State<Db>,
    Path(tag): Path<String>,
    Json(input): Json<DeleteTagInput>,
) -> ApiResult<Json<Value>> {
    delete_tag(&mut db.lock().unwrap(), &tag, &input.replacement_tag)?;
    Ok(ok())
}

async fn add_comment_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<CommentInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    add_comment(&db.lock().unwrap(), &id, &input.text)?;
    Ok(created())
}

async fn update_comment_handler(
    State(db): State<Db>,
    Path((id, comment_id)): Path<(String, String)>,
    Json(input): Json<CommentInput>,
) -> ApiResult<Json<Value>> {
    update_comment(&db.lock().unwrap(), &id, &comment_id, &input.text)?;
    Ok(ok())
}

async fn delete_comment_handler(
    State(db): State<Db>,
    Path((id, comment_id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    delete_comment(&db.lock().unwrap(), &id, &comment_id)?;
    Ok(ok())
}

// ---------- 테스트 (apps/api/src/repositories/scrap-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn write_input(title: &str, url: &str, tag: &str) -> ScrapWriteInput {
        ScrapWriteInput {
            title: title.into(),
            memo: String::new(),
            url: url.into(),
            tag: tag.into(),
            media_id: None,
        }
    }

    fn first_scrap_id(conn: &Connection) -> String {
        get_snapshot(conn).unwrap().items[0].id.clone()
    }

    #[test]
    fn other_tag_always_present() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().tags, vec!["기타".to_string()]);
    }

    #[test]
    fn other_tag_cannot_be_deleted() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let err = delete_tag(&mut conn, "기타", "기타").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("기타 라벨은 삭제할 수 없습니다")));
    }

    #[test]
    fn create_adds_tag_and_splits_kind() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("링크 스크랩", "https://example.com", "읽을거리")).unwrap();
        create_scrap(&mut conn, write_input("메모 스크랩", "", "읽을거리")).unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(snapshot.tags, vec!["기타".to_string(), "읽을거리".to_string()]);
        assert_eq!(
            snapshot.items.iter().map(|i| i.kind.as_str()).collect::<Vec<_>>(),
            ["text", "url"]
        );
    }

    #[test]
    fn create_with_media_id_makes_image_scrap() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let mut input = write_input("사진 스크랩", "", "사진");
        let media_id = "00000000-0000-4000-8000-000000000001";
        input.media_id = Some(media_id.into());

        create_scrap(&mut conn, input).unwrap();

        let item = &get_snapshot(&conn).unwrap().items[0];
        assert_eq!(item.kind, "image");
        assert_eq!(item.media_id.as_deref(), Some(media_id));
    }

    #[test]
    fn create_rejects_invalid_media_id() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let mut input = write_input("사진 스크랩", "", "사진");
        input.media_id = Some("../not-an-id".into());

        let err = create_scrap(&mut conn, input).unwrap_err();
        assert!(
            matches!(err, ApiError::Validation(messages) if messages.iter().any(|message| message.contains("미디어 id")))
        );
    }

    #[test]
    fn comment_crud_isolated_per_scrap() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩", "", "태그")).unwrap();
        let scrap_id = first_scrap_id(&conn);

        add_comment(&conn, &scrap_id, "첫 댓글").unwrap();
        let comment_id = get_snapshot(&conn).unwrap().items[0].comments[0].id.clone();

        update_comment(&conn, &scrap_id, &comment_id, "수정됨").unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].comments[0].text, "수정됨");

        delete_comment(&conn, &scrap_id, &comment_id).unwrap();
        assert!(get_snapshot(&conn).unwrap().items[0].comments.is_empty());
    }

    #[test]
    fn delete_scrap_removes_comments() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩", "", "태그")).unwrap();
        let scrap_id = first_scrap_id(&conn);
        add_comment(&conn, &scrap_id, "댓글").unwrap();

        delete_scrap(&mut conn, &scrap_id).unwrap();
        assert!(get_snapshot(&conn).unwrap().items.is_empty());
    }

    #[test]
    fn missing_scrap_and_comment_are_not_found() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        assert!(matches!(delete_scrap(&mut conn, "nope").unwrap_err(), ApiError::NotFound(_)));
        create_scrap(&mut conn, write_input("스크랩", "", "태그")).unwrap();
        let scrap_id = first_scrap_id(&conn);
        assert!(matches!(
            delete_comment(&conn, &scrap_id, "nope").unwrap_err(),
            ApiError::NotFound(_)
        ));
    }

    #[test]
    fn add_tag_ignores_duplicates() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_tag(&conn, "새태그").unwrap();
        add_tag(&conn, "새태그").unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().tags, vec!["기타".to_string(), "새태그".to_string()]);
    }

    #[test]
    fn rename_tag_moves_tag_and_items() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩1", "", "요리")).unwrap();
        create_scrap(&mut conn, write_input("스크랩2", "", "요리")).unwrap();

        rename_tag(&mut conn, "요리", "레시피").unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(snapshot.tags, vec!["기타".to_string(), "레시피".to_string()]);
        assert!(snapshot.items.iter().all(|i| i.tag == "레시피"));
    }

    #[test]
    fn rename_tag_missing_is_not_found() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        assert!(matches!(rename_tag(&mut conn, "없음", "새이름").unwrap_err(), ApiError::NotFound(_)));
    }

    #[test]
    fn rename_tag_rejects_name_clash() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        add_tag(&conn, "요리").unwrap();
        add_tag(&conn, "레퍼런스").unwrap();
        let err = rename_tag(&mut conn, "요리", "레퍼런스").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("같은 이름의 라벨이 이미 있습니다")));
    }

    #[test]
    fn rename_tag_allows_self_trim_only() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        add_tag(&conn, "요리").unwrap();
        rename_tag(&mut conn, "요리", " 요리 ").unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().tags, vec!["기타".to_string(), "요리".to_string()]);
    }

    #[test]
    fn delete_tag_moves_scraps_to_replacement() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩1", "", "요리")).unwrap();
        create_scrap(&mut conn, write_input("스크랩2", "", "요리")).unwrap();

        delete_tag(&mut conn, "요리", "기타").unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(snapshot.tags, vec!["기타".to_string()]);
        assert!(snapshot.items.iter().all(|i| i.tag == "기타"));
    }

    #[test]
    fn delete_tag_missing_targets_are_not_found() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        assert!(matches!(delete_tag(&mut conn, "없음", "기타").unwrap_err(), ApiError::NotFound(_)));
        add_tag(&conn, "요리").unwrap();
        assert!(matches!(delete_tag(&mut conn, "요리", "없음").unwrap_err(), ApiError::NotFound(_)));
    }

    #[test]
    fn delete_tag_rejects_same_target_and_replacement() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        add_tag(&conn, "요리").unwrap();
        let err = delete_tag(&mut conn, "요리", "요리").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("달라야 합니다")));
    }
}
