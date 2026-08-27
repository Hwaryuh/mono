use std::collections::{HashMap, HashSet};

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Datelike;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};

use super::db::Db;
use super::error::ApiResult;
use super::{routine, todo};

// capture(캡처 분석)는 AI 경계와 얽혀 있어 아직 프록시로 Node에 넘긴다.
// 여기서는 read-model 조회(getSnapshot)와 toggleTask만 네이티브 처리한다.

const OTHER_COLOR: &str = "oklch(0.645 0.009 106.643)";

// ---------- DTO (packages/contracts/src/index.ts dashboardSnapshotSchema) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    title: String,
    label: String,
    label_color: String,
    done: bool,
    is_routine: bool,
}

#[derive(Serialize)]
struct EventDto {
    id: String,
    title: String,
    time: String,
    color: String,
}

#[derive(Serialize)]
struct ExpenseCategory {
    name: String,
    amount: i64,
    color: String,
}

#[derive(Serialize)]
struct MonthlyExpense {
    total: i64,
    categories: Vec<ExpenseCategory>,
}

#[derive(Serialize)]
struct RoutineSummary {
    id: String,
    title: String,
    week: Vec<bool>,
    period: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapSummary {
    id: String,
    title: String,
    kind: String,
    comment_count: i64,
}

#[derive(Serialize)]
struct RecentCapture {
    id: String,
    raw: String,
    module: String,
    confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardSnapshot {
    date_label: String,
    pending_capture_count: i64,
    recent_captures: Vec<RecentCapture>,
    tasks: Vec<Task>,
    events: Vec<EventDto>,
    monthly_expense: MonthlyExpense,
    routines: Vec<RoutineSummary>,
    scraps: Vec<ScrapSummary>,
}

// ---------- 로직 (apps/api/src/repositories/dashboard-repository.ts getSnapshot 1:1) ----------

fn today_iso() -> String {
    chrono::Local::now().date_naive().to_string()
}

// domain koreanDateLabel(iso, "long")
fn korean_date_label(iso: &str) -> String {
    const WEEKDAYS: [&str; 7] = ["일", "월", "화", "수", "목", "금", "토"];
    match chrono::NaiveDate::parse_from_str(iso, "%Y-%m-%d") {
        Ok(d) => {
            let wd = d.weekday().num_days_from_sunday() as usize;
            format!("{}년 {}월 {}일 {}요일", d.year(), d.month(), d.day(), WEEKDAYS[wd])
        }
        Err(_) => iso.to_string(),
    }
}

// dashboard-repository.ts formatPeriod
fn format_period(end_date: &Option<String>) -> String {
    match end_date {
        None => "∞".to_string(),
        Some(d) => {
            let mut it = d.split('-').skip(1);
            let m: i64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let day: i64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            format!("~{m}/{day}")
        }
    }
}

fn scrap_kind_label(kind: &str) -> &'static str {
    match kind {
        "image" => "사진",
        "url" => "링크",
        "video" => "동영상",
        _ => "메모",
    }
}

// dashboard-repository.ts datesEndingAt(today, 7) — [today-6 .. today]
fn week_ending_today(today: &str) -> Vec<String> {
    let Ok(end) = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") else {
        return Vec::new();
    };
    (0..7u64)
        .rev()
        .filter_map(|i| end.checked_sub_days(chrono::Days::new(i)).map(|d| d.to_string()))
        .collect()
}

fn todo_labels(conn: &Connection) -> ApiResult<HashMap<String, (String, String)>> {
    let map = conn
        .prepare("SELECT id, name, color FROM todo_labels")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, (row.get::<_, String>(1)?, row.get::<_, String>(2)?)))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    Ok(map)
}

fn label_of<'a>(labels: &'a HashMap<String, (String, String)>, id: &str) -> (&'a str, &'a str) {
    labels
        .get(id)
        .map(|(name, color)| (name.as_str(), color.as_str()))
        .unwrap_or(("미지정", OTHER_COLOR))
}

