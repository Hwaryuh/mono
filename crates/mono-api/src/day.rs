// 하루: what actually happened, as time ranges. The calendar holds the plan; this holds the record.
use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::common::*;
use super::db::{Db, DbExt};
use super::error::{ApiError, ApiResult};
use super::ledger::validated_date;
use super::version::{ensure_versioned_update, expected_version};

// ---------- DTO (packages/contracts/src/index.ts day* schemas) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DayEntry {
    id: String,
    version: i64,
    date: String,
    start_time: String,
    end_time: String,
    title: String,
    todo_id: Option<String>,
    note: String,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoMinutes {
    todo_id: String,
    minutes: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DaySnapshot {
    today: String,
    date: String,
    entries: Vec<DayEntry>,
    /// Logged minutes per linked todo, across every date.
    todo_minutes: Vec<TodoMinutes>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DayEntryWriteInput {
    date: String,
    start_time: String,
    end_time: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    todo_id: Option<String>,
    #[serde(default)]
    note: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Deserialize)]
struct SnapshotQuery {
    date: Option<String>,
}

// ---------- Validation ----------

fn validated_clock(raw: &str) -> ApiResult<String> {
    if raw.len() != 5 || chrono::NaiveTime::parse_from_str(raw, "%H:%M").is_err() {
        return Err(ApiError::validation("시각은 HH:MM 형식이어야 합니다."));
    }
    Ok(raw.to_string())
}

fn clock_minutes(clock: &str) -> i64 {
    let hours: i64 = clock[..2].parse().unwrap_or(0);
    let minutes: i64 = clock[3..].parse().unwrap_or(0);
    hours * 60 + minutes
}

/// An end before the start means the entry ran past midnight.
fn span_minutes(start: &str, end: &str) -> i64 {
    let (start, end) = (clock_minutes(start), clock_minutes(end));
    if end > start { end - start } else { end + 1440 - start }
}

struct ValidEntry {
    date: String,
    start_time: String,
    end_time: String,
    title: String,
    todo_id: Option<String>,
    note: String,
}

fn validated_entry(input: DayEntryWriteInput) -> ApiResult<ValidEntry> {
    let date = validated_date(&input.date)?;
    let start_time = validated_clock(&input.start_time)?;
    let end_time = validated_clock(&input.end_time)?;
    if start_time == end_time {
        return Err(ApiError::validation("시작과 끝 시각이 같습니다."));
    }
    // An empty title is allowed — a finished timer session is logged untitled and named later.
    let title = input.title.trim().to_string();
    if title.chars().count() > 500 {
        return Err(ApiError::validation("한 일은 500자 이하여야 합니다."));
    }
    if input.note.chars().count() > 4_000 {
        return Err(ApiError::validation("메모는 4000자 이하여야 합니다."));
    }
    Ok(ValidEntry {
        date,
        start_time,
        end_time,
        title,
        todo_id: input.todo_id.filter(|id| !id.is_empty()),
        note: input.note,
    })
}

// ---------- Repository logic ----------

fn get_snapshot(conn: &Connection, date: Option<String>) -> ApiResult<DaySnapshot> {
    let today = today_iso();
    let date = match date {
        Some(raw) => validated_date(&raw)?,
        None => today.clone(),
    };

    let entries = conn
        .prepare(
            "SELECT id, version, date, start_time, end_time, title, todo_id, note, source \
             FROM time_entries WHERE date = ?1 ORDER BY start_time ASC, end_time ASC",
        )?
        .query_map([&date], |row| {
            Ok(DayEntry {
                id: row.get(0)?,
                version: row.get(1)?,
                date: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                title: row.get(5)?,
                todo_id: row.get(6)?,
                note: row.get(7)?,
                source: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // ponytail: sums every linked entry on each snapshot. Fine for one person's log; aggregate in SQL if it grows large.
    let mut totals: HashMap<String, i64> = HashMap::new();
    let mut statement =
        conn.prepare("SELECT todo_id, start_time, end_time FROM time_entries WHERE todo_id IS NOT NULL")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (todo_id, start, end) = row?;
        *totals.entry(todo_id).or_default() += span_minutes(&start, &end);
    }
    let mut todo_minutes: Vec<TodoMinutes> =
        totals.into_iter().map(|(todo_id, minutes)| TodoMinutes { todo_id, minutes }).collect();
    todo_minutes.sort_by(|a, b| a.todo_id.cmp(&b.todo_id));

    Ok(DaySnapshot { today, date, entries, todo_minutes })
}

fn create_entry(conn: &Connection, input: DayEntryWriteInput) -> ApiResult<()> {
    let source = match input.source.as_deref() {
        None | Some("manual") => "manual",
        Some("timer") => "timer",
        Some(_) => return Err(ApiError::validation("기록 출처가 올바르지 않습니다.")),
    };
    let entry = validated_entry(input)?;
    conn.execute(
        "INSERT INTO time_entries (id, date, start_time, end_time, title, todo_id, note, source) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            uuid::Uuid::new_v4().to_string(),
            entry.date,
            entry.start_time,
            entry.end_time,
            entry.title,
            entry.todo_id,
            entry.note,
            source,
        ],
    )?;
    Ok(())
}

fn require_entry(conn: &Connection, id: &str) -> ApiResult<()> {
    conn.query_row("SELECT 1 FROM time_entries WHERE id = ?1", [id], |_| Ok(()))
        .map_err(|_| ApiError::NotFound(format!("기록을 찾을 수 없습니다: {id}")))
}

// The source is fixed at creation — an edited timer entry is still a timer entry.
fn update_entry(conn: &Connection, id: &str, input: DayEntryWriteInput, expected: Option<i64>) -> ApiResult<()> {
    require_entry(conn, id)?;
    let entry = validated_entry(input)?;
    let changed = conn.execute(
        "UPDATE time_entries SET date = ?1, start_time = ?2, end_time = ?3, title = ?4, todo_id = ?5, \
         note = ?6, version = version + 1 WHERE id = ?7 AND (?8 IS NULL OR version = ?8)",
        params![entry.date, entry.start_time, entry.end_time, entry.title, entry.todo_id, entry.note, id, expected],
    )?;
    ensure_versioned_update(changed, expected)
}

fn delete_entry(conn: &Connection, id: &str) -> ApiResult<()> {
    require_entry(conn, id)?;
    conn.execute("DELETE FROM time_entries WHERE id = ?1", [id])?;
    Ok(())
}

// ---------- Routes ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/day/snapshot", get(snapshot_handler))
        .route("/day/entries", post(create_handler))
        .route("/day/entries/{id}", put(update_handler).delete(delete_handler))
        .with_state(db)
}

async fn snapshot_handler(
    State(db): State<Db>,
    Query(query): Query<SnapshotQuery>,
) -> ApiResult<Json<DaySnapshot>> {
    Ok(Json(get_snapshot(&db.conn(), query.date)?))
}

async fn create_handler(
    State(db): State<Db>,
    Json(input): Json<DayEntryWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_entry(&db.conn(), input)?;
    Ok(created())
}

async fn update_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<DayEntryWriteInput>,
) -> ApiResult<Json<Value>> {
    update_entry(&db.conn(), &id, input, expected_version(&headers)?)?;
    Ok(ok())
}

async fn delete_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    delete_entry(&db.conn(), &id)?;
    Ok(ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn input(date: &str, start: &str, end: &str, title: &str, todo_id: Option<&str>) -> DayEntryWriteInput {
        DayEntryWriteInput {
            date: date.into(),
            start_time: start.into(),
            end_time: end.into(),
            title: title.into(),
            todo_id: todo_id.map(Into::into),
            note: String::new(),
            source: None,
        }
    }

    #[test]
    fn snapshot_lists_one_date_in_time_order_and_sums_todo_minutes_across_dates() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create_entry(&conn, input("2026-10-03", "10:30", "11:10", "메일 정리", None)).unwrap();
        create_entry(&conn, input("2026-10-03", "09:00", "10:30", "기획 다듬기", Some("t1"))).unwrap();
        create_entry(&conn, input("2026-10-02", "23:30", "00:10", "기획 야간", Some("t1"))).unwrap();

        let snapshot = get_snapshot(&conn, Some("2026-10-03".into())).unwrap();
        let titles: Vec<&str> = snapshot.entries.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, ["기획 다듬기", "메일 정리"]);
        assert_eq!(snapshot.entries[0].source, "manual");
        // 90 minutes on the 3rd + 40 minutes across midnight on the 2nd.
        assert_eq!(snapshot.todo_minutes.len(), 1);
        assert_eq!(snapshot.todo_minutes[0].minutes, 130);
    }

    #[test]
    fn allows_untitled_timer_entry_and_keeps_its_source_on_update() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let mut timer = input("2026-10-03", "13:00", "13:25", "", None);
        timer.source = Some("timer".into());
        create_entry(&conn, timer).unwrap();
        let entry = &get_snapshot(&conn, Some("2026-10-03".into())).unwrap().entries[0];
        assert_eq!((entry.title.as_str(), entry.source.as_str()), ("", "timer"));

        update_entry(&conn, &entry.id.clone(), input("2026-10-03", "13:00", "13:25", "API 리뷰", None), Some(1)).unwrap();
        let entry = &get_snapshot(&conn, Some("2026-10-03".into())).unwrap().entries[0];
        assert_eq!((entry.title.as_str(), entry.source.as_str(), entry.version), ("API 리뷰", "timer", 2));
    }

    #[test]
    fn stale_update_conflicts_and_missing_entry_is_not_found() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        create_entry(&conn, input("2026-10-03", "09:00", "10:00", "a", None)).unwrap();
        let id = get_snapshot(&conn, Some("2026-10-03".into())).unwrap().entries[0].id.clone();
        update_entry(&conn, &id, input("2026-10-03", "09:00", "10:00", "b", None), Some(1)).unwrap();
        assert!(matches!(
            update_entry(&conn, &id, input("2026-10-03", "09:00", "10:00", "c", None), Some(1)).unwrap_err(),
            ApiError::Conflict(_)
        ));
        assert!(matches!(delete_entry(&conn, "nope").unwrap_err(), ApiError::NotFound(_)));
        delete_entry(&conn, &id).unwrap();
        assert!(get_snapshot(&conn, Some("2026-10-03".into())).unwrap().entries.is_empty());
    }

    #[test]
    fn rejects_bad_clock_equal_times_and_unknown_source() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        for (start, end) in [("9:00", "10:00"), ("24:00", "10:00"), ("10:00", "10:00")] {
            assert!(matches!(
                create_entry(&conn, input("2026-10-03", start, end, "x", None)).unwrap_err(),
                ApiError::Validation(_)
            ));
        }
        let mut odd = input("2026-10-03", "09:00", "10:00", "x", None);
        odd.source = Some("calendar".into());
        assert!(matches!(create_entry(&conn, odd).unwrap_err(), ApiError::Validation(_)));
    }
}
