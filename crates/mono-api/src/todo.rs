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

// Todo labels share the same pool as routine. The shared CRUD config.
const CATS: Categories = Categories {
    table: "todo_labels",
    not_found: "라벨을 찾을 수 없습니다",
    clash: "같은 이름의 라벨이 이미 있습니다.",
    reorder_invalid: "라벨 순서 목록이 올바르지 않습니다.",
    reorder_mismatch: "라벨 순서에 현재 라벨이 정확히 한 번씩 포함되어야 합니다.",
};

// ---------- DTO (packages/contracts/src/index.ts todo* schemas) ----------

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
    // Always null until the Routine boundary hands it over.
    routine_id: Option<String>,
    occurrence_date: Option<String>,
    priority: i64,
    // Set on a subtask; points at its parent todo. One level only.
    parent_id: Option<String>,
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
    #[serde(default)]
    parent_id: Option<String>,
}

#[derive(Deserialize)]
struct SetPriorityInput {
    priority: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReparentInput {
    // null promotes back to a top-level todo; a string makes it a subtask of that todo.
    parent_id: Option<String>,
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

fn validated_note(raw: &str) -> ApiResult<String> {
    if raw.chars().count() > 4_000 {
        return Err(ApiError::validation("메모는 4000자 이하여야 합니다."));
    }
    Ok(raw.to_string())
}

// ---------- Repository logic (1:1 with apps/api/src/repositories/todo-repository.ts) ----------

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
             routine_id, occurrence_date, priority, parent_id FROM todo_items ORDER BY seq DESC",
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
                priority: row.get(11)?,
                parent_id: row.get(12)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // read-model join: prepends today's scheduled routine occurrences to the front, shaped like todo items.
    // (Same as apps/desktop mock-routine-occurrences.ts's routineTodoItems)
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
            priority: r.priority,
            parent_id: None,
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

fn item_parent(conn: &Connection, id: &str) -> ApiResult<Option<String>> {
    conn.query_row("SELECT parent_id FROM todo_items WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| ApiError::NotFound(format!("할 일을 찾을 수 없습니다: {id}")))
}

fn child_done_states(conn: &Connection, parent_id: &str) -> ApiResult<Vec<bool>> {
    Ok(conn
        .prepare("SELECT done FROM todo_items WHERE parent_id = ?1")?
        .query_map([parent_id], |row| Ok(row.get::<_, i64>(0)? != 0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

// Recomputes a parent's done/completed_at from its subtasks. No-op when it has none.
fn resync_parent(conn: &Connection, parent_id: &str) -> ApiResult<()> {
    let states = child_done_states(conn, parent_id)?;
    if states.is_empty() {
        return Ok(());
    }
    let all_done = states.iter().all(|&d| d);
    let stamp = if all_done { Some(now_iso()) } else { None };
    conn.execute(
        "UPDATE todo_items SET done = ?1, completed_at = ?2 WHERE id = ?3",
        params![all_done as i64, stamp, parent_id],
    )?;
    Ok(())
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
    // Routines use the same label pool too — moved together so no dead label_id is left behind (mock deleteLabel).
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
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM todo_items", [], |row| row.get(0))?;

    // A subtask: inherits the parent's label, carries no due date / time / note.
    if let Some(parent_id) = input.parent_id.as_deref().filter(|value| !value.is_empty()) {
        if item_parent(conn, parent_id)?.is_some() {
            return Err(ApiError::BadRequest("하위 항목 아래에는 다시 하위 항목을 만들 수 없습니다.".into()));
        }
        let label_id: String = conn
            .query_row("SELECT label_id FROM todo_items WHERE id = ?1", [parent_id], |row| row.get(0))?;
        conn.execute(
            "INSERT INTO todo_items \
             (id, seq, title, label_id, due_date, due_time, note, done, completed_at, routine_id, occurrence_date, parent_id) \
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, '', 0, NULL, NULL, NULL, ?5)",
            params![uuid::Uuid::new_v4().to_string(), next_seq + 1, title, label_id, parent_id],
        )?;
        // The new subtask is incomplete, so the parent can no longer be complete.
        conn.execute(
            "UPDATE todo_items SET done = 0, completed_at = NULL WHERE id = ?1",
            [parent_id],
        )?;
        return Ok(());
    }

    let note = validated_note(&input.note)?;
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
    // If it's a routine occurrence mixed into the todo snapshot, toggles that instead (mock toggleComplete).
    // dashboard toggleTask uses this same function directly (identical semantics).
    if super::routine::toggle_occurrence_by_id(conn, id)? {
        return Ok(());
    }
    let done_now = require_item(conn, id)?;
    let children = child_done_states(conn, id)?;

    // A parent drives every subtask (and itself) to the opposite of "all subtasks done".
    // ponytail: no explicit tx — one statement, single mutexed connection.
    if !children.is_empty() {
        let target = !children.iter().all(|&done| done);
        let stamp = if target { Some(now_iso()) } else { None };
        conn.execute(
            "UPDATE todo_items SET done = ?1, completed_at = ?2 WHERE id = ?3 OR parent_id = ?3",
            params![target as i64, stamp, id],
        )?;
        return Ok(());
    }

    let done = !done_now;
    let completed_at = if done { Some(now_iso()) } else { None };
    conn.execute(
        "UPDATE todo_items SET done = ?1, completed_at = ?2 WHERE id = ?3",
        params![done as i64, completed_at, id],
    )?;

    // Toggling a subtask rolls up into its parent (last one done ⇒ parent done).
    if let Some(parent_id) = item_parent(conn, id)? {
        resync_parent(conn, &parent_id)?;
    }
    Ok(())
}

fn set_priority(conn: &Connection, id: &str, priority: i64) -> ApiResult<()> {
    if !(0..=3).contains(&priority) {
        return Err(ApiError::validation("우선순위는 0~3 사이여야 합니다."));
    }
    // A routine occurrence mixed into the todo snapshot stores its own per-day priority.
    if super::routine::set_occurrence_priority_by_id(conn, id, priority)? {
        return Ok(());
    }
    require_item(conn, id)?;
    conn.execute("UPDATE todo_items SET priority = ?1 WHERE id = ?2", params![priority, id])?;
    Ok(())
}

// Moves an existing todo. `new_parent` = Some(id) makes it a subtask of that todo; None promotes
// it back to top level. One level only: the new parent must itself be top level, and a todo that
// has its own subtasks can't become a subtask. Becoming a subtask drops the moved todo's due
// date/time/note/priority and adopts the parent's label — subtasks don't carry those.
fn reparent(conn: &Connection, id: &str, new_parent: Option<&str>) -> ApiResult<()> {
    require_item(conn, id)?;
    let old_parent = item_parent(conn, id)?;
    let new_parent = new_parent.filter(|value| !value.is_empty());

    match new_parent {
        None => {
            if old_parent.is_none() {
                return Ok(());
            }
            conn.execute(
                "UPDATE todo_items SET parent_id = NULL, version = version + 1 WHERE id = ?1",
                [id],
            )?;
        }
        Some(parent_id) => {
            if parent_id == id {
                return Err(ApiError::BadRequest("할 일을 자기 자신의 하위로 옮길 수 없습니다.".into()));
            }
            if item_parent(conn, parent_id)?.is_some() {
                return Err(ApiError::BadRequest("하위 항목 아래에는 다시 하위 항목을 만들 수 없습니다.".into()));
            }
            if !child_done_states(conn, id)?.is_empty() {
                return Err(ApiError::BadRequest(
                    "하위 항목이 있는 할 일은 다른 할 일의 하위로 옮길 수 없습니다.".into(),
                ));
            }
            if old_parent.as_deref() == Some(parent_id) {
                return Ok(());
            }
            let label_id: String = conn
                .query_row("SELECT label_id FROM todo_items WHERE id = ?1", [parent_id], |row| row.get(0))?;
            conn.execute(
                "UPDATE todo_items SET parent_id = ?1, label_id = ?2, due_date = NULL, due_time = NULL, \
                 note = '', priority = 0, version = version + 1 WHERE id = ?3",
                params![parent_id, label_id, id],
            )?;
            resync_parent(conn, parent_id)?;
        }
    }

    if let Some(old) = old_parent {
        resync_parent(conn, &old)?;
    }
    Ok(())
}

fn delete_item(conn: &Connection, id: &str) -> ApiResult<()> {
    require_item(conn, id)?;
    let parent_id = item_parent(conn, id)?;
    // Deleting a parent takes its subtasks with it.
    conn.execute("DELETE FROM todo_items WHERE id = ?1 OR parent_id = ?1", [id])?;
    // Deleting a subtask can complete the parent (its last incomplete child is gone).
    if let Some(parent_id) = parent_id {
        resync_parent(conn, &parent_id)?;
    }
    Ok(())
}

// ---------- Routes (matches apps/api/src/routes/todo.ts paths exactly) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/todo/snapshot", get(snapshot_handler))
        .route("/todo/items", post(create_item_handler))
        .route(
            "/todo/items/{id}",
            put(update_item_handler).delete(delete_item_handler),
        )
        .route("/todo/items/{id}/toggle", post(toggle_handler))
        .route("/todo/items/{id}/priority", put(set_priority_handler))
        .route("/todo/items/{id}/parent", put(reparent_handler))
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

async fn reparent_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<ReparentInput>,
) -> ApiResult<Json<Value>> {
    reparent(&db.conn(), &id, input.parent_id.as_deref())?;
    Ok(ok())
}

async fn set_priority_handler(
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(input): Json<SetPriorityInput>,
) -> ApiResult<Json<Value>> {
    set_priority(&db.conn(), &id, input.priority)?;
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

// ---------- Tests (ported from apps/api/src/repositories/todo-repository.test.ts) ----------

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
            parent_id: None,
        }
    }

    fn subtask_input(title: &str, parent_id: &str) -> TodoWriteInput {
        TodoWriteInput {
            title: title.into(),
            label_id: String::new(),
            due_date: None,
            due_time: None,
            note: String::new(),
            parent_id: Some(parent_id.into()),
        }
    }

    fn find_item<'a>(snapshot: &'a TodoSnapshot, title: &str) -> &'a TodoItem {
        snapshot.items.iter().find(|i| i.title == title).expect("item present")
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
                parent_id: None,
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
    fn set_priority_updates_and_validates_range() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("할 일", &label)).unwrap();
        let id = get_snapshot(&conn).unwrap().items[0].id.clone();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 0);

        set_priority(&conn, &id, 3).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 3);