fn get_snapshot(conn: &Connection) -> ApiResult<DashboardSnapshot> {
    let today = today_iso();
    let labels = todo_labels(conn)?;

    let pending_capture_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM inbox_items WHERE status IN ('pending', 'processing')",
        [],
        |row| row.get(0),
    )?;

    // 루틴 occurrence를 todo task보다 앞에 (routine.rs가 오늘 occurrence를 멱등 생성).
    let mut tasks: Vec<Task> = routine::today_todo_rows(conn)?
        .into_iter()
        .map(|r| {
            let (name, color) = label_of(&labels, &r.label_id);
            Task {
                id: r.id,
                title: r.title,
                label: name.to_string(),
                label_color: color.to_string(),
                done: r.done,
                is_routine: true,
            }
        })
        .collect();

    let todo_tasks = conn
        .prepare("SELECT id, title, label_id, done FROM todo_items ORDER BY seq DESC LIMIT 2")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, title, label_id, done) in todo_tasks {
        let (name, color) = label_of(&labels, &label_id);
        tasks.push(Task {
            id,
            title,
            label: name.to_string(),
            label_color: color.to_string(),
            done,
            is_routine: false,
        });
    }

    // 오늘 일정, 시작시간 오름차순(없으면 "" 취급, 안정 정렬로 seq 순서 유지)
    let cal_colors: HashMap<String, String> = conn
        .prepare("SELECT id, color FROM calendar_categories")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    let mut event_rows = conn
        .prepare(
            "SELECT id, title, start_time, category_id FROM calendar_events \
             WHERE start_date = ?1 ORDER BY seq DESC",
        )?
        .query_map([&today], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    event_rows.sort_by(|a, b| {
        a.2.clone().unwrap_or_default().cmp(&b.2.clone().unwrap_or_default())
    });
    let events: Vec<EventDto> = event_rows
        .into_iter()
        .map(|(id, title, start_time, category_id)| EventDto {
            id,
            title,
            time: start_time.unwrap_or_else(|| "종일".to_string()),
            color: cal_colors.get(&category_id).cloned().unwrap_or_else(|| OTHER_COLOR.to_string()),
        })
        .collect();

    // 루틴 요약(최근 3), week는 done occurrence만
    let done_occurrences: HashSet<(String, String)> = conn
        .prepare("SELECT routine_id, occurrence_date FROM routine_occurrences WHERE done = 1")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    let week = week_ending_today(&today);
    let routines: Vec<RoutineSummary> = conn
        .prepare("SELECT id, title, end_date FROM routine_items ORDER BY seq DESC LIMIT 3")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|(id, title, end_date)| RoutineSummary {
            week: week
                .iter()
                .map(|date| done_occurrences.contains(&(id.clone(), date.clone())))
                .collect(),
            period: format_period(&end_date),
            id,
            title,
        })
        .collect();

    // 스크랩 요약(최근 3)
    let scraps: Vec<ScrapSummary> = conn
        .prepare("SELECT id, title, kind FROM scrap_items ORDER BY seq DESC LIMIT 3")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|(id, title, kind)| -> ApiResult<ScrapSummary> {
            let comment_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM scrap_comments WHERE scrap_id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok(ScrapSummary { id, title, kind: scrap_kind_label(&kind).to_string(), comment_count })
        })
        .collect::<ApiResult<Vec<_>>>()?;

    // 이번 달 지출: date가 "YYYY-MM-" 으로 시작하는 것
    let month_prefix = format!("{}-", &today[..7]);
    let expenses = conn
        .prepare("SELECT amount_won, category_id FROM ledger_expenses WHERE date LIKE ?1")?
        .query_map([format!("{month_prefix}%")], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let total: i64 = expenses.iter().map(|(amount, _)| amount).sum();
    let categories: Vec<ExpenseCategory> = conn
        .prepare("SELECT id, name, color FROM ledger_categories ORDER BY order_index ASC")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter_map(|(id, name, color)| {
            let amount: i64 =
                expenses.iter().filter(|(_, cid)| *cid == id).map(|(a, _)| a).sum();
            (amount > 0).then_some(ExpenseCategory { name, amount, color })
        })
        .collect();

    let recent_captures = conn
        .prepare(
            "SELECT id, raw, module, confidence FROM dashboard_captures ORDER BY seq DESC LIMIT 3",
        )?
        .query_map([], |row| {
            Ok(RecentCapture {
                id: row.get(0)?,
                raw: row.get(1)?,
                module: row.get(2)?,
                confidence: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(DashboardSnapshot {
        date_label: korean_date_label(&today),
        pending_capture_count,
        recent_captures,
        tasks,
        events,
        monthly_expense: MonthlyExpense { total, categories },
        routines,
        scraps,
    })
}

// ---------- 라우트 (apps/api/src/routes/dashboard.ts — capture는 프록시로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/dashboard/snapshot", get(snapshot_handler))
        .route("/dashboard/tasks/{id}/toggle", post(toggle_handler))
        .with_state(db)
}

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<DashboardSnapshot>> {
    Ok(Json(get_snapshot(&db.lock().unwrap())?))
}

async fn toggle_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    todo::toggle_complete(&db.lock().unwrap(), &id)?;
    Ok(Json(json!({ "ok": true })))
}

// ---------- 테스트 (apps/api/src/repositories/dashboard-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::db;
    use rusqlite::params;

    fn today() -> String {
        chrono::Local::now().date_naive().to_string()
    }

    fn today_weekday() -> i64 {
        chrono::Local::now().date_naive().weekday().num_days_from_sunday() as i64
    }

    fn add_todo_label(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO todo_labels (id, name, color, order_index) \
             VALUES (?1, '라벨', 'oklch(0.5 0.1 100)', 0)",
            [id],
        )
        .unwrap();
    }

    fn add_todo_item(conn: &Connection, title: &str, label_id: &str) {
        conn.execute(
            "INSERT INTO todo_items (id, seq, title, label_id, note, done) \
             VALUES (?1, (SELECT COALESCE(MAX(seq),0)+1 FROM todo_items), ?2, ?3, '', 0)",
            params![uuid::Uuid::new_v4().to_string(), title, label_id],
        )
        .unwrap();
    }

    fn add_routine(conn: &Connection, title: &str, label_id: &str, days: &[i64]) {
        conn.execute(
            "INSERT INTO routine_items (id, seq, title, label_id, days_json, start_date, end_date) \
             VALUES (?1, (SELECT COALESCE(MAX(seq),0)+1 FROM routine_items), ?2, ?3, ?4, '2000-01-01', NULL)",
            params![
                uuid::Uuid::new_v4().to_string(),
                title,
                label_id,
                serde_json::to_string(days).unwrap()
            ],
        )
        .unwrap();
    }

    #[test]
    fn empty_state_is_valid_snapshot() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let snap = get_snapshot(&conn).unwrap();
        assert_eq!(snap.pending_capture_count, 0);
        assert!(snap.tasks.is_empty());
        assert_eq!(snap.monthly_expense.total, 0);
        assert!(snap.monthly_expense.categories.is_empty());
        assert!(snap.date_label.contains("년"));
    }

    #[test]
    fn tasks_merge_routine_first_then_todo() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "l1");
        add_todo_item(&conn, "할 일", "l1");
        add_routine(&conn, "루틴", "l1", &[today_weekday()]);

        let snap = get_snapshot(&conn).unwrap();
        assert_eq!(snap.tasks.len(), 2);
        assert!(snap.tasks[0].is_routine);
        assert!(!snap.tasks[1].is_routine);
        assert_eq!(snap.tasks[0].label, "라벨");
    }

    #[test]
    fn monthly_expense_derived_from_ledger() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO ledger_categories (id, name, color, order_index) \
             VALUES ('food', '식비', 'oklch(0.6 0.1 30)', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ledger_expenses (id, seq, title, amount_won, date, category_id, note) \
             VALUES ('e1', 1, '점심', 12000, ?1, 'food', '')",
            [format!("{}-01", &today()[..7])],
        )
        .unwrap();

        let snap = get_snapshot(&conn).unwrap();
        assert_eq!(snap.monthly_expense.total, 12_000);
        assert_eq!(snap.monthly_expense.categories[0].name, "식비");
        assert_eq!(snap.monthly_expense.categories[0].amount, 12_000);
    }

    #[test]
    fn toggle_task_handles_routine_and_todo_and_missing() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "l1");
        add_todo_item(&conn, "할 일", "l1");
        add_routine(&conn, "루틴", "l1", &[today_weekday()]);

        let todo_id: String = conn
            .query_row("SELECT id FROM todo_items LIMIT 1", [], |r| r.get(0))
            .unwrap();
        todo::toggle_complete(&conn, &todo_id).unwrap();
        let done: i64 = conn
            .query_row("SELECT done FROM todo_items WHERE id = ?1", [&todo_id], |r| r.get(0))
            .unwrap();
        assert_eq!(done, 1);

        let occ_id = routine::today_todo_rows(&conn).unwrap()[0].id.clone();
        todo::toggle_complete(&conn, &occ_id).unwrap();
        let done: i64 = conn
            .query_row("SELECT done FROM routine_occurrences WHERE id = ?1", [&occ_id], |r| r.get(0))
            .unwrap();
        assert_eq!(done, 1);

        assert!(todo::toggle_complete(&conn, "nope").is_err());
    }

    #[test]
    fn routine_week_reflects_done_occurrences() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        add_todo_label(&conn, "l1");
        add_routine(&conn, "루틴", "l1", &[0, 1, 2, 3, 4, 5, 6]);
        conn.execute(
            "INSERT INTO routine_occurrences (id, routine_id, occurrence_date, done, completed_at) \
             VALUES ('o1', (SELECT id FROM routine_items LIMIT 1), ?1, 1, '2026-01-01T00:00:00.000Z')",
            [today()],
        )
        .unwrap();

        let snap = get_snapshot(&conn).unwrap();
        assert_eq!(snap.routines[0].week.len(), 7);
        assert!(snap.routines[0].week[6]); // today = 마지막 칸
        assert_eq!(snap.routines[0].period, "∞");
    }
}
