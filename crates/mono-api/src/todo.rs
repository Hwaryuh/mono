use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::category::{self, Categories};
use super::common::*;
use super::db::{Db, DbExt};
use super::error::{ApiError, ApiResult};
use super::version::{ensure_versioned_update, expected_version};

// todo 라벨은 routine 과 같은 풀을 공유한다. 공통 CRUD 설정.
const CATS: Categories = Categories {
    table: "todo_labels",
    not_found: "라벨을 찾을 수 없습니다",
    clash: "같은 이름의 라벨이 이미 있습니다.",
    reorder_invalid: "라벨 순서 목록이 올바르지 않습니다.",
    reorder_mismatch: "라벨 순서에 현재 라벨이 정확히 한 번씩 포함되어야 합니다.",
};

// ---------- DTO (packages/contracts/src/index.ts todo* 스키마) ----------

#[derive(Serialize)]
struct TodoLabel {
    id: String,
    version: i64,
    name: String,
    color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoItem {
    id: String,
    version: i64,
    title: String,
    label_id: String,
    due_date: Option<String>,
    due_time: Option<String>,
    note: String,
    done: bool,
    completed_at: Option<String>,
    // Routine 경계가 넘어오기 전까지 항상 null.
    routine_id: Option<String>,
    occurrence_date: Option<String>,
}

#[derive(Serialize)]
struct TodoSnapshot {
    today: String,
    labels: Vec<TodoLabel>,
    items: Vec<TodoItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoWriteInput {
    title: String,
    label_id: String,
    due_date: Option<String>,
    due_time: Option<String>,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct TodoLabelWriteInput {
    name: String,
    color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelOrderInput {
    label_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteLabelInput {
    replacement_label_id: String,
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

fn validated_note(raw: &str) -> ApiResult<String> {
    if raw.chars().count() > 4_000 {
        return Err(ApiError::validation("메모는 4000자 이하여야 합니다."));
    }
    Ok(raw.to_string())
}

// ---------- 저장소 로직 (apps/api/src/repositories/todo-repository.ts 1:1) ----------

fn get_snapshot(conn: &Connection) -> ApiResult<TodoSnapshot> {
    let labels = conn
        .prepare("SELECT id, version, name, color FROM todo_labels ORDER BY order_index ASC")?
        .query_map([], |row| {
            Ok(TodoLabel { id: row.get(0)?, version: row.get(1)?, name: row.get(2)?, color: row.get(3)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let own_items = conn
        .prepare(
            "SELECT id, version, title, label_id, due_date, due_time, note, done, completed_at, \
             routine_id, occurrence_date FROM todo_items ORDER BY seq DESC",
        )?
        .query_map([], |row| {
            Ok(TodoItem {
                id: row.get(0)?,
                version: row.get(1)?,
                title: row.get(2)?,
                label_id: row.get(3)?,
                due_date: row.get(4)?,
                due_time: row.get(5)?,
                note: row.get(6)?,
                done: row.get::<_, i64>(7)? != 0,
                completed_at: row.get(8)?,
                routine_id: row.get(9)?,
                occurrence_date: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // read-model join: 오늘 스케줄된 루틴 occurrence를 todo item처럼 맨 앞에 붙인다.
    // (apps/desktop mock-routine-occurrences.ts routineTodoItems 와 동일)
    let mut items: Vec<TodoItem> = super::routine::today_todo_rows(conn)?
        .into_iter()
        .map(|r| TodoItem {
            id: r.id,
            version: 1,
            title: r.title,
            label_id: r.label_id,
            due_date: Some(r.occurrence_date.clone()),
            due_time: None,
            note: String::new(),
            done: r.done,
            completed_at: r.completed_at,
            routine_id: Some(r.routine_id),
            occurrence_date: Some(r.occurrence_date),
        })
        .collect();
    items.extend(own_items);

    Ok(TodoSnapshot { today: today_iso(), labels, items })
}

fn require_item(conn: &Connection, id: &str) -> ApiResult<bool> {
    conn.query_row("SELECT done FROM todo_items WHERE id = ?1", [id], |row| {
        Ok(row.get::<_, i64>(0)? != 0)
    })
    .map_err(|_| ApiError::NotFound(format!("할 일을 찾을 수 없습니다: {id}")))
}

fn create_label(conn: &Connection, input: TodoLabelWriteInput) -> ApiResult<()> {
    CATS.insert(conn, &input.name, &input.color)
}

fn update_label(conn: &Connection, id: &str, input: TodoLabelWriteInput, expected: Option<i64>) -> ApiResult<()> {
    CATS.update(conn, id, &input.name, &input.color, expected)
}

fn reorder_labels(conn: &mut Connection, ids: Vec<String>) -> ApiResult<()> {
    CATS.reorder(conn, ids)
}

fn delete_label(conn: &mut Connection, id: &str, replacement: &str) -> ApiResult<()> {
    CATS.require(conn, id)?;
    if id == category::RESERVED_ID {
        return Err(ApiError::BadRequest("기타 라벨은 삭제할 수 없습니다.".into()));
    }
    CATS.require(conn, replacement)?;
    if id == replacement {
        return Err(ApiError::BadRequest("삭제할 라벨과 이동할 라벨은 달라야 합니다.".into()));
    }
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM todo_labels", [], |row| row.get(0))?;
    if count == 1 {
        return Err(ApiError::BadRequest("마지막 라벨은 삭제할 수 없습니다.".into()));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE todo_items SET label_id = ?1, version = version + 1 WHERE label_id = ?2",
        params![replacement, id],
    )?;
    // 루틴도 같은 라벨 풀을 쓴다 — 죽은 label_id가 남지 않도록 함께 옮긴다 (mock deleteLabel).
    tx.execute(
        "UPDATE routine_items SET label_id = ?1, version = version + 1 WHERE label_id = ?2",
        params![replacement, id],
    )?;
    tx.execute("DELETE FROM todo_labels WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

fn create_item(conn: &Connection, input: TodoWriteInput) -> ApiResult<()> {
    let title = validated_title(&input.title)?;
    let note = validated_note(&input.note)?;
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM todo_items", [], |row| row.get(0))?;
    conn.execute(
        "INSERT INTO todo_items \
         (id, seq, title, label_id, due_date, due_time, note, done, completed_at, routine_id, occurrence_date) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, NULL, NULL, NULL)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            title,
            input.label_id,
            input.due_date,
            input.due_time,
            note,
        ],
    )?;
    Ok(())
}

fn update_item(conn: &Connection, id: &str, input: TodoWriteInput, expected: Option<i64>) -> ApiResult<()> {
    require_item(conn, id)?;
    let title = validated_title(&input.title)?;
    let note = validated_note(&input.note)?;
    let changed = conn.execute(
        "UPDATE todo_items SET title = ?1, label_id = ?2, due_date = ?3, due_time = ?4, \
         note = ?5, version = version + 1 WHERE id = ?6 AND (?7 IS NULL OR version = ?7)",
        params![title, input.label_id, input.due_date, input.due_time, note, id, expected],
    )?;
    ensure_versioned_update(changed, expected)
}

pub(super) fn toggle_complete(conn: &Connection, id: &str) -> ApiResult<()> {
    // todo 스냅샷에 섞여 나온 루틴 occurrence면 그쪽을 토글한다 (mock toggleComplete).
    // dashboard toggleTask도 이 함수를 그대로 쓴다 (동일 시맨틱).
    if super::routine::toggle_occurrence_by_id(conn, id)? {
        return Ok(());
    }
    let done_now = require_item(conn, id)?;
    let done = !done_now;
    let completed_at = if done { Some(now_iso()) } else { None };
    conn.execute(
        "UPDATE todo_items SET done = ?1, completed_at = ?2 WHERE id = ?3",
        params![done as i64, completed_at, id],
    )?;
    Ok(())
}

fn delete_item(conn: &Connection, id: &str) -> ApiResult<()> {
    require_item(conn, id)?;
    conn.execute("DELETE FROM todo_items WHERE id = ?1", [id])?;
    Ok(())
}

// ---------- 라우트 (apps/api/src/routes/todo.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/todo/snapshot", get(snapshot_handler))
        .route("/todo/items", post(create_item_handler))
        .route(
            "/todo/items/{id}",
            put(update_item_handler).delete(delete_item_handler),
        )
        .route("/todo/items/{id}/toggle", post(toggle_handler))
        .route("/todo/labels", post(create_label_handler))
        .route("/todo/labels/order", put(reorder_handler))
        .route(
            "/todo/labels/{id}",
            put(update_label_handler).delete(delete_label_handler),
        )
        .with_state(db)
}

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<TodoSnapshot>> {
    let conn = db.conn();
    Ok(Json(get_snapshot(&conn)?))
}

async fn create_item_handler(
    State(db): State<Db>,
    Json(input): Json<TodoWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_item(&db.conn(), input)?;
    Ok(created())
}

async fn update_item_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<TodoWriteInput>,
) -> ApiResult<Json<Value>> {
    update_item(&db.conn(), &id, input, expected_version(&headers)?)?;
    Ok(ok())
}

async fn toggle_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    toggle_complete(&db.conn(), &id)?;
    Ok(ok())
}

async fn delete_item_handler(State(db): State<Db>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    delete_item(&db.conn(), &id)?;
    Ok(ok())
}

async fn create_label_handler(
    State(db): State<Db>,
    Json(input): Json<TodoLabelWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_label(&db.conn(), input)?;
    Ok(created())
}

async fn update_label_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<TodoLabelWriteInput>,
) -> ApiResult<Json<Value>> {
    update_label(&db.conn(), &id, input, expected_version(&headers)?)?;
    Ok(ok())
}

async fn reorder_handler(
    State(db): State<Db>,
    Json(input): Json<LabelOrderInput>,
) -> ApiResult<Json<Value>> {
    reorder_labels(&mut db.conn(), input.label_ids)?;
    Ok(ok())
}

async fn delete_label_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<DeleteLabelInput>,
) -> ApiResult<Json<Value>> {
    delete_label(&mut db.conn(), &id, &input.replacement_label_id)?;
    Ok(ok())
}

// ---------- 테스트 (apps/api/src/repositories/todo-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn label_input(name: &str, color: &str) -> TodoLabelWriteInput {
        TodoLabelWriteInput { name: name.into(), color: color.into() }
    }

    fn item_input(title: &str, label_id: &str) -> TodoWriteInput {
        TodoWriteInput {
            title: title.into(),
            label_id: label_id.into(),
            due_date: None,
            due_time: None,
            note: String::new(),
        }
    }

    fn seed_label(conn: &Connection, name: &str) -> String {
        create_label(conn, label_input(name, "#b03a55")).unwrap();
        get_snapshot(conn)
            .unwrap()
            .labels
            .into_iter()
            .find(|l| l.name == name)
            .unwrap()
            .id
    }

    #[test]
    fn other_label_always_present_and_last() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(snapshot.labels.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), ["other"]);
        assert_eq!(snapshot.labels[0].name, "기타");
    }

    #[test]
    fn new_label_goes_before_other() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_label(&conn, "업무");
        let names: Vec<String> =
            get_snapshot(&conn).unwrap().labels.into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["업무", "기타"]);
    }

    #[test]
    fn other_label_cannot_be_deleted() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let err = delete_label(&mut conn, "other", "other").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("기타 라벨은 삭제할 수 없습니다")));
    }

