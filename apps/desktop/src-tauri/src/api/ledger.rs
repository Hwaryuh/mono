use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::color::normalize_color_to_oklch;
use super::db::Db;
use super::error::{ApiError, ApiResult};

// apps/api/src/db/schema.ts LEDGER_OTHER_CATEGORY_ID
const OTHER_CATEGORY_ID: &str = "other";

// ---------- DTO (packages/contracts/src/index.ts ledger* 스키마) ----------

#[derive(Serialize)]
struct LedgerCategory {
    id: String,
    name: String,
    color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LedgerExpense {
    id: String,
    title: String,
    amount_won: i64,
    date: String,
    category_id: String,
    note: String,
}

#[derive(Serialize)]
struct LedgerComparison {
    direction: String,
    percentage: i64,
}

#[derive(Serialize)]
struct LedgerSnapshot {
    today: String,
    categories: Vec<LedgerCategory>,
    expenses: Vec<LedgerExpense>,
    comparison: LedgerComparison,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LedgerWriteInput {
    pub(super) title: String,
    pub(super) amount_won: Value,
    pub(super) date: String,
    pub(super) category_id: String,
    #[serde(default)]
    pub(super) note: String,
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

// ---------- 검증 ----------

fn validated_title(raw: &str) -> ApiResult<String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(ApiError::validation("항목을 입력해야 합니다."));
    }
    if title.chars().count() > 500 {
        return Err(ApiError::validation("항목은 500자 이하여야 합니다."));
    }
    Ok(title.to_string())
}

fn validated_note(raw: &str) -> ApiResult<String> {
    if raw.chars().count() > 4_000 {
        return Err(ApiError::validation("메모는 4000자 이하여야 합니다."));
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

// packages/contracts/src/index.ts wonAmountSchema: 숫자면 그대로, 문자열이면 ₩·원·쉼표·공백 제거 후
// 숫자만이면 파싱. 이후 양의 정수여야 하고 안전 정수 범위(<= 2^53-1).
fn validated_amount(value: &Value) -> ApiResult<i64> {
    let amount = match value {
        Value::Number(number) => number
            .as_i64()
            .filter(|_| number.is_i64() || number.as_f64().is_some_and(|f| f.fract() == 0.0))
            .ok_or_else(|| ApiError::validation("금액은 원 단위 정수여야 합니다."))?,
        Value::String(text) => {
            let normalized: String = text
                .chars()
                .filter(|c| !matches!(c, '₩' | '원' | ',' | ' ' | '\t' | '\n' | '\r'))
                .collect();
            if normalized.is_empty() || !normalized.chars().all(|c| c.is_ascii_digit()) {
                return Err(ApiError::validation("금액은 숫자로 입력해야 합니다."));
            }
            normalized
                .parse::<i64>()
                .map_err(|_| ApiError::validation("금액이 허용 범위를 벗어났습니다."))?
        }
        _ => return Err(ApiError::validation("금액은 숫자로 입력해야 합니다.")),
    };
    if amount <= 0 {
        return Err(ApiError::validation("금액은 1원 이상이어야 합니다."));
    }
    if amount > 9_007_199_254_740_991 {
        return Err(ApiError::validation("금액이 허용 범위를 벗어났습니다."));
    }
    Ok(amount)
}

// packages/contracts/src/index.ts isoDateSchema: YYYY-MM-DD 형식 + 실재하는 날짜.
fn validated_date(raw: &str) -> ApiResult<String> {
    let parts: Vec<&str> = raw.split('-').collect();
    let looks_iso = parts.len() == 3
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()));
    if !looks_iso {
        return Err(ApiError::validation("날짜는 YYYY-MM-DD 형식이어야 합니다."));
    }
    chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| ApiError::validation("유효한 날짜를 입력해야 합니다."))?;
    Ok(raw.to_string())
}

// ---------- 저장소 로직 (apps/api/src/repositories/ledger-repository.ts 1:1) ----------

fn today_iso() -> String {
    chrono::Local::now().date_naive().to_string()
}

fn previous_month(month: &str) -> String {
    // "2026-08" -> "2026-07", "2026-01" -> "2025-12"
    let mut parts = month.split('-');
    let year: i32 = parts.next().and_then(|y| y.parse().ok()).unwrap_or(0);
    let m: i32 = parts.next().and_then(|m| m.parse().ok()).unwrap_or(1);
    let (py, pm) = if m <= 1 { (year - 1, 12) } else { (year, m - 1) };
    format!("{py:04}-{pm:02}")
}

fn compare_to_previous(current: i64, previous: i64) -> LedgerComparison {
    if previous == 0 {
        return LedgerComparison {
            direction: if current == 0 { "same" } else { "more" }.into(),
            percentage: if current == 0 { 0 } else { 100 },
        };
    }
    if current == previous {
        return LedgerComparison { direction: "same".into(), percentage: 0 };
    }
    let percentage =
        (((current - previous).abs() as f64 / previous as f64) * 100.0).round() as i64;
    LedgerComparison {
        direction: if current < previous { "less" } else { "more" }.into(),
        percentage,
    }
}