        set_priority(&conn, &id, 0).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 0);

        let err = set_priority(&conn, &id, 4).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
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

    #[test]
    fn routine_occurrence_priority_is_per_day_and_set_via_todo_id() {
        use chrono::Datelike;
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let today_weekday = kst_now().date_naive().weekday().num_days_from_sunday();
        conn.execute(
            "INSERT INTO routine_items (id, seq, title, label_id, days_json, start_date, end_date) \
             VALUES ('r1', 1, '스트레칭', 'health', ?1, '2000-01-01', NULL)",
            params![format!("[{today_weekday}]")],
        )
        .unwrap();

        let id = get_snapshot(&conn).unwrap().items[0].id.clone();
        assert!(id.starts_with("routine-occurrence:r1:"));
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 0);

        // Setting priority materializes today's occurrence and sticks.
        set_priority(&conn, &id, 3).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 3);

        // A different day's occurrence keeps its own rating.
        let other_day = "2000-01-02";
        conn.execute(
            "INSERT INTO routine_occurrences (id, routine_id, occurrence_date, done, priority) \
             VALUES (?1, 'r1', ?2, 0, 1)",
            params![format!("routine-occurrence:r1:{other_day}"), other_day],
        )
        .unwrap();
        set_priority(&conn, &id, 2).unwrap();
        let other: i64 = conn
            .query_row(
                "SELECT priority FROM routine_occurrences WHERE occurrence_date = ?1",
                [other_day],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(other, 1);
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 2);

        set_priority(&conn, &id, 0).unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().items[0].priority, 0);

        let err = set_priority(&conn, &id, 4).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
    }

    #[test]
    fn subtask_inherits_parent_label_and_rejects_deeper_nesting() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "집안일");
        create_item(&conn, item_input("이사 준비", &label)).unwrap();
        let parent = find_item(&get_snapshot(&conn).unwrap(), "이사 준비").id.clone();

        create_item(&conn, subtask_input("관리비 정산", &parent)).unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        let child = find_item(&snapshot, "관리비 정산");
        assert_eq!(child.parent_id.as_deref(), Some(parent.as_str()));
        assert_eq!(child.label_id, label);
        assert!(child.due_date.is_none());

        let err = create_item(&conn, subtask_input("더 깊게", &child.id.clone())).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("다시 하위 항목")));
    }

    #[test]
    fn parent_completion_rolls_up_from_subtasks_both_ways() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("분기 보고서", &label)).unwrap();
        let parent = find_item(&get_snapshot(&conn).unwrap(), "분기 보고서").id.clone();
        create_item(&conn, subtask_input("지표 취합", &parent)).unwrap();
        create_item(&conn, subtask_input("초안 작성", &parent)).unwrap();

        let a = find_item(&get_snapshot(&conn).unwrap(), "지표 취합").id.clone();
        let b = find_item(&get_snapshot(&conn).unwrap(), "초안 작성").id.clone();

        // Checking every subtask completes the parent.
        toggle_complete(&conn, &a).unwrap();
        assert!(!find_item(&get_snapshot(&conn).unwrap(), "분기 보고서").done);
        toggle_complete(&conn, &b).unwrap();
        let done = get_snapshot(&conn).unwrap();
        let parent_item = find_item(&done, "분기 보고서");
        assert!(parent_item.done && parent_item.completed_at.is_some());

        // Un-checking one re-opens the parent.
        toggle_complete(&conn, &b).unwrap();
        assert!(!find_item(&get_snapshot(&conn).unwrap(), "분기 보고서").done);

        // Toggling the parent drives every subtask.
        toggle_complete(&conn, &parent).unwrap();
        let all = get_snapshot(&conn).unwrap();
        assert!(all.items.iter().filter(|i| i.parent_id.is_some()).all(|i| i.done));
        assert!(find_item(&all, "분기 보고서").done);
    }

    #[test]
    fn deleting_a_parent_cascades_to_subtasks() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "집안일");
        create_item(&conn, item_input("이사 준비", &label)).unwrap();
        let parent = find_item(&get_snapshot(&conn).unwrap(), "이사 준비").id.clone();
        create_item(&conn, subtask_input("인터넷 이전", &parent)).unwrap();
        create_item(&conn, subtask_input("우편물 주소 이전", &parent)).unwrap();

        delete_item(&conn, &parent).unwrap();
        assert!(get_snapshot(&conn).unwrap().items.is_empty());
    }

    #[test]
    fn deleting_the_last_open_subtask_completes_the_parent() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("배포", &label)).unwrap();
        let parent = find_item(&get_snapshot(&conn).unwrap(), "배포").id.clone();
        create_item(&conn, subtask_input("체크리스트 확인", &parent)).unwrap();
        create_item(&conn, subtask_input("롤백 계획", &parent)).unwrap();
        let checked = find_item(&get_snapshot(&conn).unwrap(), "체크리스트 확인").id.clone();
        let open = find_item(&get_snapshot(&conn).unwrap(), "롤백 계획").id.clone();
        toggle_complete(&conn, &checked).unwrap();

        delete_item(&conn, &open).unwrap();
        assert!(find_item(&get_snapshot(&conn).unwrap(), "배포").done);
    }

    #[test]
    fn reparent_makes_a_top_level_todo_a_subtask_and_strips_its_own_fields() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let home = seed_label(&conn, "집안일");
        let work = seed_label(&conn, "업무");
        create_item(&conn, item_input("이사 준비", &home)).unwrap();
        create_item(
            &conn,
            TodoWriteInput {
                title: "관리비 정산".into(),
                label_id: work.clone(),
                due_date: Some("2026-09-20".into()),
                due_time: Some("10:00".into()),
                note: "고지서 확인".into(),
                parent_id: None,
            },
        )
        .unwrap();
        let parent = find_item(&get_snapshot(&conn).unwrap(), "이사 준비").id.clone();
        let moved = find_item(&get_snapshot(&conn).unwrap(), "관리비 정산").id.clone();
        set_priority(&conn, &moved, 3).unwrap();

        reparent(&conn, &moved, Some(&parent)).unwrap();

        let snapshot = get_snapshot(&conn).unwrap();
        let child = find_item(&snapshot, "관리비 정산");
        assert_eq!(child.parent_id.as_deref(), Some(parent.as_str()));
        assert_eq!(child.label_id, home);
        assert!(child.due_date.is_none() && child.due_time.is_none());
        assert_eq!(child.note, "");
        assert_eq!(child.priority, 0);
        // The parent had no subtasks before and was complete-by-default(false); adding an open child keeps it open.
        assert!(!find_item(&snapshot, "이사 준비").done);
    }

    #[test]
    fn reparent_promotes_a_subtask_back_to_top_level() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("분기 보고서", &label)).unwrap();
        let parent = find_item(&get_snapshot(&conn).unwrap(), "분기 보고서").id.clone();
        create_item(&conn, subtask_input("지표 취합", &parent)).unwrap();
        create_item(&conn, subtask_input("초안 작성", &parent)).unwrap();
        let a = find_item(&get_snapshot(&conn).unwrap(), "지표 취합").id.clone();
        let b = find_item(&get_snapshot(&conn).unwrap(), "초안 작성").id.clone();
        toggle_complete(&conn, &b).unwrap();

        reparent(&conn, &a, None).unwrap();

        let snapshot = get_snapshot(&conn).unwrap();
        assert!(find_item(&snapshot, "지표 취합").parent_id.is_none());
        // "초안 작성" is now the parent's only subtask and it's done → parent rolls up to done.
        assert!(find_item(&snapshot, "분기 보고서").done);
    }

    #[test]
    fn reparent_rejects_nesting_under_a_subtask_or_moving_a_parent() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let label = seed_label(&conn, "업무");
        create_item(&conn, item_input("A", &label)).unwrap();
        create_item(&conn, item_input("B", &label)).unwrap();
        let a = find_item(&get_snapshot(&conn).unwrap(), "A").id.clone();
        let b = find_item(&get_snapshot(&conn).unwrap(), "B").id.clone();
        create_item(&conn, subtask_input("A-1", &a)).unwrap();
        let a1 = find_item(&get_snapshot(&conn).unwrap(), "A-1").id.clone();

        // Can't drop B under a subtask.
        let under_subtask = reparent(&conn, &b, Some(&a1)).unwrap_err();
        assert!(matches!(under_subtask, ApiError::BadRequest(m) if m.contains("다시 하위 항목")));

        // Can't move A (which has a subtask) under B.
        let has_children = reparent(&conn, &a, Some(&b)).unwrap_err();
        assert!(matches!(has_children, ApiError::BadRequest(m) if m.contains("하위 항목이 있는")));

        // Can't drop onto itself.
        let onto_self = reparent(&conn, &b, Some(&b)).unwrap_err();
        assert!(matches!(onto_self, ApiError::BadRequest(m) if m.contains("자기 자신")));
    }
}
