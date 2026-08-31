use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::db::{Db, DbExt};
use super::error::{ApiError, ApiResult};
use super::ledger::{self, LedgerWriteInput};
use super::common::*;
use super::version::{ensure_versioned_update, expected_version};

// ---------- DTO (packages/contracts/src/index.ts inbox* 스키마) ----------

#[derive(Serialize, Deserialize, Clone)]
struct InboxField {
    label: String,
    value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    confidence: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxItem {
    id: String,
    version: i64,
    source: String,
    raw: String,
    target: Option<String>,
    confidence: f64,
    status: String,
    pinned: bool,
    received_at: String,
    fields: Vec<InboxField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    videos: Option<Value>,
}

#[derive(Serialize)]
struct InboxSnapshot {
    items: Vec<InboxItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxUpdateInput {
    target: String,
    fields: Vec<InboxField>,
}

#[derive(Deserialize)]
struct ApproveHighConfidenceInput {
    minimum: f64,
}

// domain inboxTargetModuleIds
const TARGET_MODULES: [&str; 4] = ["todo", "calendar", "scrap", "ledger"];

// ---------- 필드 파싱 (inbox-repository.ts fieldValue/labelValue/findByName) ----------

fn field_value(fields: &[InboxField], label: &str) -> String {
    fields
        .iter()
        .find(|f| f.label == label)
        .map(|f| f.value.trim().to_string())
        .unwrap_or_default()
}

fn label_value(fields: &[InboxField]) -> String {
    let by = |l: &str| field_value(fields, l);
    let first = by("라벨");
    if !first.is_empty() {
        return first;
    }
    let second = by("분류");
    if !second.is_empty() {
        return second;
    }
    by("태그")
}

// 공백 제거 + 소문자. "집안 일" == "집안일".
fn normalize_name(name: &str) -> String {
    name.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_lowercase()
}

// (id, name) 목록에서 이름으로 매칭. target이 비면 None.
fn find_by_name(candidates: &[(String, String)], target: &str) -> Option<String> {
    if target.trim().is_empty() {
        return None;
    }
    let wanted = normalize_name(target);
    candidates
        .iter()
        .find(|(_, name)| normalize_name(name) == wanted)
        .map(|(id, _)| id.clone())
}

// JS /\d{4}-\d{2}-\d{2}/g — 바이트 스캔(비ASCII는 자동 스킵).
fn all_iso_dates(s: &str) -> Vec<String> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 10 <= b.len() {
        let w = &b[i..i + 10];
        if w[..4].iter().all(u8::is_ascii_digit)
            && w[4] == b'-'
            && w[5..7].iter().all(u8::is_ascii_digit)
            && w[7] == b'-'
            && w[8..10].iter().all(u8::is_ascii_digit)
        {
            out.push(String::from_utf8_lossy(w).into_owned());
            i += 10;
        } else {
            i += 1;
        }
    }
    out
}

// JS /\d{1,2}:\d{2}/g. ponytail: 병리적 입력("123:45")에서 JS와 매칭 위치가 다를 수 있으나
// 실제 일시 문자열엔 무해. 필요하면 정규식 크레이트로 승격.
fn all_times(s: &str) -> Vec<String> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if i + 5 <= b.len()
            && b[i].is_ascii_digit()
            && b[i + 1].is_ascii_digit()
            && b[i + 2] == b':'
            && b[i + 3].is_ascii_digit()
            && b[i + 4].is_ascii_digit()
        {
            out.push(String::from_utf8_lossy(&b[i..i + 5]).into_owned());
            i += 5;
        } else if i + 4 <= b.len()
            && b[i].is_ascii_digit()
            && b[i + 1] == b':'
            && b[i + 2].is_ascii_digit()
            && b[i + 3].is_ascii_digit()
        {
            out.push(String::from_utf8_lossy(&b[i..i + 4]).into_owned());
            i += 4;
        } else {
            i += 1;
        }
    }
    out
}

// ---------- 저장소 로직 (apps/api/src/repositories/inbox-repository.ts 1:1) ----------

struct InboxRow {
    source: String,
    raw: String,
    target: Option<String>,
    status: String,
    fields_json: String,
    images_json: Option<String>,
    videos_json: Option<String>,
}

