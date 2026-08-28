use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::color::normalize_color_to_oklch;
use super::db::Db;
use super::error::{ApiError, ApiResult};

// apps/api/src/db/schema.ts CALENDAR_OTHER_CATEGORY_ID
const OTHER_CATEGORY_ID: &str = "other";

// ---------- DTO (packages/contracts/src/index.ts calendar* 스키마) ----------

#[derive(Serialize)]
struct CalendarCategory {
    id: String,
    name: String,
    color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEvent {
    id: String,
    title: String,
    start_date: String,
    start_time: Option<String>,
    end_date: String,
    end_time: Option<String>,
    location: String,
    category_id: String,
    note: String,
}

#[derive(Serialize)]
struct CalendarSnapshot {
    today: String,
    categories: Vec<CalendarCategory>,
    events: Vec<CalendarEvent>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarWriteInput {
    title: String,
    start_date: String,
    start_time: Option<String>,
    end_date: String,
    end_time: Option<String>,
    #[serde(default)]
    location: String,
    category_id: String,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct CategoryWriteInput {
    name: String,
    color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryOrderInput {
    category_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteCategoryInput {
    replacement_category_id: String,
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

fn validated_len(raw: &str, max: usize, label: &str) -> ApiResult<String> {
    if raw.chars().count() > max {
        return Err(ApiError::validation(format!("{label}은(는) {max}자 이하여야 합니다.")));
    }
    Ok(raw.to_string())
}

fn validated_category_name(raw: &str) -> ApiResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(ApiError::validation("라벨 이름을 입력해야 합니다."));
    }
    if name.chars().count() > 100 {
        return Err(ApiError::validation("라벨 이름은 100자 이하여야 합니다."));
    }
    Ok(name.to_string())
}

fn validated_color(raw: &str) -> ApiResult<String> {
    normalize_color_to_oklch(raw)
        .ok_or_else(|| ApiError::validation("색상은 OKLCH 또는 6자리 HEX 값이어야 합니다."))
}

// ---------- 저장소 로직 (apps/api/src/repositories/calendar-repository.ts 1:1) ----------

fn today_iso() -> String {
    chrono::Local::now().date_naive().to_string()
}

fn get_snapshot(conn: &Connection) -> ApiResult<CalendarSnapshot> {
    let categories = conn
        .prepare("SELECT id, name, color FROM calendar_categories ORDER BY order_index ASC")?
        .query_map([], |row| {
            Ok(CalendarCategory { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let events = conn
        .prepare(
            "SELECT id, title, start_date, start_time, end_date, end_time, location, category_id, note \
             FROM calendar_events ORDER BY seq DESC",
        )?
        .query_map([], |row| {
            Ok(CalendarEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                start_date: row.get(2)?,
                start_time: row.get(3)?,
                end_date: row.get(4)?,
                end_time: row.get(5)?,
                location: row.get(6)?,
                category_id: row.get(7)?,
                note: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(CalendarSnapshot { today: today_iso(), categories, events })
}

fn category_exists(conn: &Connection, id: &str) -> ApiResult<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM calendar_categories WHERE id = ?1", [id], |_| Ok(()))
        .is_ok())
}

fn require_category(conn: &Connection, id: &str) -> ApiResult<()> {
    if category_exists(conn, id)? {
        Ok(())
    } else {
        Err(ApiError::NotFound(format!("일정 라벨을 찾을 수 없습니다: {id}")))
    }
}

fn require_event(conn: &Connection, id: &str) -> ApiResult<()> {
    conn.query_row("SELECT 1 FROM calendar_events WHERE id = ?1", [id], |_| Ok(()))
        .map_err(|_| ApiError::NotFound(format!("일정을 찾을 수 없습니다: {id}")))
}

fn assert_unique_name(conn: &Connection, name: &str, except_id: Option<&str>) -> ApiResult<()> {
    let target = name.to_lowercase();
    let clash = conn
        .prepare("SELECT id, name FROM calendar_categories")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .any(|(id, existing)| Some(id.as_str()) != except_id && existing.to_lowercase() == target);
    if clash {
        return Err(ApiError::BadRequest("같은 이름의 분류가 이미 있습니다.".into()));
    }
    Ok(())
}

fn create_category(conn: &Connection, input: CategoryWriteInput) -> ApiResult<()> {
    let name = validated_category_name(&input.name)?;
    let color = validated_color(&input.color)?;
    assert_unique_name(conn, &name, None)?;
    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) FROM calendar_categories WHERE id != ?1",
        [OTHER_CATEGORY_ID],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO calendar_categories (id, name, color, order_index) VALUES (?1, ?2, ?3, ?4)",
        params![uuid::Uuid::new_v4().to_string(), name, color, next_order + 1],
    )?;
    Ok(())
}

fn update_category(conn: &Connection, id: &str, input: CategoryWriteInput) -> ApiResult<()> {
    require_category(conn, id)?;
    let name = validated_category_name(&input.name)?;
    let color = validated_color(&input.color)?;
    assert_unique_name(conn, &name, Some(id))?;
    conn.execute(
        "UPDATE calendar_categories SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )?;
    Ok(())
}

fn reorder_categories(conn: &mut Connection, ids: Vec<String>) -> ApiResult<()> {
    if ids.is_empty() || ids.iter().any(|id| id.is_empty()) {
        return Err(ApiError::validation("분류 순서 목록이 올바르지 않습니다."));
    }
    let current: Vec<String> = conn
        .prepare("SELECT id FROM calendar_categories")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let unique: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    if ids.len() != current.len()
        || unique.len() != current.len()
        || current.iter().any(|id| !unique.contains(id.as_str()))
    {
        return Err(ApiError::BadRequest(
            "분류 순서에 현재 분류가 정확히 한 번씩 포함되어야 합니다.".into(),
        ));
    }
    let tx = conn.transaction()?;
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE calendar_categories SET order_index = ?1 WHERE id = ?2",
            params![index as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn delete_category(conn: &mut Connection, id: &str, replacement: &str) -> ApiResult<()> {
    require_category(conn, id)?;
    if id == OTHER_CATEGORY_ID {
        return Err(ApiError::BadRequest("기타 분류는 삭제할 수 없습니다.".into()));
    }
    require_category(conn, replacement)?;
    if id == replacement {
        return Err(ApiError::BadRequest("삭제할 분류와 이동할 분류는 달라야 합니다.".into()));
    }
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM calendar_categories", [], |row| row.get(0))?;
    if count == 1 {
        return Err(ApiError::BadRequest("마지막 분류는 삭제할 수 없습니다.".into()));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE calendar_events SET category_id = ?1 WHERE category_id = ?2",
        params![replacement, id],
    )?;
    tx.execute("DELETE FROM calendar_categories WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

// 검증된 이벤트 컬럼. contracts calendarWriteInputSchema — startDate/endDate는 형식 검증 없음.
struct EventColumns {
    title: String,
    start_date: String,
    start_time: Option<String>,
    end_date: String,
    end_time: Option<String>,
    location: String,
    category_id: String,
    note: String,
}

fn validate_event(input: CalendarWriteInput) -> ApiResult<EventColumns> {
    Ok(EventColumns {
        title: validated_title(&input.title)?,
        start_date: input.start_date,
        start_time: input.start_time,
        end_date: input.end_date,
        end_time: input.end_time,
        location: validated_len(&input.location, 500, "장소")?,
        category_id: input.category_id,
        note: validated_len(&input.note, 4_000, "메모")?,
    })
}

fn create_event(conn: &Connection, input: CalendarWriteInput) -> ApiResult<()> {
    let event = validate_event(input)?;
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM calendar_events", [], |row| row.get(0))?;
    conn.execute(
        "INSERT INTO calendar_events \
         (id, seq, title, start_date, start_time, end_date, end_time, location, category_id, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            event.title,
            event.start_date,
            event.start_time,
            event.end_date,
            event.end_time,
            event.location,
            event.category_id,
            event.note,
        ],
    )?;
    Ok(())
}

fn update_event(conn: &Connection, id: &str, input: CalendarWriteInput) -> ApiResult<()> {
    require_event(conn, id)?;
    let event = validate_event(input)?;
    conn.execute(
        "UPDATE calendar_events SET title = ?1, start_date = ?2, start_time = ?3, end_date = ?4, \
         end_time = ?5, location = ?6, category_id = ?7, note = ?8 WHERE id = ?9",
        params![
            event.title,
            event.start_date,
            event.start_time,
            event.end_date,
            event.end_time,
            event.location,
            event.category_id,
            event.note,
            id,
        ],
    )?;
    Ok(())
}

// ---------- 라우트 (apps/api/src/routes/calendar.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/calendar/snapshot", get(snapshot_handler))
        .route("/calendar/events", post(create_event_handler))
        .route("/calendar/events/{id}", put(update_event_handler))
        .route("/calendar/categories", post(create_category_handler))
        .route("/calendar/categories/order", put(reorder_handler))
        .route(
            "/calendar/categories/{id}",
            put(update_category_handler).delete(delete_category_handler),
        )
        .with_state(db)
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn created() -> (axum::http::StatusCode, Json<Value>) {
    (axum::http::StatusCode::CREATED, Json(json!({ "ok": true })))
}

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<CalendarSnapshot>> {
    Ok(Json(get_snapshot(&db.lock().unwrap())?))
}

async fn create_event_handler(
    State(db): State<Db>,
    Json(input): Json<CalendarWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_event(&db.lock().unwrap(), input)?;
    Ok(created())
}

async fn update_event_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<CalendarWriteInput>,
) -> ApiResult<Json<Value>> {
    update_event(&db.lock().unwrap(), &id, input)?;
    Ok(ok())
}

async fn create_category_handler(
    State(db): State<Db>,
    Json(input): Json<CategoryWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_category(&db.lock().unwrap(), input)?;
    Ok(created())
}

async fn update_category_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<CategoryWriteInput>,
) -> ApiResult<Json<Value>> {
    update_category(&db.lock().unwrap(), &id, input)?;
    Ok(ok())
}

async fn reorder_handler(
    State(db): State<Db>,
    Json(input): Json<CategoryOrderInput>,
) -> ApiResult<Json<Value>> {
    reorder_categories(&mut db.lock().unwrap(), input.category_ids)?;
    Ok(ok())
}

async fn delete_category_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<DeleteCategoryInput>,
) -> ApiResult<Json<Value>> {
    delete_category(&mut db.lock().unwrap(), &id, &input.replacement_category_id)?;
    Ok(ok())
}

// ---------- 테스트 (apps/api/src/repositories/calendar-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn category_input(name: &str) -> CategoryWriteInput {
        CategoryWriteInput { name: name.into(), color: "#b03a55".into() }
    }

    fn event_input(title: &str, category_id: &str) -> CalendarWriteInput {
        CalendarWriteInput {
            title: title.into(),
            start_date: "2026-08-26".into(),
            start_time: None,
            end_date: "2026-08-26".into(),
            end_time: None,
            location: String::new(),
            category_id: category_id.into(),
            note: String::new(),
        }
    }

    fn seed_category(conn: &Connection, name: &str) -> String {
        create_category(conn, category_input(name)).unwrap();
        get_snapshot(conn)
            .unwrap()
            .categories
            .into_iter()
            .find(|c| c.name == name)
            .unwrap()
            .id
    }

    #[test]
    fn stores_events_newest_first() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "취미");
        create_event(&conn, event_input("첫 일정", &category)).unwrap();
        create_event(
            &conn,
            CalendarWriteInput {
                title: "둘째 일정".into(),
                start_date: "2026-08-27".into(),
                start_time: Some("10:00".into()),
                end_date: "2026-08-27".into(),
                end_time: Some("11:00".into()),
                location: "카페".into(),
                category_id: category.clone(),
                note: String::new(),
            },
        )
        .unwrap();
        let titles: Vec<String> =
            get_snapshot(&conn).unwrap().events.into_iter().map(|e| e.title).collect();
        assert_eq!(titles, ["둘째 일정", "첫 일정"]);
    }

    #[test]
    fn rejects_duplicate_category_name() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_category(&conn, "취미");
        let err = create_category(&conn, category_input("취미")).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("이미 있습니다")));
    }

