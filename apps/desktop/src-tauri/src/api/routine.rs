use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{Datelike, SecondsFormat};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::db::Db;
use super::error::{ApiError, ApiResult};

// ---------- DTO (packages/contracts/src/index.ts routine* 스키마) ----------

#[derive(Serialize)]
struct RoutineLabel {
    id: String,
    name: String,
    color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutineDefinition {
    id: String,
    title: String,
    label_id: String,
    days: Vec<i64>,
    start_date: String,
    end_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutineOccurrenceDto {
    id: String,
    routine_id: String,
    occurrence_date: String,
    done: bool,
    completed_at: Option<String>,
}

#[derive(Serialize)]
struct RoutineSnapshot {
    today: String,
    labels: Vec<RoutineLabel>,
    items: Vec<RoutineDefinition>,
    occurrences: Vec<RoutineOccurrenceDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoutineWriteInput {
    title: String,
    label_id: String,
    #[serde(default)]
    days: Vec<i64>,
    end_date: Option<String>,
}

// ---------- 검증 (routineWriteInputSchema / routineDaysSchema) ----------

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

// routineDaysSchema: 0~6 정수, 1~7개, 중복 불가. 저장 시 오름차순 정렬.
fn validated_days(raw: &[i64]) -> ApiResult<Vec<i64>> {
    if raw.is_empty() || raw.len() > 7 {
        return Err(ApiError::validation("반복 요일은 1~7개여야 합니다."));
    }
    if raw.iter().any(|d| !(0..=6).contains(d)) {
        return Err(ApiError::validation("반복 요일은 0~6 사이여야 합니다."));
    }
    let mut days = raw.to_vec();
    days.sort_unstable();
    if days.windows(2).any(|w| w[0] == w[1]) {
        return Err(ApiError::validation("반복 요일은 중복될 수 없습니다."));
    }
    Ok(days)
}

// ---------- 저장소 로직 (apps/api/src/repositories/routine-repository.ts 1:1) ----------

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn today_iso() -> String {
    chrono::Local::now().date_naive().to_string()
}

fn occurrence_id(routine_id: &str, date: &str) -> String {
    format!("routine-occurrence:{routine_id}:{date}")
}

struct RoutineRow {
    id: String,
    title: String,
    label_id: String,
    days: Vec<i64>,
    start_date: String,
    end_date: Option<String>,
}

struct OccurrenceRow {
    id: String,
    #[allow(dead_code)]
    routine_id: String,
    occurrence_date: String,
    done: bool,
    completed_at: Option<String>,
}

fn parse_days(raw: &str) -> Vec<i64> {
    serde_json::from_str(raw).unwrap_or_default()
}

const ROUTINE_COLUMNS: &str = "id, title, label_id, days_json, start_date, end_date";

fn row_to_routine(row: &rusqlite::Row) -> rusqlite::Result<RoutineRow> {
    Ok(RoutineRow {
        id: row.get(0)?,
        title: row.get(1)?,
        label_id: row.get(2)?,
        days: parse_days(&row.get::<_, String>(3)?),
        start_date: row.get(4)?,
        end_date: row.get(5)?,
    })
}

fn load_routines(conn: &Connection) -> ApiResult<Vec<RoutineRow>> {
    let rows = conn
        .prepare(&format!("SELECT {ROUTINE_COLUMNS} FROM routine_items ORDER BY seq DESC"))?
        .query_map([], row_to_routine)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn require_routine(conn: &Connection, id: &str) -> ApiResult<RoutineRow> {
    conn.query_row(
        &format!("SELECT {ROUTINE_COLUMNS} FROM routine_items WHERE id = ?1"),
        [id],
        |row| row_to_routine(row),
    )
    .map_err(|_| ApiError::NotFound(format!("루틴을 찾을 수 없습니다: {id}")))
}

// mock-routine-occurrences.ts isRoutineScheduled 와 동일.
fn is_scheduled(routine: &RoutineRow, date: &str) -> bool {
    if date < routine.start_date.as_str() {
        return false;
    }
    if let Some(end) = &routine.end_date {
        if date > end.as_str() {
            return false;
        }
    }
    let Ok(parsed) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") else {
        return false;
    };
    // JS new Date(`${date}T00:00:00Z`).getUTCDay() 와 동일: 0=일 ~ 6=토
    let weekday = parsed.weekday().num_days_from_sunday() as i64;
    routine.days.contains(&weekday)
}

fn fetch_occurrence(conn: &Connection, id: &str) -> ApiResult<Option<OccurrenceRow>> {
    let row = conn
        .query_row(
            "SELECT id, routine_id, occurrence_date, done, completed_at FROM routine_occurrences WHERE id = ?1",
            [id],
            |row| {
                Ok(OccurrenceRow {
                    id: row.get(0)?,
                    routine_id: row.get(1)?,
                    occurrence_date: row.get(2)?,
                    done: row.get::<_, i64>(3)? != 0,
                    completed_at: row.get(4)?,
                })
            },
        )
        .ok();
    Ok(row)
}

// 결정 키(routineId + date)로 멱등 생성. 스케줄 대상이 아니면 None.
fn ensure_occurrence(
    conn: &Connection,
    routine: &RoutineRow,
    date: &str,
) -> ApiResult<Option<OccurrenceRow>> {
    if !is_scheduled(routine, date) {
        return Ok(None);
    }
    let id = occurrence_id(&routine.id, date);
    if let Some(existing) = fetch_occurrence(conn, &id)? {
        return Ok(Some(existing));
    }
    conn.execute(
        "INSERT INTO routine_occurrences (id, routine_id, occurrence_date, done, completed_at) \
         VALUES (?1, ?2, ?3, 0, NULL)",
        params![id, routine.id, date],
    )?;
    Ok(Some(OccurrenceRow {
        id,
        routine_id: routine.id.clone(),
        occurrence_date: date.to_string(),
        done: false,
        completed_at: None,
    }))
}

fn ensure_today_occurrences(conn: &Connection, today: &str) -> ApiResult<()> {
    for routine in load_routines(conn)? {
        ensure_occurrence(conn, &routine, today)?;
    }
    Ok(())
}

fn toggle(conn: &Connection, occurrence_id: &str) -> ApiResult<()> {
    let current = fetch_occurrence(conn, occurrence_id)?.ok_or_else(|| {
        ApiError::NotFound(format!("occurrence를 찾을 수 없습니다: {occurrence_id}"))
    })?;
    let done = !current.done;
    let completed_at = if done { Some(now_iso()) } else { None };
    conn.execute(
        "UPDATE routine_occurrences SET done = ?1, completed_at = ?2 WHERE id = ?3",
        params![done as i64, completed_at, occurrence_id],
    )?;
    Ok(())
}

fn get_snapshot(conn: &Connection) -> ApiResult<RoutineSnapshot> {
    let today = today_iso();
    ensure_today_occurrences(conn, &today)?;

    let labels = conn
        .prepare("SELECT id, name, color FROM todo_labels ORDER BY order_index ASC")?
        .query_map([], |row| {
            Ok(RoutineLabel { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let items = load_routines(conn)?
        .into_iter()
        .map(|r| RoutineDefinition {
            id: r.id,
            title: r.title,
            label_id: r.label_id,
            days: r.days,
            start_date: r.start_date,
            end_date: r.end_date,
        })
        .collect();

    let occurrences = conn
        .prepare("SELECT id, routine_id, occurrence_date, done, completed_at FROM routine_occurrences")?
        .query_map([], |row| {
            Ok(RoutineOccurrenceDto {
                id: row.get(0)?,
                routine_id: row.get(1)?,
                occurrence_date: row.get(2)?,
                done: row.get::<_, i64>(3)? != 0,
                completed_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(RoutineSnapshot { today, labels, items, occurrences })
}

fn create(conn: &Connection, input: RoutineWriteInput) -> ApiResult<()> {
    let title = validated_title(&input.title)?;
    let days = validated_days(&input.days)?;
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM routine_items", [], |row| row.get(0))?;
    conn.execute(
        "INSERT INTO routine_items (id, seq, title, label_id, days_json, start_date, end_date) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            title,
            input.label_id,
            serde_json::to_string(&days).unwrap(),
            today_iso(),
            input.end_date,
        ],
    )?;
    Ok(())
}

fn update(conn: &Connection, id: &str, input: RoutineWriteInput) -> ApiResult<()> {
    require_routine(conn, id)?;
    let title = validated_title(&input.title)?;
    let days = validated_days(&input.days)?;
    conn.execute(
        "UPDATE routine_items SET title = ?1, label_id = ?2, days_json = ?3, end_date = ?4 WHERE id = ?5",
        params![title, input.label_id, serde_json::to_string(&days).unwrap(), input.end_date, id],
    )?;
    Ok(())
}

fn toggle_today(conn: &Connection, id: &str) -> ApiResult<()> {
    let routine = require_routine(conn, id)?;
    let today = today_iso();
    let occurrence = ensure_occurrence(conn, &routine, &today)?
        .ok_or_else(|| ApiError::BadRequest("오늘 실행하는 루틴이 아닙니다.".into()))?;
    toggle(conn, &occurrence.id)
}

// ---------- todo 경계 read-model join (mock-routine-occurrences.ts routineTodoItems) ----------

pub(super) struct RoutineTodoRow {
    pub id: String,
    pub title: String,
    pub label_id: String,
    pub occurrence_date: String,
    pub done: bool,
    pub completed_at: Option<String>,
    pub routine_id: String,
}

// 오늘 스케줄된 루틴 occurrence를 todo item 형태로. todo 스냅샷 맨 앞에 붙는다.
pub(super) fn today_todo_rows(conn: &Connection) -> ApiResult<Vec<RoutineTodoRow>> {
    let today = today_iso();
    let mut rows = Vec::new();
    for routine in load_routines(conn)? {
        if let Some(occurrence) = ensure_occurrence(conn, &routine, &today)? {
            rows.push(RoutineTodoRow {
                id: occurrence.id,
                title: routine.title,
                label_id: routine.label_id,
                occurrence_date: occurrence.occurrence_date,
                done: occurrence.done,
                completed_at: occurrence.completed_at,
                routine_id: routine.id,
            });
        }
    }
    Ok(rows)
}

// occurrence id 직접 토글. 대상이 아니면 false. (mock toggleRoutineOccurrence)
pub(super) fn toggle_occurrence_by_id(conn: &Connection, id: &str) -> ApiResult<bool> {
    if fetch_occurrence(conn, id)?.is_none() {
        return Ok(false);
    }
    toggle(conn, id)?;
    Ok(true)
}

// ---------- 라우트 (apps/api/src/routes/routine.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/routine/snapshot", get(snapshot_handler))
        .route("/routine/items", post(create_handler))
        .route("/routine/items/{id}", put(update_handler))
        .route("/routine/items/{id}/toggle-today", post(toggle_today_handler))
        .with_state(db)
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn created() -> (axum::http::StatusCode, Json<Value>) {
    (axum::http::StatusCode::CREATED, Json(json!({ "ok": true })))
}

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<RoutineSnapshot>> {
    Ok(Json(get_snapshot(&db.lock().unwrap())?))
}

async fn create_handler(
    State(db): State<Db>,
    Json(input): Json<RoutineWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create(&db.lock().unwrap(), input)?;
    Ok(created())
}

async fn update_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<RoutineWriteInput>,
) -> ApiResult<Json<Value>> {
    update(&db.lock().unwrap(), &id, input)?;
    Ok(ok())
}

async fn toggle_today_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    toggle_today(&db.lock().unwrap(), &id)?;
    Ok(ok())
}

// ---------- 테스트 (apps/api/src/repositories/routine-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::db;

    fn today() -> String {
        chrono::Local::now().date_naive().to_string()
    }

    fn today_weekday() -> i64 {
        chrono::Local::now().date_naive().weekday().num_days_from_sunday() as i64
    }

    fn other_weekday() -> i64 {
        (today_weekday() + 1) % 7
    }

    fn write_input(title: &str, days: Vec<i64>, end_date: Option<&str>) -> RoutineWriteInput {
        RoutineWriteInput {
            title: title.into(),
            label_id: "health".into(),
            days,
            end_date: end_date.map(String::from),
        }
    }

    #[test]
    fn today_routine_makes_occurrence_other_day_does_not() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create(&conn, write_input("오늘 루틴", vec![today_weekday()], None)).unwrap();
        create(&conn, write_input("비지정 루틴", vec![other_weekday()], None)).unwrap();

        let snap = get_snapshot(&conn).unwrap();
        let today_routine = snap.items.iter().find(|i| i.title == "오늘 루틴").unwrap();
        let other_routine = snap.items.iter().find(|i| i.title == "비지정 루틴").unwrap();

        assert!(snap
            .occurrences
            .iter()
            .any(|o| o.routine_id == today_routine.id && o.occurrence_date == today()));
        assert!(!snap.occurrences.iter().any(|o| o.routine_id == other_routine.id));
    }

    #[test]
    fn occurrence_key_is_idempotent() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create(&conn, write_input("루틴", vec![today_weekday()], None)).unwrap();
        get_snapshot(&conn).unwrap();
        get_snapshot(&conn).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().occurrences.len(), 1);
    }

    #[test]
    fn toggle_today_fills_and_clears_completed_at() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create(&conn, write_input("루틴", vec![today_weekday()], None)).unwrap();
        let id = get_snapshot(&conn).unwrap().items[0].id.clone();

        toggle_today(&conn, &id).unwrap();
        let occ = get_snapshot(&conn).unwrap().occurrences.remove(0);
        assert!(occ.done);
        assert!(occ.completed_at.is_some());

        toggle_today(&conn, &id).unwrap();
        let occ = get_snapshot(&conn).unwrap().occurrences.remove(0);
        assert!(!occ.done);
        assert!(occ.completed_at.is_none());
    }

    #[test]
    fn non_today_routine_rejects_toggle_today() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create(&conn, write_input("비지정", vec![other_weekday()], None)).unwrap();
        let id = get_snapshot(&conn).unwrap().items[0].id.clone();
        let err = toggle_today(&conn, &id).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("오늘 실행하는 루틴이 아닙니다")));
    }

