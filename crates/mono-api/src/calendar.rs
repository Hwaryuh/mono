use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{Datelike, Days, Months, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::category::{self, Categories};
use super::common::*;
use super::db::{Db, DbExt};
use super::error::{ApiError, ApiResult};
use super::version::{ensure_versioned_update, expected_version};

// (id, name, color, order_index) 카테고리 공통 CRUD 설정. 로직은 category::Categories.
const CATS: Categories = Categories {
    table: "calendar_categories",
    not_found: "일정 라벨을 찾을 수 없습니다",
    clash: "같은 이름의 분류가 이미 있습니다.",
    reorder_invalid: "분류 순서 목록이 올바르지 않습니다.",
    reorder_mismatch: "분류 순서에 현재 분류가 정확히 한 번씩 포함되어야 합니다.",
};

// ---------- DTO (packages/contracts/src/index.ts calendar* 스키마) ----------

#[derive(Serialize)]
struct CalendarCategory {
    id: String,
    version: i64,
    name: String,
    color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Recurrence {
    freq: String, // daily | weekly | monthly | yearly
    interval: u32,
    #[serde(default)]
    weekdays: Vec<i64>, // 0=일 ~ 6=토, weekly에서만 의미. [] 이면 시작일 요일.
    until: Option<String>,
    count: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CalendarEvent {
    id: String,
    version: i64,
    title: String,
    start_date: String,
    start_time: Option<String>,
    end_date: String,
    end_time: Option<String>,
    location: String,
    category_id: String,
    note: String,
    recurrence: Option<Recurrence>,
    series_id: Option<String>,
    occurrence_date: Option<String>,
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
    #[serde(default)]
    recurrence: Option<Recurrence>,
    // 반복 일정을 수정/삭제할 때의 범위. "this" | "future" | "all". 단발 일정은 무시.
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Deserialize)]
struct SnapshotRange {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Deserialize)]
struct DeleteEventInput {
    #[serde(default)]
    scope: Option<String>,
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

// ---------- 저장소 로직 ----------

fn parse_date(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()
}

fn date_str(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

// 마스터 이벤트 행 + (있으면) 반복 규칙.
struct MasterRow {
    id: String,
    title: String,
    start_date: String,
    start_time: Option<String>,
    end_date: String,
    end_time: Option<String>,
    location: String,
    category_id: String,
    note: String,
    recurrence: Option<Recurrence>,
    version: i64,
}

struct ExceptionRow {
    master_id: String,
    occurrence_date: String,
    kind: String,
    title: Option<String>,
    start_date: Option<String>,
    start_time: Option<String>,
    end_date: Option<String>,
    end_time: Option<String>,
    location: Option<String>,
    category_id: Option<String>,
    note: Option<String>,
}

fn load_masters(conn: &Connection) -> ApiResult<Vec<MasterRow>> {
    let rows = conn
        .prepare(
            "SELECT e.id, e.title, e.start_date, e.start_time, e.end_date, e.end_time, \
                    e.location, e.category_id, e.note, \
                    r.freq, r.interval_n, r.weekdays_json, r.until_date, r.count_n, e.version \
             FROM calendar_events e LEFT JOIN calendar_recurrences r ON r.event_id = e.id \
             ORDER BY e.seq DESC",
        )?
        .query_map([], |row| {
            let freq: Option<String> = row.get(9)?;
            let interval: i64 = row.get::<_, Option<i64>>(10)?.unwrap_or(1);
            let weekdays_json: String = row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "[]".into());
            let until: Option<String> = row.get(12)?;
            let count: Option<i64> = row.get(13)?;
            let recurrence = freq.map(|freq| Recurrence {
                freq,
                interval: interval.max(1) as u32,
                weekdays: serde_json::from_str(&weekdays_json).unwrap_or_default(),
                until,
                count: count.map(|n| n.max(1) as u32),
            });
            Ok(MasterRow {
                id: row.get(0)?,
                title: row.get(1)?,
                start_date: row.get(2)?,
                start_time: row.get(3)?,
                end_date: row.get(4)?,
                end_time: row.get(5)?,
                location: row.get(6)?,
                category_id: row.get(7)?,
                note: row.get(8)?,
                recurrence,
                version: row.get(14)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn load_exceptions(conn: &Connection) -> ApiResult<Vec<ExceptionRow>> {
    let rows = conn
        .prepare(
            "SELECT master_id, occurrence_date, kind, title, start_date, start_time, end_date, \
                    end_time, location, category_id, note FROM calendar_event_exceptions",
        )?
        .query_map([], |row| {
            Ok(ExceptionRow {
                master_id: row.get(0)?,
                occurrence_date: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                start_date: row.get(4)?,
                start_time: row.get(5)?,
                end_date: row.get(6)?,
                end_time: row.get(7)?,
                location: row.get(8)?,
                category_id: row.get(9)?,
                note: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// 규칙에 따라 window_end 까지의 occurrence 슬롯 날짜를 오름차순으로. count·until 을 존중한다.
fn occurrence_slots(rule: &Recurrence, start: NaiveDate, window_end: NaiveDate) -> Vec<NaiveDate> {
    let until = rule.until.as_deref().and_then(parse_date);
    let limit = rule.count.unwrap_or(u32::MAX) as usize;
    let interval = rule.interval.max(1) as i64;
    let mut out: Vec<NaiveDate> = Vec::new();
    let past = |date: NaiveDate| until.is_some_and(|u| date > u) || date > window_end;

    match rule.freq.as_str() {
        "daily" => {
            let mut cursor = start;
            while out.len() < limit && !past(cursor) {
                out.push(cursor);
                match cursor.checked_add_days(Days::new(interval as u64)) {
                    Some(next) => cursor = next,
                    None => break,
                }
            }
        }
        "weekly" => {
            let mut weekdays: Vec<i64> = if rule.weekdays.is_empty() {
                vec![start.weekday().num_days_from_sunday() as i64]
            } else {
                let mut v = rule.weekdays.clone();
                v.sort_unstable();
                v.dedup();
                v
            };
            weekdays.retain(|d| (0..=6).contains(d));
            let week_start =
                start - chrono::Duration::days(start.weekday().num_days_from_sunday() as i64);
            'weeks: for block in 0i64..=1200 {
                let Some(base) = week_start.checked_add_days(Days::new((block * 7 * interval) as u64))
                else {
                    break;
                };
                if base > window_end {
                    break;
                }
                for &weekday in &weekdays {
                    let Some(date) = base.checked_add_days(Days::new(weekday as u64)) else { continue };
                    if date < start {
                        continue;
                    }
                    if out.len() >= limit || past(date) {
                        break 'weeks;
                    }
                    out.push(date);
                }
            }
        }
        "monthly" => {
            let day = start.day();
            for step in 0u32..=2400 {
                let Some(anchor) = start.checked_add_months(Months::new(step * rule.interval.max(1)))
                else {
                    break;
                };
                // 그 달에 같은 '일'이 없으면(예: 매월 31일 → 2월) 건너뛴다.
                let Some(date) = NaiveDate::from_ymd_opt(anchor.year(), anchor.month(), day) else {
                    continue;
                };
                if date < start {
                    continue;
                }
                if out.len() >= limit || past(date) {
                    break;
                }
                out.push(date);
            }
        }
        "yearly" => {
            let (month, day) = (start.month(), start.day());
            let mut step = 0i32;
            loop {
                let year = start.year() + step * rule.interval.max(1) as i32;
                step += 1;
                if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                    if date >= start {
                        if out.len() >= limit || past(date) {
                            break;
                        }
                        out.push(date);
                    }
                }
                if step > 400 {
                    break;
                }
            }
        }
        _ => {}
    }
    out
}

fn to_event(master: &MasterRow, slot: Option<NaiveDate>, span_days: i64) -> CalendarEvent {
    match slot {
        None => CalendarEvent {
            id: master.id.clone(),
            version: master.version,
            title: master.title.clone(),
            start_date: master.start_date.clone(),
            start_time: master.start_time.clone(),
            end_date: master.end_date.clone(),
            end_time: master.end_time.clone(),
            location: master.location.clone(),
            category_id: master.category_id.clone(),
            note: master.note.clone(),
            recurrence: master.recurrence.clone(),
            series_id: None,
            occurrence_date: None,
        },
        Some(date) => {
            let end = date.checked_add_days(Days::new(span_days.max(0) as u64)).unwrap_or(date);
            let occ = date_str(date);
            CalendarEvent {
                id: format!("{}::{}", master.id, occ),
                version: master.version,
                title: master.title.clone(),
                start_date: occ.clone(),
                start_time: master.start_time.clone(),
                end_date: date_str(end),
                end_time: master.end_time.clone(),
                location: master.location.clone(),
                category_id: master.category_id.clone(),
                note: master.note.clone(),
                recurrence: master.recurrence.clone(),
                series_id: Some(master.id.clone()),
                occurrence_date: Some(occ),
            }
        }
    }
}

fn apply_exception(mut event: CalendarEvent, exception: &ExceptionRow) -> CalendarEvent {
    if let Some(v) = &exception.title {
        event.title = v.clone();
    }
    if let Some(v) = &exception.start_date {
        event.start_date = v.clone();
    }
    if let Some(v) = &exception.end_date {
        event.end_date = v.clone();
    }
    if let Some(v) = &exception.location {
        event.location = v.clone();
    }
    if let Some(v) = &exception.category_id {
        event.category_id = v.clone();
    }
    if let Some(v) = &exception.note {
        event.note = v.clone();
    }
    event.start_time = exception.start_time.clone();
    event.end_time = exception.end_time.clone();
    event
}

fn expand_master(
    master: &MasterRow,
    from: NaiveDate,
    to: NaiveDate,
    exceptions: &[&ExceptionRow],
) -> Vec<CalendarEvent> {
    let span_days = match (parse_date(&master.start_date), parse_date(&master.end_date)) {
        (Some(s), Some(e)) => (e - s).num_days().max(0),
        _ => 0,
    };

    let from_str = date_str(from);
    let to_str = date_str(to);

    let Some(rule) = &master.recurrence else {
        // 단발: [start, end] 가 window 와 겹치면 그대로.
        if master.end_date >= from_str && master.start_date <= to_str {
            return vec![to_event(master, None, span_days)];
        }
        return vec![];
    };

    let Some(start) = parse_date(&master.start_date) else {
        return vec![];
    };
    let mut out = Vec::new();
    for slot in occurrence_slots(rule, start, to) {
        let occ = date_str(slot);
        let exception = exceptions.iter().find(|ex| ex.occurrence_date == occ);
        match exception {
            Some(ex) if ex.kind == "cancelled" => continue,
            Some(ex) => {
                let event = apply_exception(to_event(master, Some(slot), span_days), ex);
                if event.end_date >= from_str {
                    out.push(event);
                }
            }
            None => {
                let slot_end =
                    slot.checked_add_days(Days::new(span_days.max(0) as u64)).unwrap_or(slot);
                if slot_end >= from {
                    out.push(to_event(master, Some(slot), span_days));
                }
            }
        }
    }
    out
}

fn get_snapshot(conn: &Connection, from: Option<&str>, to: Option<&str>) -> ApiResult<CalendarSnapshot> {
    let today = today_iso();
    let today_date = parse_date(&today).unwrap_or_else(|| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());
    // 클라이언트가 창을 주지 않으면 이번 달 그리드를 넉넉히 덮는 ±45일.
    let from_date = from
        .and_then(parse_date)
        .unwrap_or_else(|| today_date - chrono::Duration::days(45));
    let to_date = to
        .and_then(parse_date)
        .unwrap_or_else(|| today_date + chrono::Duration::days(45));

    let categories = conn
        .prepare("SELECT id, version, name, color FROM calendar_categories ORDER BY order_index ASC")?
        .query_map([], |row| {
            Ok(CalendarCategory { id: row.get(0)?, version: row.get(1)?, name: row.get(2)?, color: row.get(3)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let events = expand_all(conn, from_date, to_date)?;
    Ok(CalendarSnapshot { today, categories, events })
}

fn expand_all(conn: &Connection, from: NaiveDate, to: NaiveDate) -> ApiResult<Vec<CalendarEvent>> {
    let masters = load_masters(conn)?;
    let all_exceptions = load_exceptions(conn)?;
    let mut events: Vec<CalendarEvent> = Vec::new();
    for master in &masters {
        let mine: Vec<&ExceptionRow> =
            all_exceptions.iter().filter(|ex| ex.master_id == master.id).collect();
        events.extend(expand_master(master, from, to, &mine));
    }
    Ok(events)
}

// (id, title, start_time, category_id)
pub(super) type DashboardEventRow = (String, String, Option<String>, String);

// dashboard 경계: 그 날짜에 시작하는 일정(반복 occurrence 포함).
pub(super) fn events_starting_on(conn: &Connection, date: &str) -> ApiResult<Vec<DashboardEventRow>> {
    let Some(day) = parse_date(date) else { return Ok(vec![]) };
    Ok(expand_all(conn, day, day)?
        .into_iter()
        .filter(|event| event.start_date == date)
        .map(|event| (event.id, event.title, event.start_time, event.category_id))
        .collect())
}

fn create_category(conn: &Connection, input: CategoryWriteInput) -> ApiResult<()> {
    CATS.insert(conn, &input.name, &input.color)
}

fn update_category(conn: &Connection, id: &str, input: CategoryWriteInput, expected: Option<i64>) -> ApiResult<()> {
    CATS.update(conn, id, &input.name, &input.color, expected)
}

fn reorder_categories(conn: &mut Connection, ids: Vec<String>) -> ApiResult<()> {
    CATS.reorder(conn, ids)
}

fn delete_category(conn: &mut Connection, id: &str, replacement: &str) -> ApiResult<()> {
    CATS.require(conn, id)?;
    if id == category::RESERVED_ID {
        return Err(ApiError::BadRequest("기타 분류는 삭제할 수 없습니다.".into()));
    }
    CATS.require(conn, replacement)?;
    if id == replacement {
        return Err(ApiError::BadRequest("삭제할 분류와 이동할 분류는 달라야 합니다.".into()));
    }
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM calendar_categories", [], |row| row.get(0))?;
    if count == 1 {
        return Err(ApiError::BadRequest("마지막 분류는 삭제할 수 없습니다.".into()));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE calendar_events SET category_id = ?1, version = version + 1 WHERE category_id = ?2",
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

fn validate_event(input: &CalendarWriteInput) -> ApiResult<EventColumns> {
    Ok(EventColumns {
        title: validated_title(&input.title)?,
        start_date: input.start_date.clone(),
        start_time: input.start_time.clone(),
        end_date: input.end_date.clone(),
        end_time: input.end_time.clone(),
        location: validated_len(&input.location, 500, "장소")?,
        category_id: input.category_id.clone(),
        note: validated_len(&input.note, 4_000, "메모")?,
    })
}

fn validated_recurrence(raw: &Recurrence) -> ApiResult<Recurrence> {
    if !matches!(raw.freq.as_str(), "daily" | "weekly" | "monthly" | "yearly") {
        return Err(ApiError::validation("반복 주기가 올바르지 않습니다."));
    }
    if !(1..=999).contains(&raw.interval) {
        return Err(ApiError::validation("반복 간격은 1~999여야 합니다."));
    }
    if raw.weekdays.iter().any(|d| !(0..=6).contains(d)) {
        return Err(ApiError::validation("반복 요일은 0~6 사이여야 합니다."));
    }
    if let Some(until) = &raw.until {
        parse_date(until).ok_or_else(|| ApiError::validation("반복 종료 날짜가 올바르지 않습니다."))?;
    }
    if let Some(count) = raw.count {
        if !(1..=999).contains(&count) {
            return Err(ApiError::validation("반복 횟수는 1~999여야 합니다."));
        }
    }
    let mut weekdays = raw.weekdays.clone();
    weekdays.sort_unstable();
    weekdays.dedup();
    Ok(Recurrence {
        freq: raw.freq.clone(),
        interval: raw.interval,
        weekdays,
        until: raw.until.clone(),
        count: raw.count,
    })
}

fn next_seq(conn: &Connection) -> ApiResult<i64> {
    Ok(conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM calendar_events", [], |row| row.get(0))?)
}

fn insert_event(
    conn: &Connection,
    id: &str,
    event: &EventColumns,
    recurrence: Option<&Recurrence>,
) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO calendar_events \
         (id, seq, title, start_date, start_time, end_date, end_time, location, category_id, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            next_seq(conn)? + 1,
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
    if let Some(rule) = recurrence {
        conn.execute(
            "INSERT OR REPLACE INTO calendar_recurrences \
             (event_id, freq, interval_n, weekdays_json, until_date, count_n) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                rule.freq,
                rule.interval as i64,
                serde_json::to_string(&rule.weekdays).unwrap(),
                rule.until,
                rule.count.map(|n| n as i64),
            ],
        )?;
    }
    Ok(())
}

fn create_event(conn: &Connection, input: CalendarWriteInput) -> ApiResult<()> {
    let event = validate_event(&input)?;
    let recurrence = input.recurrence.as_ref().map(validated_recurrence).transpose()?;
    insert_event(conn, &uuid::Uuid::new_v4().to_string(), &event, recurrence.as_ref())
}

fn set_master_columns(conn: &Connection, id: &str, event: &EventColumns, expected: Option<i64>) -> ApiResult<()> {
    let changed = conn.execute(
        "UPDATE calendar_events SET title = ?1, start_date = ?2, start_time = ?3, end_date = ?4, \
         end_time = ?5, location = ?6, category_id = ?7, note = ?8, version = version + 1 \
         WHERE id = ?9 AND (?10 IS NULL OR version = ?10)",
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
            expected,
        ],
    )?;
    ensure_versioned_update(changed, expected)
}

fn set_recurrence(conn: &Connection, id: &str, recurrence: Option<&Recurrence>) -> ApiResult<()> {
    conn.execute("DELETE FROM calendar_recurrences WHERE event_id = ?1", [id])?;
    if let Some(rule) = recurrence {
        conn.execute(
            "INSERT INTO calendar_recurrences \
             (event_id, freq, interval_n, weekdays_json, until_date, count_n) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                rule.freq,
                rule.interval as i64,
                serde_json::to_string(&rule.weekdays).unwrap(),
                rule.until,
                rule.count.map(|n| n as i64),
            ],
        )?;
    }
    Ok(())
}

fn load_master(conn: &Connection, id: &str) -> ApiResult<MasterRow> {
    load_masters(conn)?
        .into_iter()
        .find(|master| master.id == id)
        .ok_or_else(|| ApiError::NotFound(format!("일정을 찾을 수 없습니다: {id}")))
}

// id 는 "uuid" 또는 "uuid::YYYY-MM-DD"(전개된 occurrence).
fn split_event_id(raw: &str) -> (String, Option<String>) {
    match raw.split_once("::") {
        Some((master, occ)) => (master.to_string(), Some(occ.to_string())),
        None => (raw.to_string(), None),
    }
}

fn upsert_exception(
    conn: &Connection,
    master_id: &str,
    occurrence_date: &str,
    kind: &str,
    event: Option<&EventColumns>,
) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO calendar_event_exceptions \
         (id, master_id, occurrence_date, kind, title, start_date, start_time, end_date, end_time, location, category_id, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) \
         ON CONFLICT(master_id, occurrence_date) DO UPDATE SET \
         kind = excluded.kind, title = excluded.title, start_date = excluded.start_date, \
         start_time = excluded.start_time, end_date = excluded.end_date, end_time = excluded.end_time, \
         location = excluded.location, category_id = excluded.category_id, note = excluded.note",
        params![
            uuid::Uuid::new_v4().to_string(),
            master_id,
            occurrence_date,
            kind,
            event.map(|e| e.title.clone()),
            event.map(|e| e.start_date.clone()),
            event.and_then(|e| e.start_time.clone()),
            event.map(|e| e.end_date.clone()),
            event.and_then(|e| e.end_time.clone()),
            event.map(|e| e.location.clone()),
            event.map(|e| e.category_id.clone()),
            event.map(|e| e.note.clone()),
        ],
    )?;
    Ok(())
}

// 시리즈를 이 occurrence 직전까지로 자른다. 첫 occurrence 이면 시리즈 자체를 지운다.
// 잘렸으면 true, 통째로 지웠으면 false.
fn truncate_series_before(conn: &Connection, master: &MasterRow, occurrence_date: &str) -> ApiResult<bool> {
    if occurrence_date <= master.start_date.as_str() {
        delete_series(conn, &master.id)?;
        return Ok(false);
    }
    let Some(cutoff) = parse_date(occurrence_date).and_then(|d| d.checked_sub_days(Days::new(1))) else {
        return Err(ApiError::validation("반복 종료 날짜를 계산할 수 없습니다."));
    };
    conn.execute(
        "UPDATE calendar_recurrences SET until_date = ?1, count_n = NULL WHERE event_id = ?2",
        params![date_str(cutoff), master.id],
    )?;
    // 잘린 구간 뒤의 예외는 의미가 없으니 정리.
    conn.execute(
        "DELETE FROM calendar_event_exceptions WHERE master_id = ?1 AND occurrence_date >= ?2",
        params![master.id, occurrence_date],
    )?;
    Ok(true)
}

fn delete_series(conn: &Connection, master_id: &str) -> ApiResult<()> {
    conn.execute("DELETE FROM calendar_event_exceptions WHERE master_id = ?1", [master_id])?;
    conn.execute("DELETE FROM calendar_recurrences WHERE event_id = ?1", [master_id])?;
    conn.execute("DELETE FROM calendar_events WHERE id = ?1", [master_id])?;
    Ok(())
}

fn update_event(conn: &Connection, raw_id: &str, input: CalendarWriteInput, expected: Option<i64>) -> ApiResult<()> {
    let (master_id, occ) = split_event_id(raw_id);
    let master = load_master(conn, &master_id)?;
    let event = validate_event(&input)?;
    let recurrence = input.recurrence.as_ref().map(validated_recurrence).transpose()?;
    let scope = input.scope.as_deref().unwrap_or("all");

    // 단발 일정: 그대로 수정.
    if master.recurrence.is_none() && occ.is_none() {
        set_master_columns(conn, &master_id, &event, expected)?;
        set_recurrence(conn, &master_id, recurrence.as_ref())?;
        return Ok(());
    }

    let occurrence_date = occ.unwrap_or_else(|| master.start_date.clone());
    match scope {
        "this" => {
            upsert_exception(conn, &master_id, &occurrence_date, "modified", Some(&event))?;
        }
        "future" => {
            // 이 occurrence 부터: 기존 시리즈를 직전까지 자르고, 여기서 새 시리즈 시작.
            let still_exists = truncate_series_before(conn, &master, &occurrence_date)?;
            let new_recurrence = recurrence.or_else(|| master.recurrence.clone());
            if still_exists {
                insert_event(conn, &uuid::Uuid::new_v4().to_string(), &event, new_recurrence.as_ref())?;
            } else {
                // 첫 occurrence 였으면 시리즈가 통째로 지워졌으니 새로 만든다(= all 과 동일 효과).
                insert_event(conn, &uuid::Uuid::new_v4().to_string(), &event, new_recurrence.as_ref())?;
            }
        }
        _ => {
            // all: 마스터 갱신, 개별 예외는 정리.
            set_master_columns(conn, &master_id, &event, expected)?;
            set_recurrence(conn, &master_id, recurrence.or_else(|| master.recurrence.clone()).as_ref())?;
            conn.execute("DELETE FROM calendar_event_exceptions WHERE master_id = ?1", [master_id.as_str()])?;
        }
    }
    Ok(())
}

fn delete_event(conn: &Connection, raw_id: &str, scope: Option<&str>) -> ApiResult<()> {
    let (master_id, occ) = split_event_id(raw_id);
    let master = load_master(conn, &master_id)?;

    if master.recurrence.is_none() && occ.is_none() {
        delete_series(conn, &master_id)?;
        return Ok(());
    }

    let occurrence_date = occ.unwrap_or_else(|| master.start_date.clone());
    match scope.unwrap_or("all") {
        "this" => upsert_exception(conn, &master_id, &occurrence_date, "cancelled", None)?,
        "future" => {
            truncate_series_before(conn, &master, &occurrence_date)?;
        }
        _ => delete_series(conn, &master_id)?,
    }
    Ok(())
}

// ---------- 라우트 (apps/api/src/routes/calendar.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/calendar/snapshot", get(snapshot_handler))
        .route("/calendar/events", post(create_event_handler))
        .route(
            "/calendar/events/{id}",
            put(update_event_handler).delete(delete_event_handler),
        )
        .route("/calendar/categories", post(create_category_handler))
        .route("/calendar/categories/order", put(reorder_handler))
        .route(
            "/calendar/categories/{id}",
            put(update_category_handler).delete(delete_category_handler),
        )
        .with_state(db)
}

async fn snapshot_handler(
    State(db): State<Db>,
    Query(range): Query<SnapshotRange>,
) -> ApiResult<Json<CalendarSnapshot>> {
    Ok(Json(get_snapshot(&db.conn(), range.from.as_deref(), range.to.as_deref())?))
}

async fn create_event_handler(
    State(db): State<Db>,
    Json(input): Json<CalendarWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_event(&db.conn(), input)?;
    Ok(created())
}

async fn update_event_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<CalendarWriteInput>,
) -> ApiResult<Json<Value>> {
    update_event(&db.conn(), &id, input, expected_version(&headers)?)?;
    Ok(ok())
}

async fn delete_event_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    input: Option<Json<DeleteEventInput>>,
) -> ApiResult<Json<Value>> {
    let scope = input.and_then(|Json(body)| body.scope);
    delete_event(&db.conn(), &id, scope.as_deref())?;
    Ok(ok())
}

async fn create_category_handler(
    State(db): State<Db>,
    Json(input): Json<CategoryWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_category(&db.conn(), input)?;
    Ok(created())
}

async fn update_category_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<CategoryWriteInput>,
) -> ApiResult<Json<Value>> {
    update_category(&db.conn(), &id, input, expected_version(&headers)?)?;
    Ok(ok())
}

async fn reorder_handler(
    State(db): State<Db>,
    Json(input): Json<CategoryOrderInput>,
) -> ApiResult<Json<Value>> {
    reorder_categories(&mut db.conn(), input.category_ids)?;
    Ok(ok())
}

async fn delete_category_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<DeleteCategoryInput>,
) -> ApiResult<Json<Value>> {
    delete_category(&mut db.conn(), &id, &input.replacement_category_id)?;
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
            recurrence: None,
            scope: None,
        }
    }

    fn snapshot(conn: &Connection) -> CalendarSnapshot {
        // 테스트는 넓은 창으로 본다.
        get_snapshot(conn, Some("2000-01-01"), Some("2100-01-01")).unwrap()
    }

    fn seed_category(conn: &Connection, name: &str) -> String {
        create_category(conn, category_input(name)).unwrap();
        snapshot(conn)
            .categories
            .into_iter()
            .find(|c| c.name == name)
            .unwrap()
            .id
    }

    fn recurring_input(title: &str, category_id: &str, start: &str, rule: Recurrence) -> CalendarWriteInput {
        let mut input = event_input(title, category_id);
        input.start_date = start.into();
        input.end_date = start.into();
        input.recurrence = Some(rule);
        input
    }

    fn weekly(interval: u32, weekdays: Vec<i64>, until: Option<&str>, count: Option<u32>) -> Recurrence {
        Recurrence { freq: "weekly".into(), interval, weekdays, until: until.map(String::from), count }
    }

    fn first_event_id(conn: &Connection) -> String {
        snapshot(conn).events[0].id.clone()
    }

    fn master_id(conn: &Connection) -> String {
        conn.query_row("SELECT id FROM calendar_events LIMIT 1", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn stores_events_newest_first() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "취미");
        create_event(&conn, event_input("첫 일정", &category)).unwrap();
        let mut second = event_input("둘째 일정", &category);
        second.start_date = "2026-08-27".into();
        second.end_date = "2026-08-27".into();
        create_event(&conn, second).unwrap();
        let titles: Vec<String> =
            snapshot(&conn).events.into_iter().map(|e| e.title).collect();
        assert_eq!(titles, ["둘째 일정", "첫 일정"]);
    }

    #[test]
    fn weekly_recurrence_expands_within_window() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "업무");
        // 2026-08-03 은 월요일. 매주 월요일.
        create_event(&conn, recurring_input("주간 회의", &category, "2026-08-03", weekly(1, vec![1], None, None)))
            .unwrap();

        let snap = get_snapshot(&conn, Some("2026-08-01"), Some("2026-08-31")).unwrap();
        let dates: Vec<String> = snap.events.iter().map(|e| e.start_date.clone()).collect();
        assert_eq!(dates, ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
        assert!(snap.events.iter().all(|e| e.series_id.is_some() && e.recurrence.is_some()));
    }

    #[test]
    fn recurrence_respects_count_and_window() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "업무");
        create_event(&conn, recurring_input("3회 반복", &category, "2026-08-03", weekly(1, vec![1], None, Some(3))))
            .unwrap();
        let snap = get_snapshot(&conn, Some("2026-01-01"), Some("2027-01-01")).unwrap();
        assert_eq!(snap.events.len(), 3);
        assert_eq!(snap.events.last().unwrap().start_date, "2026-08-17");
    }

    #[test]
    fn edit_this_only_writes_a_modified_exception() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "업무");
        create_event(&conn, recurring_input("스탠드업", &category, "2026-08-03", weekly(1, vec![1], None, None)))
            .unwrap();
        let master = master_id(&conn);

        let mut edit = event_input("스탠드업(연기)", &category);
        edit.start_date = "2026-08-10".into();
        edit.end_date = "2026-08-10".into();
        edit.start_time = Some("14:00".into());
        edit.scope = Some("this".into());
        update_event(&conn, &format!("{master}::2026-08-10"), edit, None).unwrap();

        let snap = get_snapshot(&conn, Some("2026-08-01"), Some("2026-08-31")).unwrap();
        let occ = snap.events.iter().find(|e| e.occurrence_date.as_deref() == Some("2026-08-10")).unwrap();
        assert_eq!(occ.title, "스탠드업(연기)");
        assert_eq!(occ.start_time.as_deref(), Some("14:00"));
        // 다른 occurrence 는 그대로.
        assert_eq!(
            snap.events.iter().find(|e| e.occurrence_date.as_deref() == Some("2026-08-17")).unwrap().title,
            "스탠드업"
        );
    }

    #[test]
    fn delete_this_only_cancels_one_occurrence() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "업무");
        create_event(&conn, recurring_input("주간", &category, "2026-08-03", weekly(1, vec![1], None, None)))
            .unwrap();
        let master = master_id(&conn);

        delete_event(&conn, &format!("{master}::2026-08-17"), Some("this")).unwrap();
        let snap = get_snapshot(&conn, Some("2026-08-01"), Some("2026-08-31")).unwrap();
        assert!(!snap.events.iter().any(|e| e.start_date == "2026-08-17"));
        assert!(snap.events.iter().any(|e| e.start_date == "2026-08-10"));
        assert!(snap.events.iter().any(|e| e.start_date == "2026-08-24"));
    }

    #[test]
    fn edit_future_splits_the_series() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "업무");
        create_event(&conn, recurring_input("회의", &category, "2026-08-03", weekly(1, vec![1], None, None)))
            .unwrap();
        let master = master_id(&conn);

        let mut edit = event_input("회의(새 시간)", &category);
        edit.start_date = "2026-08-17".into();
        edit.end_date = "2026-08-17".into();
        edit.start_time = Some("09:00".into());
        edit.recurrence = Some(weekly(1, vec![1], None, None));
        edit.scope = Some("future".into());
        update_event(&conn, &format!("{master}::2026-08-17"), edit, None).unwrap();

        let snap = get_snapshot(&conn, Some("2026-08-01"), Some("2026-08-31")).unwrap();
        let by_date = |d: &str| snap.events.iter().find(|e| e.start_date == d).cloned();
        assert_eq!(by_date("2026-08-10").unwrap().title, "회의");
        assert_eq!(by_date("2026-08-17").unwrap().title, "회의(새 시간)");
        assert_eq!(by_date("2026-08-24").unwrap().title, "회의(새 시간)");
        // 두 시리즈로 쪼개졌다.
        let series: std::collections::HashSet<_> =
            snap.events.iter().filter_map(|e| e.series_id.clone()).collect();
        assert_eq!(series.len(), 2);
    }

    #[test]
    fn delete_all_removes_series_and_exceptions() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "업무");
        create_event(&conn, recurring_input("주간", &category, "2026-08-03", weekly(1, vec![1], None, None)))
            .unwrap();
        let master = master_id(&conn);
        delete_event(&conn, &format!("{master}::2026-08-10"), Some("this")).unwrap();
        delete_event(&conn, &master, Some("all")).unwrap();

        let snap = get_snapshot(&conn, Some("2026-01-01"), Some("2027-01-01")).unwrap();
        assert!(snap.events.is_empty());
        let exceptions: i64 =
            conn.query_row("SELECT COUNT(*) FROM calendar_event_exceptions", [], |row| row.get(0)).unwrap();
        assert_eq!(exceptions, 0);
    }

    #[test]
    fn plain_event_delete_and_edit() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "취미");
        create_event(&conn, event_input("단발", &category)).unwrap();
        let id = first_event_id(&conn);
        delete_event(&conn, &id, None).unwrap();
        assert!(snapshot(&conn).events.is_empty());
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
        let snap = snapshot(&conn);
        assert_eq!(
            snap.categories.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["other"]
        );
        seed_category(&conn, "취미");
        let names: Vec<String> =
            snapshot(&conn).categories.into_iter().map(|c| c.name).collect();
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
        let snap = snapshot(&conn);
        assert_eq!(
            snap.categories.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["B", "기타"]
        );
        assert_eq!(snap.events[0].category_id, b);

        let err = delete_category(&mut conn, &b, &b).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("달라야")));
    }

    #[test]
    fn update_event_and_missing_is_not_found() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let category = seed_category(&conn, "취미");
        create_event(&conn, event_input("원본", &category)).unwrap();
        let id = snapshot(&conn).events[0].id.clone();

        let mut edited = event_input("수정됨", &category);
        edited.title = "수정됨".into();
        update_event(&conn, &id, edited, None).unwrap();
        assert_eq!(snapshot(&conn).events[0].title, "수정됨");

        let err = update_event(&conn, "nope", event_input("x", &category), None).unwrap_err();
        assert!(matches!(err, ApiError::NotFound(m) if m.contains("찾을 수 없습니다")));
    }
}
