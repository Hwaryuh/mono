import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 2단계 수직 슬라이스: Todo 경계만. 나머지 6경계는 이 패턴을 복제한다.
// completedAt은 ISO 타임스탬프를 저장한다. mock의 "방금" 표시 문자열은 UI 관심사다.

export const todoLabels = sqliteTable("todo_labels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  orderIndex: integer("order_index").notNull(),
});

export const todoItems = sqliteTable("todo_items", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  labelId: text("label_id").notNull(),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  note: text("note").notNull().default(""),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
  routineId: text("routine_id"),
  occurrenceDate: text("occurrence_date"),
});

// "other"(기타)는 UI·mock 전반이 공유하는 예약 id다. 삭제 불가, 대체 fallback 대상.
export const LEDGER_OTHER_CATEGORY_ID = "other";

export const ledgerCategories = sqliteTable("ledger_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  orderIndex: integer("order_index").notNull(),
});

export const ledgerExpenses = sqliteTable("ledger_expenses", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  amountWon: integer("amount_won").notNull(),
  date: text("date").notNull(),
  categoryId: text("category_id").notNull(),
  note: text("note").notNull().default(""),
});

// 루틴은 Todo 라벨(todoLabels)을 공유한다. 별도 라벨 테이블을 두지 않는다.
export const routineItems = sqliteTable("routine_items", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  labelId: text("label_id").notNull(),
  daysJson: text("days_json").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
});

// occurrence id는 `routine-occurrence:{routineId}:{date}` 결정 키로 멱등 생성한다.
export const routineOccurrences = sqliteTable("routine_occurrences", {
  id: text("id").primaryKey(),
  routineId: text("routine_id").notNull(),
  occurrenceDate: text("occurrence_date").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
});

export const calendarCategories = sqliteTable("calendar_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  orderIndex: integer("order_index").notNull(),
});

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  startTime: text("start_time"),
  endDate: text("end_date").notNull(),
  endTime: text("end_time"),
  location: text("location").notNull().default(""),
  categoryId: text("category_id").notNull(),
  note: text("note").notNull().default(""),
});

export const scrapTags = sqliteTable("scrap_tags", {
  tag: text("tag").primaryKey(),
});

export const scrapItems = sqliteTable("scrap_items", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  memo: text("memo").notNull().default(""),
  tag: text("tag").notNull(),
  savedAt: text("saved_at").notNull(),
  url: text("url"),
  mediaId: text("media_id"),
});

export const scrapComments = sqliteTable("scrap_comments", {
  id: text("id").primaryKey(),
  scrapId: text("scrap_id").notNull(),
  seq: integer("seq").notNull(),
  createdAt: text("created_at").notNull(),
  text: text("text").notNull(),
});

// fields/images/videos는 조회 쿼리 대상이 아닌 소량 구조화 payload라 JSON 컬럼에 둔다.
// ponytail: 정규화 테이블 3개 대신 JSON 텍스트. 필드별 검색·집계가 필요해지면 승격.
export const inboxItems = sqliteTable("inbox_items", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  source: text("source").notNull(),
  raw: text("raw").notNull(),
  target: text("target"),
  confidence: real("confidence").notNull().default(0),
  status: text("status").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  receivedAt: text("received_at").notNull(),
  fieldsJson: text("fields_json").notNull().default("[]"),
  imagesJson: text("images_json"),
  videosJson: text("videos_json"),
});

// AI 키 등 비밀 정보. value는 SecretCrypto로 암호화한 문자열이다(§5).
export const secrets = sqliteTable("secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// 최근 캡처 로그. 조회 시 최신 3건만 읽는다(ORDER BY seq DESC LIMIT 3).
// ponytail: 개인 규모라 오래된 행을 안 지운다. 문제되면 그때 pruning 추가.
export const dashboardCaptures = sqliteTable("dashboard_captures", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull(),
  raw: text("raw").notNull(),
  module: text("module").notNull(),
  confidence: real("confidence").notNull(),
});
