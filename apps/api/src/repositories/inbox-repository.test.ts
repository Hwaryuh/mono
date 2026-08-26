import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { inboxItems } from "../db/schema.ts";
import { buildServer } from "../server.ts";
import { SqliteInboxRepository } from "./inbox-repository.ts";
import { SqliteLedgerRepository } from "./ledger-repository.ts";
import { SqliteTodoRepository } from "./todo-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

function seedInboxRow(db: Db, overrides: Partial<typeof inboxItems.$inferInsert> = {}) {
  const row = {
    id: overrides.id ?? "inbox-1",
    seq: 1,
    source: "text",
    raw: "오늘 저녁 장보기",
    target: "todo",
    confidence: 0.8,
    status: "pending",
    pinned: false,
    receivedAt: new Date().toISOString(),
    fieldsJson: JSON.stringify([{ label: "제목", value: "장보기" }, { label: "라벨", value: "집안일" }]),
    imagesJson: null,
    videosJson: null,
    ...overrides,
  };
  db.insert(inboxItems).values(row).run();
  return row;
}

describe("SqliteInboxRepository", () => {
  let db: Db;
  let repo: SqliteInboxRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new SqliteInboxRepository(db);
  });

  it("todo 대상 승인이 라벨 이름으로 매칭돼 할 일을 만든다", async () => {
    const todoRepo = new SqliteTodoRepository(db);
    await todoRepo.createLabel({ name: "집안일", color: "#b03a55" });
    seedInboxRow(db);

    await repo.approve("inbox-1");

    const todoSnapshot = await todoRepo.getSnapshot();
    expect(todoSnapshot.items[0].title).toBe("장보기");
    expect((await repo.getSnapshot()).items[0].status).toBe("approved");
  });

  it("매칭 라벨이 없으면 work 라벨로, work도 없으면 첫 라벨로 대체한다", async () => {
    const todoRepo = new SqliteTodoRepository(db);
    await todoRepo.createLabel({ name: "기타라벨", color: "#000000" });
    seedInboxRow(db, { fieldsJson: JSON.stringify([{ label: "제목", value: "항목" }, { label: "라벨", value: "존재안함" }]) });

    await repo.approve("inbox-1");
    const todoSnapshot = await todoRepo.getSnapshot();
    expect(todoSnapshot.items[0].labelId).toBe((await todoRepo.getSnapshot()).labels[0].id);
  });

  it("라벨이 하나도 없으면 명확한 오류를 던진다", async () => {
    seedInboxRow(db);
    await expect(repo.approve("inbox-1")).rejects.toThrow("라벨이 없어");
  });

  it("ledger 대상 승인은 원화 정규화를 거쳐 지출을 만든다", async () => {
    const ledgerRepo = new SqliteLedgerRepository(db);
    seedInboxRow(db, {
      target: "ledger",
      fieldsJson: JSON.stringify([{ label: "항목", value: "점심" }, { label: "금액", value: "16,000원" }]),
    });

    await repo.approve("inbox-1");
    const snapshot = await ledgerRepo.getSnapshot();
    expect(snapshot.expenses[0]).toMatchObject({ title: "점심", amountWon: 16_000, categoryId: "other" });
  });

  it("두 번 승인해도 멱등하다", async () => {
    const todoRepo = new SqliteTodoRepository(db);
    await todoRepo.createLabel({ name: "집안일", color: "#b03a55" });
    seedInboxRow(db);

    await repo.approve("inbox-1");
    await repo.approve("inbox-1");
    expect((await todoRepo.getSnapshot()).items).toHaveLength(1);
  });

  it("영상 항목은 target을 scrap 외로 바꿀 수 없다", async () => {
    seedInboxRow(db, { id: "inbox-2", source: "video", target: "scrap" });
    await expect(repo.update("inbox-2", { target: "todo", fields: [{ label: "제목", value: "x" }] })).rejects.toThrow("영상은 스크랩");
  });

  it("고확신도 일괄 승인이 기준 이상만 처리한다", async () => {
    const todoRepo = new SqliteTodoRepository(db);
    await todoRepo.createLabel({ name: "집안일", color: "#b03a55" });
    seedInboxRow(db, { id: "inbox-low", confidence: 0.3 });
    seedInboxRow(db, { id: "inbox-high", confidence: 0.95 });

    await repo.approveHighConfidence(0.9);
    const snapshot = await repo.getSnapshot();
    expect(snapshot.items.find((i) => i.id === "inbox-high")!.status).toBe("approved");
    expect(snapshot.items.find((i) => i.id === "inbox-low")!.status).toBe("pending");
  });

  it("버리기는 항목을 지우고, 없는 항목은 404 의미 오류를 던진다", async () => {
    seedInboxRow(db);
    await repo.discard("inbox-1");
    expect((await repo.getSnapshot()).items).toHaveLength(0);
    await expect(repo.discard("inbox-1")).rejects.toThrow("찾을 수 없습니다");
  });
});

describe("inbox routes", () => {
  it("HTTP로 승인 흐름이 이어진다", async () => {
    const db = freshDb();
    const app = buildServer(db);
    await app.ready();

    await app.inject({ method: "POST", url: "/todo/labels", payload: { name: "집안일", color: "#b03a55" } });
    seedInboxRow(db);

    const approved = await app.inject({ method: "POST", url: "/inbox/items/inbox-1/approve" });
    expect(approved.statusCode).toBe(200);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/inbox/snapshot" })).body);
    expect(snapshot.items[0].status).toBe("approved");

    const missing = await app.inject({ method: "DELETE", url: "/inbox/items/nope" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
