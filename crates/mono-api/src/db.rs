use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

// 단일 사용자 로컬 앱: 커넥션 하나를 Mutex로 감싼다.
// ponytail: 풀 대신 전역 락. 처리량이 문제되면 r2d2_sqlite로 승격.
pub type Db = Arc<Mutex<Connection>>;

pub trait DbExt {
    /// 커넥션 가드. poison된 락도 복구한다 — 한 핸들러의 panic이 이후 모든 요청을
    /// 벽돌로 만들지 않도록(`.lock().unwrap()`이면 poison 후 전부 panic).
    fn conn(&self) -> MutexGuard<'_, Connection>;
}

impl DbExt for Db {
    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// apps/api/src/db/client.ts 의 DDL 을 그대로 옮긴다(idempotent — 매 실행 안전).
const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS todo_labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS todo_items (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  label_id TEXT NOT NULL,
  due_date TEXT,
  due_time TEXT,
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  routine_id TEXT,
  occurrence_date TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ledger_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ledger_expenses (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount_won INTEGER NOT NULL,
  date TEXT NOT NULL,
  category_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS routine_items (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  label_id TEXT NOT NULL,
  days_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS routine_occurrences (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS calendar_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  start_time TEXT,
  end_date TEXT NOT NULL,
  end_time TEXT,
  location TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);
-- 반복 규칙. calendar_events의 마스터 행이 여기 항목을 가지면 반복 시리즈다.
CREATE TABLE IF NOT EXISTS calendar_recurrences (
  event_id TEXT PRIMARY KEY,
  freq TEXT NOT NULL,
  interval_n INTEGER NOT NULL DEFAULT 1,
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  until_date TEXT,
  count_n INTEGER
);
-- 시리즈의 단일 occurrence 예외. kind='cancelled'면 그 날짜를 건너뛰고,
-- kind='modified'면 아래 override 컬럼 값으로 대체한다. occurrence_date는 원래 슬롯 날짜.
CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
  id TEXT PRIMARY KEY,
  master_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  start_date TEXT,
  start_time TEXT,
  end_date TEXT,
  end_time TEXT,
  location TEXT,
  category_id TEXT,
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_exceptions_key
  ON calendar_event_exceptions (master_id, occurrence_date);
CREATE TABLE IF NOT EXISTS scrap_tags (
  tag TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS scrap_items (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  url TEXT,
  media_id TEXT
);
CREATE TABLE IF NOT EXISTS scrap_comments (
  id TEXT PRIMARY KEY,
  scrap_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  text TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  file_media_id TEXT,
  file_name TEXT,
  file_size INTEGER
);
CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  source TEXT NOT NULL,
  raw TEXT NOT NULL,
  target TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  images_json TEXT,
  videos_json TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboard_captures (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  raw TEXT NOT NULL,
  module TEXT NOT NULL,
  confidence REAL NOT NULL
);
"#;

// 모든 모듈에 "기타"를 예약 항목으로 항상 존재시킨다(mock-platform-state와 동일).
const SEED: &str = r#"
INSERT OR IGNORE INTO ledger_categories (id, name, color, order_index)
VALUES ('other', '기타', 'oklch(0.645 0.009 106.643)', 999999);
INSERT OR IGNORE INTO todo_labels (id, name, color, order_index)
VALUES ('other', '기타', 'oklch(0.645 0.009 106.643)', 999999);
INSERT OR IGNORE INTO calendar_categories (id, name, color, order_index)
VALUES ('other', '기타', 'oklch(0.645 0.009 106.643)', 999999);
INSERT OR IGNORE INTO scrap_tags (tag) VALUES ('기타');
"#;

// 편집 충돌 방지용 낙관적 버전 컬럼을 갖는 테이블. 기존 DB에는 시작 시 누락 컬럼을 추가한다.
const VERSIONED_TABLES: [&str; 8] = [
    "todo_labels",
    "todo_items",
    "ledger_categories",
    "routine_items",
    "calendar_categories",
    "calendar_events",
    "scrap_comments",
    "inbox_items",
];

fn migrate_version_columns(conn: &Connection) -> rusqlite::Result<()> {
    for table in VERSIONED_TABLES {
        let mut columns = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let has_version = columns
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .iter()
            .any(|column| column == "version");
        if !has_version {
            // table 이름은 위의 고정 상수에서만 오므로 SQL 식별자 주입 경로가 없다.
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
            ))?;
        }
    }
    Ok(())
}

// 이미 존재하는 DB에 빠진 컬럼을 채운다. 컬럼 이름·선언은 고정 상수라 식별자 주입 경로 없음.
fn migrate_add_columns(conn: &Connection, table: &str, columns: &[(&str, &str)]) -> rusqlite::Result<()> {
    let existing = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (name, decl) in columns {
        if !existing.iter().any(|column| column == name) {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {decl}"))?;
        }
    }
    Ok(())
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(DDL)?;
    migrate_version_columns(conn)?;
    migrate_add_columns(
        conn,
        "scrap_comments",
        &[("file_media_id", "TEXT"), ("file_name", "TEXT"), ("file_size", "INTEGER")],
    )?;
    conn.execute_batch(SEED)?;
    Ok(())
}

pub fn open(path: &Path) -> rusqlite::Result<Db> {
    let conn = Connection::open(path)?;
    init(&conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

#[cfg(test)]
pub fn open_memory() -> Db {
    let conn = Connection::open_in_memory().expect("in-memory sqlite");
    init(&conn).expect("init schema");
    Arc::new(Mutex::new(conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_version_to_existing_tables_without_losing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        for table in VERSIONED_TABLES {
            conn.execute_batch(&format!(
                "CREATE TABLE {table} (id TEXT PRIMARY KEY); INSERT INTO {table} (id) VALUES ('kept');"
            ))
            .unwrap();
        }

        migrate_version_columns(&conn).unwrap();

        for table in VERSIONED_TABLES {
            let version: i64 = conn
                .query_row(&format!("SELECT version FROM {table} WHERE id = 'kept'"), [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, 1);
        }
    }
}