fn parse_fields(raw: &str) -> Vec<InboxField> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn require_item(conn: &Connection, id: &str) -> ApiResult<InboxRow> {
    conn.query_row(
        "SELECT source, raw, target, status, fields_json, images_json, videos_json \
         FROM inbox_items WHERE id = ?1",
        [id],
        |row| {
            Ok(InboxRow {
                source: row.get(0)?,
                raw: row.get(1)?,
                target: row.get(2)?,
                status: row.get(3)?,
                fields_json: row.get(4)?,
                images_json: row.get(5)?,
                videos_json: row.get(6)?,
            })
        },
    )
    .map_err(|_| ApiError::NotFound(format!("수집함 항목을 찾을 수 없습니다: {id}")))
}

fn get_snapshot(conn: &Connection) -> ApiResult<InboxSnapshot> {
    let items = conn
        .prepare(
            "SELECT id, version, source, raw, target, confidence, status, pinned, received_at, \
             fields_json, images_json, videos_json FROM inbox_items ORDER BY seq DESC",
        )?
        .query_map([], |row| {
            let images_json: Option<String> = row.get(10)?;
            let videos_json: Option<String> = row.get(11)?;
            Ok(InboxItem {
                id: row.get(0)?,
                version: row.get(1)?,
                source: row.get(2)?,
                raw: row.get(3)?,
                target: row.get(4)?,
                confidence: row.get(5)?,
                status: row.get(6)?,
                pinned: row.get::<_, i64>(7)? != 0,
                received_at: row.get(8)?,
                fields: parse_fields(&row.get::<_, String>(9)?),
                images: images_json.and_then(|j| serde_json::from_str(&j).ok()),
                videos: videos_json.and_then(|j| serde_json::from_str(&j).ok()),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(InboxSnapshot { items })
}

fn labels_ordered(conn: &Connection, table: &str) -> ApiResult<Vec<(String, String)>> {
    let rows = conn
        .prepare(&format!("SELECT id, name FROM {table} ORDER BY order_index ASC"))?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn resolve(candidates: &[(String, String)], wanted: &str, fallback_id: &str) -> Option<String> {
    find_by_name(candidates, wanted)
        .or_else(|| candidates.iter().find(|(id, _)| id == fallback_id).map(|(id, _)| id.clone()))
        .or_else(|| candidates.first().map(|(id, _)| id.clone()))
}

fn approve_to_todo(conn: &Connection, row: &InboxRow, fields: &[InboxField]) -> ApiResult<()> {
    let labels = labels_ordered(conn, "todo_labels")?;
    let label_id = resolve(&labels, &label_value(fields), "work").ok_or_else(|| {
        ApiError::BadRequest("할 일 라벨이 없어 승인할 수 없습니다. 먼저 라벨을 만드세요.".into())
    })?;
    let due = field_value(fields, "마감");
    let due_date = if due == "오늘" {
        Some(today_iso())
    } else {
        all_iso_dates(&due).into_iter().next()
    };
    let due_time = all_times(&due).into_iter().next();
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM todo_items", [], |r| r.get(0))?;
    let title = {
        let t = field_value(fields, "제목");
        if t.is_empty() { row.raw.clone() } else { t }
    };
    conn.execute(
        "INSERT INTO todo_items \
         (id, seq, title, label_id, due_date, due_time, note, done, completed_at, routine_id, occurrence_date) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, NULL, NULL, NULL)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            title,
            label_id,
            due_date,
            due_time,
            field_value(fields, "메모"),
        ],
    )?;
    Ok(())
}

fn approve_to_calendar(conn: &Connection, row: &InboxRow, fields: &[InboxField]) -> ApiResult<()> {
    let categories = labels_ordered(conn, "calendar_categories")?;
    let category_id = resolve(&categories, &label_value(fields), "hobby").ok_or_else(|| {
        ApiError::BadRequest("일정 분류가 없어 승인할 수 없습니다. 먼저 분류를 만드세요.".into())
    })?;
    let schedule = field_value(fields, "일시");
    let dates = all_iso_dates(&schedule);
    let times = all_times(&schedule);
    let today = today_iso();
    let start_date = dates.first().cloned().unwrap_or_else(|| today.clone());
    let start_time = times.first().cloned();
    let end_date = dates
        .get(1)
        .cloned()
        .or_else(|| dates.first().cloned())
        .unwrap_or_else(|| today.clone());
    let end_time = times.get(1).cloned().or_else(|| times.first().cloned());
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM calendar_events", [], |r| r.get(0))?;
    let title = {
        let t = field_value(fields, "제목");
        if t.is_empty() { row.raw.clone() } else { t }
    };
    conn.execute(
        "INSERT INTO calendar_events \
         (id, seq, title, start_date, start_time, end_date, end_time, location, category_id, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            title,
            start_date,
            start_time,
            end_date,
            end_time,
            field_value(fields, "장소"),
            category_id,
            field_value(fields, "메모"),
        ],
    )?;
    Ok(())
}

fn first_media_id(images_json: &Option<String>, videos_json: &Option<String>) -> Option<String> {
    let pick = |j: &Option<String>| -> Option<String> {
        let arr: Value = serde_json::from_str(j.as_deref()?).ok()?;
        arr.get(0)?.get("mediaId")?.as_str().map(String::from)
    };
    pick(images_json).or_else(|| pick(videos_json))
}

fn approve_to_scrap(conn: &Connection, row: &InboxRow, fields: &[InboxField]) -> ApiResult<()> {
    let tag = {
        let t = label_value(fields);
        if t.is_empty() { "수집".to_string() } else { t }
    };
    conn.execute("INSERT OR IGNORE INTO scrap_tags (tag) VALUES (?1)", [&tag])?;
    let kind = match row.source.as_str() {
        "url" => "url",
        "image" => "image",
        "video" => "video",
        _ => "text",
    };
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM scrap_items", [], |r| r.get(0))?;
    let title = {
        let t = field_value(fields, "제목");
        if t.is_empty() { row.raw.clone() } else { t }
    };
    let memo = {
        let m = field_value(fields, "메모");
        if m.is_empty() { row.raw.clone() } else { m }
    };
    let url = if row.source == "url" { Some(row.raw.clone()) } else { None };
    conn.execute(
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
            url,
            first_media_id(&row.images_json, &row.videos_json),
        ],
    )?;
    Ok(())
}

fn approve_to_ledger(conn: &Connection, row: &InboxRow, fields: &[InboxField]) -> ApiResult<()> {
    let categories = labels_ordered(conn, "ledger_categories")?;
    let category_id = resolve(&categories, &label_value(fields), "other")
        .ok_or_else(|| ApiError::BadRequest("가계부 분류가 없어 승인할 수 없습니다.".into()))?;
    let title = {
        let item = field_value(fields, "항목");
        let alt = if item.is_empty() { field_value(fields, "제목") } else { item };
        if alt.is_empty() { row.raw.clone() } else { alt }
    };
    let date = {
        let d = field_value(fields, "날짜");
        if d.is_empty() { today_iso() } else { d }
    };
    ledger::create_expense(
        conn,
        LedgerWriteInput {
            title,
            amount_won: Value::String(field_value(fields, "금액")),
            date,
            category_id,
            note: field_value(fields, "메모"),
        },
    )
}

fn approve_item(conn: &Connection, id: &str) -> ApiResult<()> {
    let row = require_item(conn, id)?;
    if row.status == "approved" {
        return Ok(());
    }
    let fields = parse_fields(&row.fields_json);
    match row.target.as_deref() {
        Some("todo") => approve_to_todo(conn, &row, &fields)?,
        Some("calendar") => approve_to_calendar(conn, &row, &fields)?,
        Some("scrap") => approve_to_scrap(conn, &row, &fields)?,
        Some("ledger") => approve_to_ledger(conn, &row, &fields)?,
        _ => {}
    }
    conn.execute("UPDATE inbox_items SET status = 'approved' WHERE id = ?1", [id])?;
    Ok(())
}

fn approve_high_confidence(conn: &Connection, minimum: f64) -> ApiResult<()> {
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM inbox_items WHERE status = 'pending' AND confidence >= ?1")?
        .query_map([minimum], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        approve_item(conn, &id)?;
    }
    Ok(())
}

fn update(conn: &Connection, id: &str, input: InboxUpdateInput, expected: Option<i64>) -> ApiResult<()> {
    let row = require_item(conn, id)?;
    if !TARGET_MODULES.contains(&input.target.as_str()) {
        return Err(ApiError::validation("target이 올바르지 않습니다."));
    }
    if input.fields.is_empty() {
        return Err(ApiError::validation("필드를 하나 이상 입력해야 합니다."));
    }
    if row.source == "video" && input.target != "scrap" {
        return Err(ApiError::BadRequest("영상은 스크랩 모듈로만 저장할 수 있습니다.".into()));
    }
    let scored: Vec<f64> = input.fields.iter().filter_map(|f| f.confidence).collect();
    let confidence = if scored.is_empty() {
        0.9
    } else {
        scored.iter().sum::<f64>() / scored.len() as f64
    };
    let changed = conn.execute(
        "UPDATE inbox_items SET target = ?1, fields_json = ?2, confidence = ?3, status = 'pending', \
         pinned = ?4, version = version + 1 WHERE id = ?5 AND (?6 IS NULL OR version = ?6)",
        params![
            input.target,
            serde_json::to_string(&input.fields).unwrap(),
            confidence,
            (row.source == "video") as i64,
            id,
            expected,
        ],
    )?;
    ensure_versioned_update(changed, expected)
}

fn discard(conn: &Connection, id: &str) -> ApiResult<()> {
    require_item(conn, id)?;
    conn.execute("DELETE FROM inbox_items WHERE id = ?1", [id])?;
    Ok(())
}

// ---------- 라우트 (apps/api/src/routes/inbox.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/inbox/snapshot", get(snapshot_handler))
        .route("/inbox/items/{id}/approve", post(approve_handler))
        .route("/inbox/approve-high-confidence", post(approve_high_confidence_handler))
        .route("/inbox/items/{id}", put(update_handler).delete(discard_handler))
        .with_state(db)
}

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<InboxSnapshot>> {
    Ok(Json(get_snapshot(&db.conn())?))
}

async fn approve_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    approve_item(&db.conn(), &id)?;
    Ok(ok())
}