    #[test]
    fn other_category_present_and_new_goes_before() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(
            snapshot.categories.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["other"]
        );
        seed_category(&conn, "취미");
        let names: Vec<String> =
            get_snapshot(&conn).unwrap().categories.into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["취미", "기타"]);
    }

    #[test]
    fn other_category_cannot_be_deleted() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let err = delete_category(&mut conn, "other", "other").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("기타 분류는 삭제할 수 없습니다")));
    }

    #[test]
    fn delete_category_moves_events_and_keeps_last() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let a = seed_category(&conn, "A");
        let b = seed_category(&conn, "B");
        create_event(&conn, event_input("일정", &a)).unwrap();

        delete_category(&mut conn, &a, &b).unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(
            snapshot.categories.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["B", "기타"]
        );
        assert_eq!(snapshot.events[0].category_id, b);

        let err = delete_category(&mut conn, &b, &b).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("달라야")));
    }

    #[test]
    fn update_event_and_missing_is_not_found() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "취미");
        create_event(&conn, event_input("원본", &category)).unwrap();
        let id = get_snapshot(&conn).unwrap().events[0].id.clone();

        let mut edited = event_input("수정됨", &category);
        edited.title = "수정됨".into();
        update_event(&conn, &id, edited).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().events[0].title, "수정됨");

        let err = update_event(&conn, "nope", event_input("x", &category)).unwrap_err();
        assert!(matches!(err, ApiError::NotFound(m) if m.contains("찾을 수 없습니다")));
    }
}