    #[test]
    fn no_occurrence_after_end_date() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let yesterday = chrono::Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(1))
            .unwrap()
            .to_string();
        create(&conn, write_input("만료", vec![today_weekday()], Some(&yesterday))).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().occurrences.len(), 0);
    }

    #[test]
    fn toggle_occurrence_by_id_direct() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create(&conn, write_input("루틴", vec![today_weekday()], None)).unwrap();
        let occ_id = get_snapshot(&conn).unwrap().occurrences[0].id.clone();

        assert!(!toggle_occurrence_by_id(&conn, "nope").unwrap());
        assert!(toggle_occurrence_by_id(&conn, &occ_id).unwrap());
        assert!(get_snapshot(&conn).unwrap().occurrences[0].done);
    }

    #[test]
    fn missing_routine_update_is_not_found() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let err = update(&conn, "nope", write_input("x", vec![0], None)).unwrap_err();
        assert!(matches!(err, ApiError::NotFound(m) if m.contains("찾을 수 없습니다")));
    }

    #[test]
    fn stores_days_sorted() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create(&conn, write_input("루틴", vec![3, 1], None)).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].days, vec![1, 3]);
    }

    #[test]
    fn rejects_duplicate_days() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let err = create(&conn, write_input("x", vec![1, 1], None)).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
    }

    #[test]
    fn rejects_empty_days() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let err = create(&conn, write_input("x", vec![], None)).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
    }
}