async fn approve_high_confidence_handler(
    State(db): State<Db>,
    Json(input): Json<ApproveHighConfidenceInput>,
) -> ApiResult<Json<Value>> {
    approve_high_confidence(&db.conn(), input.minimum)?;
    Ok(ok())
}

async fn update_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<InboxUpdateInput>,
) -> ApiResult<Json<Value>> {
    update(&db.conn(), &id, input, expected_version(&headers)?)?;
    Ok(ok())
}

async fn discard_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    discard(&db.conn(), &id)?;
    Ok(ok())
}

// ---------- 테스트 (apps/api/src/repositories/inbox-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn add_todo_label(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO todo_labels (id, name, color, order_index) \
             VALUES (?1, ?2, 'oklch(0.5 0.1 100)', \
             (SELECT COALESCE(MAX(order_index), -1) + 1 FROM todo_labels WHERE id != 'other'))",
            params![id, name],
        )
        .unwrap();
    }

    fn seed_inbox(
        conn: &Connection,
        id: &str,
        source: &str,
        target: Option<&str>,
        confidence: f64,
        fields_json: &str,
    ) {
        conn.execute(
            "INSERT INTO inbox_items \
             (id, seq, source, raw, target, confidence, status, pinned, received_at, fields_json, images_json, videos_json) \
             VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM inbox_items), ?2, '오늘 저녁 장보기', ?3, ?4, 'pending', 0, '2026-08-27T00:00:00.000Z', ?5, NULL, NULL)",
            params![id, source, target, confidence, fields_json],
        )
        .unwrap();
    }

    fn todo_titles(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT title FROM todo_items ORDER BY seq DESC")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    fn first_todo_label(conn: &Connection) -> String {
        conn.query_row("SELECT label_id FROM todo_items ORDER BY seq DESC LIMIT 1", [], |r| r.get(0))
            .unwrap()
    }

    fn status_of(conn: &Connection, id: &str) -> String {
        conn.query_row("SELECT status FROM inbox_items WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn approve_todo_matches_label_by_name() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "l1", "집안일");
        seed_inbox(
            &conn,
            "inbox-1",
            "text",
            Some("todo"),
            0.8,
            r#"[{"label":"제목","value":"장보기"},{"label":"라벨","value":"집안일"}]"#,
        );

        approve_item(&conn, "inbox-1").unwrap();
        assert_eq!(todo_titles(&conn), vec!["장보기"]);
        assert_eq!(status_of(&conn, "inbox-1"), "approved");
        assert_eq!(first_todo_label(&conn), "l1");
    }

    #[test]
    fn approve_todo_matches_label_ignoring_space_and_case() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "home", "집안일");
        add_todo_label(&conn, "work", "업무");
        seed_inbox(
            &conn,
            "inbox-1",
            "text",
            Some("todo"),
            0.8,
            r#"[{"label":"제목","value":"장보기"},{"label":"라벨","value":" 집안 일 "}]"#,
        );

        approve_item(&conn, "inbox-1").unwrap();
        assert_eq!(first_todo_label(&conn), "home");
    }

    #[test]
    fn approve_todo_falls_back_to_first_label_when_no_match_and_no_work() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "misc", "기타라벨");
        seed_inbox(
            &conn,
            "inbox-1",
            "text",
            Some("todo"),
            0.8,
            r#"[{"label":"제목","value":"항목"},{"label":"라벨","value":"존재안함"}]"#,
        );

        approve_item(&conn, "inbox-1").unwrap();
        // order_index ASC 첫 라벨 = "misc" (other는 999999)
        assert_eq!(first_todo_label(&conn), "misc");
    }

    #[test]
    fn approve_todo_falls_back_to_other_when_only_other_exists() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_inbox(&conn, "inbox-1", "text", Some("todo"), 0.8, r#"[{"label":"제목","value":"x"}]"#);

        approve_item(&conn, "inbox-1").unwrap();
        assert_eq!(first_todo_label(&conn), "other");
    }

    #[test]
    fn approve_ledger_normalizes_won_amount() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_inbox(
            &conn,
            "inbox-1",
            "text",
            Some("ledger"),
            0.8,
            r#"[{"label":"항목","value":"점심"},{"label":"금액","value":"16,000원"}]"#,
        );

        approve_item(&conn, "inbox-1").unwrap();
        let (title, amount, category): (String, i64, String) = conn
            .query_row(
                "SELECT title, amount_won, category_id FROM ledger_expenses ORDER BY seq DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((title.as_str(), amount, category.as_str()), ("점심", 16_000, "other"));
    }

    #[test]
    fn approve_calendar_parses_schedule_dates_and_times() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_inbox(
            &conn,
            "inbox-1",
            "text",
            Some("calendar"),
            0.8,
            r#"[{"label":"제목","value":"합주"},{"label":"일시","value":"2026-08-09 12:00~14:00"}]"#,
        );

        approve_item(&conn, "inbox-1").unwrap();
        let (sd, st, ed, et): (String, Option<String>, String, Option<String>) = conn
            .query_row(
                "SELECT start_date, start_time, end_date, end_time FROM calendar_events ORDER BY seq DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(sd, "2026-08-09");
        assert_eq!(st.as_deref(), Some("12:00"));
        assert_eq!(ed, "2026-08-09");
        assert_eq!(et.as_deref(), Some("14:00"));
    }

    #[test]
    fn approve_scrap_uses_default_tag_and_source_kind() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_inbox(&conn, "inbox-1", "url", Some("scrap"), 0.8, r#"[]"#);

        approve_item(&conn, "inbox-1").unwrap();
        let (kind, tag, url): (String, String, Option<String>) = conn
            .query_row(
                "SELECT kind, tag, url FROM scrap_items ORDER BY seq DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kind, "url");
        assert_eq!(tag, "수집");
        assert_eq!(url.as_deref(), Some("오늘 저녁 장보기"));
    }

    #[test]
    fn approve_is_idempotent() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "l1", "집안일");
        seed_inbox(
            &conn,
            "inbox-1",
            "text",
            Some("todo"),
            0.8,
            r#"[{"label":"제목","value":"장보기"},{"label":"라벨","value":"집안일"}]"#,
        );

        approve_item(&conn, "inbox-1").unwrap();
        approve_item(&conn, "inbox-1").unwrap();
        assert_eq!(todo_titles(&conn).len(), 1);
    }

    #[test]
    fn video_item_cannot_change_target_off_scrap() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_inbox(&conn, "inbox-2", "video", Some("scrap"), 0.8, r#"[]"#);
        let err = update(
            &conn,
            "inbox-2",
            InboxUpdateInput {
                target: "todo".into(),
                fields: vec![InboxField { label: "제목".into(), value: "x".into(), confidence: None }],
            },
            None,
        )
        .unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("영상은 스크랩")));
    }

    #[test]
    fn approve_high_confidence_only_processes_at_or_above_minimum() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "l1", "집안일");
        seed_inbox(
            &conn,
            "inbox-low",
            "text",
            Some("todo"),
            0.3,
            r#"[{"label":"제목","value":"a"},{"label":"라벨","value":"집안일"}]"#,
        );
        seed_inbox(
            &conn,
            "inbox-high",
            "text",
            Some("todo"),
            0.95,
            r#"[{"label":"제목","value":"b"},{"label":"라벨","value":"집안일"}]"#,
        );

        approve_high_confidence(&conn, 0.9).unwrap();
        assert_eq!(status_of(&conn, "inbox-high"), "approved");
        assert_eq!(status_of(&conn, "inbox-low"), "pending");
    }

    #[test]
    fn discard_removes_and_missing_is_not_found() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_inbox(&conn, "inbox-1", "text", Some("todo"), 0.8, r#"[]"#);
        discard(&conn, "inbox-1").unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items.len(), 0);
        let err = discard(&conn, "inbox-1").unwrap_err();
        assert!(matches!(err, ApiError::NotFound(m) if m.contains("찾을 수 없습니다")));
    }
}