    #[test]
    fn stores_items_newest_first() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("첫째", &label)).unwrap();
        create_item(
            &conn,
            TodoWriteInput {
                title: "둘째".into(),
                label_id: label.clone(),
                due_date: Some("2026-08-26".into()),
                due_time: None,
                note: "메모".into(),
            },
        )
        .unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(
            snapshot.items.iter().map(|i| i.title.as_str()).collect::<Vec<_>>(),
            ["둘째", "첫째"]
        );
        assert_eq!(snapshot.labels.len(), 2);
        assert!(!snapshot.items[0].done);
    }

    #[test]
    fn rejects_duplicate_label_name() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_label(&conn, "업무");
        let err = create_label(&conn, label_input("업무", "#000000")).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("이미 있습니다")));
    }

    #[test]
    fn toggle_sets_and_clears_completed_at() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("할 일", &label)).unwrap();
        let id = get_snapshot(&conn).unwrap().items[0].id.clone();

        toggle_complete(&conn, &id).unwrap();
        let item = get_snapshot(&conn).unwrap().items.remove(0);
        assert!(item.done);
        assert!(item.completed_at.is_some());

        toggle_complete(&conn, &id).unwrap();
        let item = get_snapshot(&conn).unwrap().items.remove(0);
        assert!(!item.done);
        assert!(item.completed_at.is_none());
    }

    #[test]
    fn delete_label_moves_items_to_replacement() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let a = seed_label(&conn, "A");
        let b = seed_label(&conn, "B");
        create_item(&conn, item_input("이동 대상", &a)).unwrap();

        delete_label(&mut conn, &a, &b).unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(
            snapshot.labels.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(),
            ["B", "기타"]
        );
        assert_eq!(snapshot.items[0].label_id, b);

        let err = delete_label(&mut conn, &b, &b).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("달라야")));
    }

    #[test]
    fn reorder_keeps_other() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let a = seed_label(&conn, "A");
        let b = seed_label(&conn, "B");
        reorder_labels(&mut conn, vec!["other".into(), b.clone(), a.clone()]).unwrap();
        let names: Vec<String> =
            get_snapshot(&conn).unwrap().labels.into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["기타", "B", "A"]);
    }

    #[test]
    fn missing_item_toggle_is_not_found() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let err = toggle_complete(&conn, "nope").unwrap_err();
        assert!(matches!(err, ApiError::NotFound(m) if m.contains("찾을 수 없습니다")));
    }

    #[test]
    fn empty_title_is_validation_error() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        let err = create_item(&conn, item_input("   ", &label)).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
    }

    #[test]
    fn routine_occurrence_shows_in_todo_snapshot_and_toggles_via_todo_id() {
        use chrono::Datelike;
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let today_weekday = kst_now().date_naive().weekday().num_days_from_sunday();
        conn.execute(
            "INSERT INTO routine_items (id, seq, title, label_id, days_json, start_date, end_date) \
             VALUES ('r1', 1, '물 마시기', 'health', ?1, '2000-01-01', NULL)",
            params![format!("[{today_weekday}]")],
        )
        .unwrap();

        let snapshot = get_snapshot(&conn).unwrap();
        let routine_item = snapshot.items.iter().find(|i| i.routine_id.is_some()).unwrap();
        assert_eq!(routine_item.title, "물 마시기");
        assert!(routine_item.id.starts_with("routine-occurrence:r1:"));
        assert!(!routine_item.done);

        toggle_complete(&conn, &routine_item.id.clone()).unwrap();
        let after = get_snapshot(&conn).unwrap();
        assert!(after.items.iter().find(|i| i.routine_id.is_some()).unwrap().done);
    }
}