fn get_snapshot(conn: &Connection) -> ApiResult<LedgerSnapshot> {
    let today = today_iso();
    let month = today[..7].to_string();

    let categories = conn
        .prepare("SELECT id, name, color FROM ledger_categories ORDER BY order_index ASC")?
        .query_map([], |row| {
            Ok(LedgerCategory { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let expenses = conn
        .prepare(
            "SELECT id, title, amount_won, date, category_id, note FROM ledger_expenses ORDER BY seq DESC",
        )?
        .query_map([], |row| {
            Ok(LedgerExpense {
                id: row.get(0)?,
                title: row.get(1)?,
                amount_won: row.get(2)?,
                date: row.get(3)?,
                category_id: row.get(4)?,
                note: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let current_prefix = format!("{month}-");
    let prev_prefix = format!("{}-", previous_month(&month));
    let current_total: i64 = expenses
        .iter()
        .filter(|e| e.date.starts_with(&current_prefix))
        .map(|e| e.amount_won)
        .sum();
    let prev_total: i64 = expenses
        .iter()
        .filter(|e| e.date.starts_with(&prev_prefix))
        .map(|e| e.amount_won)
        .sum();

    Ok(LedgerSnapshot {
        today,
        categories,
        expenses,
        comparison: compare_to_previous(current_total, prev_total),
    })
}

fn category_exists(conn: &Connection, id: &str) -> ApiResult<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM ledger_categories WHERE id = ?1", [id], |_| Ok(()))
        .is_ok())
}

fn require_category(conn: &Connection, id: &str) -> ApiResult<()> {
    if category_exists(conn, id)? {
        Ok(())
    } else {
        Err(ApiError::NotFound(format!("가계부 라벨을 찾을 수 없습니다: {id}")))
    }
}

fn assert_unique_name(conn: &Connection, name: &str, except_id: Option<&str>) -> ApiResult<()> {
    let target = name.to_lowercase();
    let clash = conn
        .prepare("SELECT id, name FROM ledger_categories")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .any(|(id, existing)| Some(id.as_str()) != except_id && existing.to_lowercase() == target);
    if clash {
        return Err(ApiError::BadRequest("같은 이름의 분류가 이미 있습니다.".into()));
    }
    Ok(())
}

pub(super) fn create_expense(conn: &Connection, input: LedgerWriteInput) -> ApiResult<()> {
    let title = validated_title(&input.title)?;
    let amount = validated_amount(&input.amount_won)?;
    let date = validated_date(&input.date)?;
    if input.category_id.is_empty() {
        return Err(ApiError::validation("라벨을 선택해야 합니다."));
    }
    let note = validated_note(&input.note)?;
    let next_seq: i64 =
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM ledger_expenses", [], |row| row.get(0))?;
    conn.execute(
        "INSERT INTO ledger_expenses (id, seq, title, amount_won, date, category_id, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            uuid::Uuid::new_v4().to_string(),
            next_seq + 1,
            title,
            amount,
            date,
            input.category_id,
            note,
        ],
    )?;
    Ok(())
}

fn create_category(conn: &Connection, input: CategoryWriteInput) -> ApiResult<()> {
    let name = validated_category_name(&input.name)?;
    let color = validated_color(&input.color)?;
    assert_unique_name(conn, &name, None)?;
    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) FROM ledger_categories WHERE id != ?1",
        [OTHER_CATEGORY_ID],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO ledger_categories (id, name, color, order_index) VALUES (?1, ?2, ?3, ?4)",
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
        "UPDATE ledger_categories SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )?;
    Ok(())
}

fn reorder_categories(conn: &mut Connection, ids: Vec<String>) -> ApiResult<()> {
    if ids.is_empty() || ids.iter().any(|id| id.is_empty()) {
        return Err(ApiError::validation("분류 순서 목록이 올바르지 않습니다."));
    }
    let current: Vec<String> = conn
        .prepare("SELECT id FROM ledger_categories")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let unique: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    if ids.len() != current.len()
        || unique.len() != current.len()
        || current.iter().any(|id| !unique.contains(id.as_str()))
    {
        return Err(ApiError::BadRequest(
            "분류 순서에 현재 분류가 모두 포함되어야 합니다.".into(),
        ));
    }
    let tx = conn.transaction()?;
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE ledger_categories SET order_index = ?1 WHERE id = ?2",
            params![index as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn delete_category(conn: &mut Connection, id: &str) -> ApiResult<()> {
    require_category(conn, id)?;
    if id == OTHER_CATEGORY_ID {
        return Err(ApiError::BadRequest("기타 분류는 삭제할 수 없습니다.".into()));
    }
    if !category_exists(conn, OTHER_CATEGORY_ID)? {
        return Err(ApiError::NotFound("기타 분류를 찾을 수 없습니다.".into()));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE ledger_expenses SET category_id = ?1 WHERE category_id = ?2",
        params![OTHER_CATEGORY_ID, id],
    )?;
    tx.execute("DELETE FROM ledger_categories WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

// ---------- 라우트 (apps/api/src/routes/ledger.ts 경로 그대로) ----------

pub fn routes(db: Db) -> Router {
    Router::new()
        .route("/ledger/snapshot", get(snapshot_handler))
        .route("/ledger/expenses", post(create_expense_handler))
        .route("/ledger/categories", post(create_category_handler))
        .route("/ledger/categories/order", put(reorder_handler))
        .route(
            "/ledger/categories/{id}",
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

async fn snapshot_handler(State(db): State<Db>) -> ApiResult<Json<LedgerSnapshot>> {
    Ok(Json(get_snapshot(&db.lock().unwrap())?))
}

async fn create_expense_handler(
    State(db): State<Db>,
    Json(input): Json<LedgerWriteInput>,
) -> ApiResult<(axum::http::StatusCode, Json<Value>)> {
    create_expense(&db.lock().unwrap(), input)?;
    Ok(created())
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
) -> ApiResult<Json<Value>> {
    delete_category(&mut db.lock().unwrap(), &id)?;
    Ok(ok())
}

// ---------- 테스트 (apps/api/src/repositories/ledger-repository.test.ts 이식) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::db;

    fn category_input(name: &str) -> CategoryWriteInput {
        CategoryWriteInput { name: name.into(), color: "#b03a55".into() }
    }

    fn expense_input(title: &str, amount: i64, date: &str, category_id: &str) -> LedgerWriteInput {
        LedgerWriteInput {
            title: title.into(),
            amount_won: json!(amount),
            date: date.into(),
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

    fn this_month() -> String {
        today_iso()[..7].to_string()
    }

    #[test]
    fn other_category_always_present_and_last() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(
            snapshot.categories.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["other"]
        );
        assert_eq!(snapshot.categories[0].name, "기타");
    }

    #[test]
    fn stores_expenses_newest_first() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let food = seed_category(&conn, "식비");
        let month = this_month();
        create_expense(&conn, expense_input("점심", 12_000, &format!("{month}-05"), &food)).unwrap();
        create_expense(&conn, expense_input("저녁", 20_000, &format!("{month}-06"), &food)).unwrap();
        let titles: Vec<String> =
            get_snapshot(&conn).unwrap().expenses.into_iter().map(|e| e.title).collect();
        assert_eq!(titles, ["저녁", "점심"]);
    }

    #[test]
    fn rejects_duplicate_category_name() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        seed_category(&conn, "식비");
        let err = create_category(&conn, category_input("식비")).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("이미 있습니다")));
    }

    #[test]
    fn other_category_cannot_be_deleted() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let err = delete_category(&mut conn, "other").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(m) if m.contains("삭제할 수 없습니다")));
    }

    #[test]
    fn delete_category_moves_expenses_to_other() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let food = seed_category(&conn, "식비");
        let month = this_month();
        create_expense(&conn, expense_input("점심", 12_000, &format!("{month}-05"), &food)).unwrap();

        delete_category(&mut conn, &food).unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(
            snapshot.categories.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["other"]
        );
        assert_eq!(snapshot.expenses[0].category_id, "other");
    }

    #[test]
    fn reorder_keeps_other() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let a = seed_category(&conn, "A");
        let b = seed_category(&conn, "B");
        reorder_categories(&mut conn, vec!["other".into(), b.clone(), a.clone()]).unwrap();
        let ids: Vec<String> =
            get_snapshot(&conn).unwrap().categories.into_iter().map(|c| c.id).collect();
        assert_eq!(ids, vec!["other".to_string(), b, a]);
    }

    #[test]
    fn computes_month_over_month_from_real_data() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let food = seed_category(&conn, "식비");
        let month = this_month();
        let prev = previous_month(&month);
        create_expense(&conn, expense_input("이번 달", 20_000, &format!("{month}-10"), &food)).unwrap();
        create_expense(&conn, expense_input("지난 달", 10_000, &format!("{prev}-15"), &food)).unwrap();
        let comparison = get_snapshot(&conn).unwrap().comparison;
        assert_eq!(comparison.direction, "more");
        assert_eq!(comparison.percentage, 100);
    }

    #[test]
    fn missing_category_delete_is_not_found() {
        let db = db::open_memory();
        let mut conn = db.lock().unwrap();
        let err = delete_category(&mut conn, "nope").unwrap_err();
        assert!(matches!(err, ApiError::NotFound(m) if m.contains("찾을 수 없습니다")));
    }

    #[test]
    fn parses_won_amount_from_string() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let food = seed_category(&conn, "식비");
        let today = today_iso();
        create_expense(
            &conn,
            LedgerWriteInput {
                title: "HTTP 지출".into(),
                amount_won: json!("16,000원"),
                date: today,
                category_id: food,
                note: String::new(),
            },
        )
        .unwrap();
        assert_eq!(get_snapshot(&conn).unwrap().expenses[0].amount_won, 16_000);
    }

    #[test]
    fn rejects_invalid_date() {
        let db = db::open_memory();
        let conn = db.lock().unwrap();
        let food = seed_category(&conn, "식비");
        let err = create_expense(&conn, expense_input("x", 1_000, "2026-02-30", &food)).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
    }
}
