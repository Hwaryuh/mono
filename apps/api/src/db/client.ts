import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

// ponytail: Drizzle 마이그레이션 CLI 대신 idempotent DDL 한 번. 스키마 안정되면 drizzle-kit으로 승격.
const DDL = `
CREATE TABLE IF NOT EXISTS todo_labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INTEGER NOT NULL
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
  occurrence_date TEXT
);
CREATE TABLE IF NOT EXISTS ledger_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INTEGER NOT NULL
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
  end_date TEXT
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
  order_index INTEGER NOT NULL
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
  note TEXT NOT NULL DEFAULT ''
);
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
  text TEXT NOT NULL
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
  videos_json TEXT
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
`;

// mock-platform-state와 동일하게 모든 모듈에 "기타"를 예약 항목으로 항상 존재시킨다.
// OR IGNORE라 매 createDb() 호출마다 실행돼도 안전하고, 기존 DB에도 다음 실행 시 자동 채워진다.
const SEED = `
INSERT OR IGNORE INTO ledger_categories (id, name, color, order_index)
VALUES ('other', '기타', 'oklch(0.645 0.009 106.643)', 999999);
INSERT OR IGNORE INTO todo_labels (id, name, color, order_index)
VALUES ('other', '기타', 'oklch(0.645 0.009 106.643)', 999999);
INSERT OR IGNORE INTO calendar_categories (id, name, color, order_index)
VALUES ('other', '기타', 'oklch(0.645 0.009 106.643)', 999999);
INSERT OR IGNORE INTO scrap_tags (tag) VALUES ('기타');
`;

export type Db = ReturnType<typeof drizzle>;

export function createDb(path = process.env.MONO_DB_PATH ?? "mono.sqlite") {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  sqlite.exec(SEED);
  return drizzle(sqlite);
}
