use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::db::{Db, DbExt};
use super::error::{ApiError, ApiResult};
use super::common::*;
use super::version::{ensure_versioned_update, expected_version};

// apps/api/src/db/schema.ts SCRAP_OTHER_TAG
const OTHER_TAG: &str = "기타";

// ---------- DTO (packages/contracts/src/index.ts scrap* schemas) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentFile {
    media_id: String,
    name: String,
    size: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapComment {
    id: String,
    version: i64,
    created_at: String,
    text: String,
    file: Option<CommentFile>,
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
    file_name: Option<String>,
    file_size: Option<i64>,
    comments: Vec<ScrapComment>,
}

#[derive(Serialize)]
struct ScrapSnapshot {
    tags: Vec<String>,
    items: Vec<ScrapItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScrapWriteInput {
    title: String,
    #[serde(default)]
    memo: String,
    #[serde(default)]
    url: String,
    tag: String,
    #[serde(default)]
    media_id: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    file_size: Option<i64>,
}

#[derive(Deserialize)]
struct CommentInput {
    #[serde(default)]
    text: String,
    #[serde(default)]
    file: Option<CommentFileInput>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommentFileInput {
    media_id: String,
    name: String,
    size: i64,
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

// ---------- Validation ----------

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

// An attachment file must be paired with a media_id. Returns: (normalized name, size).
fn validated_scrap_file(
    media_id: Option<&str>,
    name: Option<&str>,
    size: Option<i64>,
) -> ApiResult<Option<(String, i64)>> {
    let Some(raw_name) = name else {
        return Ok(None);
    };
    if media_id.is_none() {
        return Err(ApiError::validation("첨부 파일에는 미디어 id가 필요합니다."));
    }
    let name = raw_name.trim();
    if name.is_empty() || name.chars().count() > 255 {
        return Err(ApiError::validation("첨부 파일 이름이 올바르지 않습니다."));
    }
    let size = size.unwrap_or(0);
    if !(0..=50 * 1024 * 1024).contains(&size) {
        return Err(ApiError::validation("첨부 파일 크기가 올바르지 않습니다."));
    }
    Ok(Some((name.to_string(), size)))
}

fn scrap_kind(has_file: bool, has_media: bool, url: &str) -> &'static str {
    if has_file {
        "file"
    } else if has_media {
        "image"
    } else if url.is_empty() {
        "text"
    } else {
        "url"
    }
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

// The body can be empty if there's an attachment.
fn validated_comment_text(raw: &str, has_file: bool) -> ApiResult<String> {
    let text = raw.trim();
    if text.is_empty() {
        return if has_file {
            Ok(String::new())
        } else {
            Err(ApiError::validation("댓글 내용을 입력해야 합니다."))
        };
    }
    if text.chars().count() > 2_000 {
        return Err(ApiError::validation("댓글은 2000자 이하여야 합니다."));
    }
    Ok(text.to_string())
}

const COMMENT_FILE_MAX_BYTES: i64 = 50 * 1024 * 1024;

fn validated_comment_file(input: Option<&CommentFileInput>) -> ApiResult<Option<CommentFileInput>> {
    let Some(file) = input else {
        return Ok(None);
    };
    let media_id = validated_media_id(Some(&file.media_id))?
        .ok_or_else(|| ApiError::validation("첨부 파일의 미디어 id가 없습니다."))?;
    let name = file.name.trim();
    if name.is_empty() || name.chars().count() > 255 {
        return Err(ApiError::validation("첨부 파일 이름이 올바르지 않습니다."));
    }
    if file.size < 0 || file.size > COMMENT_FILE_MAX_BYTES {
        return Err(ApiError::validation("첨부 파일 크기가 올바르지 않습니다."));
    }
    Ok(Some(CommentFileInput { media_id, name: name.to_string(), size: file.size }))
}

// ---------- Repository logic (1:1 with apps/api/src/repositories/scrap-repository.ts) ----------

fn get_snapshot(conn: &Connection) -> ApiResult<ScrapSnapshot> {
    let tags: Vec<String> = conn
        .prepare("SELECT tag FROM scrap_tags ORDER BY rowid")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let mut items = conn
        .prepare(
            "SELECT id, kind, title, memo, tag, saved_at, url, media_id, file_name, file_size \
             FROM scrap_items ORDER BY seq DESC",
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
                file_name: row.get(8)?,
                file_size: row.get(9)?,
                comments: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let comments = conn
        .prepare(
            "SELECT id, scrap_id, created_at, text, version, file_media_id, file_name, file_size \
             FROM scrap_comments ORDER BY seq ASC",
        )?
        .query_map([], |row| {
            let file = match row.get::<_, Option<String>>(5)? {
                Some(media_id) => Some(CommentFile {
                    media_id,
                    name: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    size: row.get::<_, Option<i64>>(7)?.unwrap_or(0),
                }),
                None => None,
            };
            Ok((
                row.get::<_, String>(1)?,
                ScrapComment {
                    id: row.get(0)?,
                    created_at: row.get(2)?,
                    text: row.get(3)?,
                    version: row.get(4)?,
                    file,
                },
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
    let file = validated_scrap_file(media_id.as_deref(), input.file_name.as_deref(), input.file_size)?;
    let kind = scrap_kind(file.is_some(), media_id.is_some(), &url);

    let tx = conn.transaction()?;
    tx.execute("INSERT OR IGNORE INTO scrap_tags (tag) VALUES (?1)", [&tag])?;
    let next_seq: i64 =
        tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM scrap_items", [], |row| row.get(0))?;
    tx.execute(
        "INSERT INTO scrap_items (id, seq, kind, title, memo, tag, saved_at, url, media_id, file_name, file_size) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
            file.as_ref().map(|f| f.0.clone()),
            file.as_ref().map(|f| f.1),
        ],
    )?;
    tx.commit()?;
    Ok(())
}

// media_id is applied exactly as the client sent it (absent or null removes the photo).
// The desktop edit form always sends the entire current state.
fn update_scrap(conn: &mut Connection, id: &str, input: ScrapWriteInput) -> ApiResult<()> {
    require_scrap(conn, id)?;
    let title = validated_title(&input.title)?;
    let memo = validated_memo(&input.memo)?;
    let url = validated_url(&input.url)?;
    let tag = validated_tag(&input.tag)?;
    let media_id = validated_media_id(input.media_id.as_deref())?;
    let file = validated_scrap_file(media_id.as_deref(), input.file_name.as_deref(), input.file_size)?;
    let kind = scrap_kind(file.is_some(), media_id.is_some(), &url);

    let tx = conn.transaction()?;
    tx.execute("INSERT OR IGNORE INTO scrap_tags (tag) VALUES (?1)", [&tag])?;
    tx.execute(
        "UPDATE scrap_items SET kind = ?1, title = ?2, memo = ?3, tag = ?4, url = ?5, media_id = ?6, \
         file_name = ?7, file_size = ?8 WHERE id = ?9",
        params![
            kind,
            title,
            memo,
            tag,
            if url.is_empty() { None } else { Some(url) },
            media_id,
            file.as_ref().map(|f| f.0.clone()),
            file.as_ref().map(|f| f.1),
            id,
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

fn add_comment(conn: &Connection, scrap_id: &str, input: &CommentInput) -> ApiResult<()> {
    require_scrap(conn, scrap_id)?;
    let file = validated_comment_file(input.file.as_ref())?;
    let text = validated_comment_text(&input.text, file.is_some())?;
    let next_seq: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM scrap_comments WHERE scrap_id = ?1",
        [scrap_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO scrap_comments (id, scrap_id, seq, created_at, text, file_media_id, file_name, file_size) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            uuid::Uuid::new_v4().to_string(),
            scrap_id,
            next_seq + 1,
            now_iso(),
            text,
            file.as_ref().map(|f| f.media_id.clone()),
            file.as_ref().map(|f| f.name.clone()),
            file.as_ref().map(|f| f.size),
        ],
    )?;
    Ok(())
}

fn update_comment(conn: &Connection, scrap_id: &str, comment_id: &str, text: &str, expected: Option<i64>) -> ApiResult<()> {
    require_scrap(conn, scrap_id)?;
    require_comment(conn, scrap_id, comment_id)?;
    let text = validated_comment(text)?;
    let changed = conn.execute(
        "UPDATE scrap_comments SET text = ?1, version = version + 1 WHERE id = ?2 AND (?3 IS NULL OR version = ?3)",
        params![text, comment_id, expected],
    )?;
    ensure_versioned_update(changed, expected)
}

fn delete_comment(conn: &Connection, scrap_id: &str, comment_id: &str) -> ApiResult<()> {
    require_scrap(conn, scrap_id)?;
    require_comment(conn, scrap_id, comment_id)?;
    conn.execute("DELETE FROM scrap_comments WHERE id = ?1", [comment_id])?;
    Ok(())
}

// ---------- Routes (matches apps/api/src/routes/scrap.ts paths exactly) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/scrap/snapshot", get(snapshot_handler))
        .route("/scrap/items", post(create_scrap_handler))
        .route(
            "/scrap/items/{id}",
            put(update_scrap_handler).delete(delete_scrap_handler),
        )
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

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<ScrapSnapshot>> {
    Ok(Json(get_snapshot(&db.conn())?))
}

async fn create_scrap_handler(
    State(db): State<Db>,
    Json(input): Json<ScrapWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_scrap(&mut db.conn(), input)?;
    Ok(created())
}

async fn update_scrap_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<ScrapWriteInput>,
) -> ApiResult<Json<Value>> {
    update_scrap(&mut db.conn(), &id, input)?;
    Ok(ok())
}

async fn delete_scrap_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    delete_scrap(&mut db.conn(), &id)?;
    Ok(ok())
}

async fn add_tag_handler(
    State(db): State<Db>,
    Json(input): Json<AddTagInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    add_tag(&db.conn(), &input.tag)?;
    Ok(created())
}

async fn rename_tag_handler(
    State(db): State<Db>,
    Path(tag): Path<String>,
    Json(input): Json<RenameTagInput>,
) -> ApiResult<Json<Value>> {
    rename_tag(&mut db.conn(), &tag, &input.next_tag)?;
    Ok(ok())
}

async fn delete_tag_handler(
    State(db): State<Db>,
    Path(tag): Path<String>,
    Json(input): Json<DeleteTagInput>,
) -> ApiResult<Json<Value>> {
    delete_tag(&mut db.conn(), &tag, &input.replacement_tag)?;
    Ok(ok())
}

async fn add_comment_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<CommentInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    add_comment(&db.conn(), &id, &input)?;
    Ok(created())
}

async fn update_comment_handler(
    State(db): State<Db>,
    Path((id, comment_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(input): Json<CommentInput>,
) -> ApiResult<Json<Value>> {
    update_comment(&db.conn(), &id, &comment_id, &input.text, expected_version(&headers)?)?;
    Ok(ok())
}

async fn delete_comment_handler(
    State(db): State<Db>,
    Path((id, comment_id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    delete_comment(&db.conn(), &id, &comment_id)?;
    Ok(ok())
}

// ---------- Tests (ported from apps/api/src/repositories/scrap-repository.test.ts) ----------

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
            file_name: None,
            file_size: None,
        }
    }

    fn text_comment(text: &str) -> CommentInput {
        CommentInput { text: text.into(), file: None }
    }

    const SAMPLE_MEDIA_ID: &str = "11111111-1111-4111-8111-111111111111";

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
    fn create_with_file_name_makes_file_scrap() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let mut input = write_input("문서 스크랩", "", "문서");
        input.media_id = Some("00000000-0000-4000-8000-000000000002".into());
        input.file_name = Some("보고서.pdf".into());
        input.file_size = Some(4096);

        create_scrap(&mut conn, input).unwrap();

        let item = &get_snapshot(&conn).unwrap().items[0];
        assert_eq!(item.kind, "file");
        assert_eq!(item.file_name.as_deref(), Some("보고서.pdf"));
        assert_eq!(item.file_size, Some(4096));
    }

    #[test]
    fn create_rejects_file_name_without_media_id() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let mut input = write_input("문서 스크랩", "", "문서");
        input.file_name = Some("보고서.pdf".into());

        assert!(create_scrap(&mut conn, input).is_err());
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
    fn update_scrap_edits_fields_and_reclassifies_kind() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("메모 스크랩", "", "읽을거리")).unwrap();
        let id = first_scrap_id(&conn);

        update_scrap(
            &mut conn,
            &id,
            write_input("링크로 승격", "https://example.com", "레퍼런스"),
        )
        .unwrap();

        let snapshot = get_snapshot(&conn).unwrap();
        let item = &snapshot.items[0];
        assert_eq!(item.title, "링크로 승격");
        assert_eq!(item.tag, "레퍼런스");
        assert_eq!(item.kind, "url");
        assert_eq!(item.url.as_deref(), Some("https://example.com"));
        assert!(snapshot.tags.contains(&"레퍼런스".to_string()));
    }

    #[test]
    fn update_scrap_swaps_and_clears_media() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let mut input = write_input("사진 스크랩", "", "사진");
        input.media_id = Some("00000000-0000-4000-8000-000000000001".into());
        create_scrap(&mut conn, input).unwrap();
        let id = first_scrap_id(&conn);

        // Replace with a different photo
        let mut swap = write_input("사진 교체", "", "사진");
        swap.media_id = Some("00000000-0000-4000-8000-000000000002".into());
        update_scrap(&mut conn, &id, swap).unwrap();
        let item = &get_snapshot(&conn).unwrap().items[0];
        assert_eq!(item.kind, "image");
        assert_eq!(item.media_id.as_deref(), Some("00000000-0000-4000-8000-000000000002"));

        // Editing without a media_id removes the photo → text
        update_scrap(&mut conn, &id, write_input("사진 제거", "", "사진")).unwrap();
        let item = &get_snapshot(&conn).unwrap().items[0];
        assert_eq!(item.kind, "text");
        assert_eq!(item.media_id, None);
    }

    #[test]
    fn update_scrap_missing_is_not_found() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        assert!(matches!(
            update_scrap(&mut conn, "nope", write_input("x", "", "태그")).unwrap_err(),
            ApiError::NotFound(_)
        ));
    }

    #[test]
    fn comment_crud_isolated_per_scrap() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩", "", "태그")).unwrap();
        let scrap_id = first_scrap_id(&conn);

        add_comment(&conn, &scrap_id, &text_comment("첫 댓글")).unwrap();
        let comment_id = get_snapshot(&conn).unwrap().items[0].comments[0].id.clone();

        update_comment(&conn, &scrap_id, &comment_id, "수정됨", None).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].comments[0].text, "수정됨");

        delete_comment(&conn, &scrap_id, &comment_id).unwrap();
        assert!(get_snapshot(&conn).unwrap().items[0].comments.is_empty());
    }

    #[test]
    fn comment_can_be_file_only_and_snapshot_returns_the_file() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩", "", "태그")).unwrap();
        let scrap_id = first_scrap_id(&conn);

        // A file only, with no body
        add_comment(
            &conn,
            &scrap_id,
            &CommentInput {
                text: String::new(),
                file: Some(CommentFileInput {
                    media_id: SAMPLE_MEDIA_ID.into(),
                    name: "보고서.pdf".into(),
                    size: 2048,
                }),
            },
        )
        .unwrap();

        let comment = &get_snapshot(&conn).unwrap().items[0].comments[0];
        assert_eq!(comment.text, "");
        let file = comment.file.as_ref().expect("첨부 있어야 함");
        assert_eq!(file.media_id, SAMPLE_MEDIA_ID);
        assert_eq!(file.name, "보고서.pdf");
        assert_eq!(file.size, 2048);

        // Rejected if there's neither a body nor a file
        assert!(add_comment(&conn, &scrap_id, &text_comment("")).is_err());
    }

    #[test]
    fn delete_scrap_removes_comments() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        create_scrap(&mut conn, write_input("스크랩", "", "태그")).unwrap();
        let scrap_id = first_scrap_id(&conn);
        add_comment(&conn, &scrap_id, &text_comment("댓글")).unwrap();

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
