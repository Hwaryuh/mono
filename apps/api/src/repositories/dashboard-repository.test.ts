import { existsSync, rmSync } from "node:fs";
import { currentIsoDate } from "@mono/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { inboxItems } from "../db/schema.ts";
import { buildServer } from "../server.ts";
import type { CaptureAnalysisProvider } from "./capture-analysis-provider.ts";
import { SqliteDashboardRepository } from "./dashboard-repository.ts";
import { SqliteLedgerRepository } from "./ledger-repository.ts";
import { SqliteRoutineRepository } from "./routine-repository.ts";
import { SqliteTodoRepository } from "./todo-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

const today = currentIsoDate();
const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();

describe("SqliteDashboardRepository", () => {
  let db: Db;
  let repo: SqliteDashboardRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new SqliteDashboardRepository(db);
  });

  it("빈 상태에서도 유효한 스냅샷을 반환한다", async () => {
    const snapshot = await repo.getSnapshot();
    expect(snapshot.pendingCaptureCount).toBe(0);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.monthlyExpense).toEqual({ total: 0, categories: [] });
  });

  it("todo와 루틴 occurrence를 합쳐 tasks를 만들고, 루틴이 먼저 온다", async () => {
    const todoRepo = new SqliteTodoRepository(db);
    const routineRepo = new SqliteRoutineRepository(db);
    await todoRepo.createLabel({ name: "라벨", color: "#b03a55" });
    const label = (await todoRepo.getSnapshot()).labels[0];
    await todoRepo.create({ title: "할 일", labelId: label.id, dueDate: null, dueTime: null, note: "" });
    await routineRepo.create({ title: "루틴", labelId: label.id, days: [todayWeekday], endDate: null });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks[0].isRoutine).toBe(true);
    expect(snapshot.tasks[1].isRoutine).toBe(false);
  });

  it("월 지출을 ledger 원본 상태에서 파생한다", async () => {
    const ledgerRepo = new SqliteLedgerRepository(db);
    await ledgerRepo.createCategory({ name: "식비", color: "#b03a55" });
    const category = (await ledgerRepo.getSnapshot()).categories.find((c) => c.name === "식비")!;
    await ledgerRepo.create({ title: "점심", amountWon: 12_000, date: `${today.slice(0, 7)}-01`, categoryId: category.id, note: "" });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.monthlyExpense.total).toBe(12_000);
    expect(snapshot.monthlyExpense.categories[0]).toMatchObject({ name: "식비", amount: 12_000 });
  });

  it("capture가 실패 분석이면 상태 failed인 수집함 항목을 만든다", async () => {
    await repo.capture({ raw: "테스트 캡처" });
    const snapshot = await repo.getSnapshot();
    expect(snapshot.pendingCaptureCount).toBe(0); // failed는 pending·processing이 아니다
  });

  it("toggleTask가 루틴 occurrence와 일반 할 일을 모두 처리한다", async () => {
    const todoRepo = new SqliteTodoRepository(db);
    const routineRepo = new SqliteRoutineRepository(db);
    await todoRepo.createLabel({ name: "라벨", color: "#b03a55" });
    const label = (await todoRepo.getSnapshot()).labels[0];
    await todoRepo.create({ title: "할 일", labelId: label.id, dueDate: null, dueTime: null, note: "" });
    await routineRepo.create({ title: "루틴", labelId: label.id, days: [todayWeekday], endDate: null });

    const taskId = (await todoRepo.getSnapshot()).items[0].id;
    await repo.toggleTask(taskId);
    expect((await todoRepo.getSnapshot()).items[0].done).toBe(true);

    const occurrenceId = (await routineRepo.getSnapshot()).occurrences[0].id;
    await repo.toggleTask(occurrenceId);
    expect((await routineRepo.getSnapshot()).occurrences[0].done).toBe(true);

    await expect(repo.toggleTask("nope")).rejects.toThrow("찾을 수 없습니다");
  });
});

describe("capture 이미지 dataUrl 처리", () => {
  it("분석 provider에는 dataUrl을 넘기고, 영속화되는 imagesJson에는 빼고 저장한다", async () => {
    const db = freshDb();
    const seenImages: unknown[] = [];
    const provider: CaptureAnalysisProvider = {
      analyze: async ({ images }) => {
        seenImages.push(images);
        return { target: "scrap", confidence: 0.8, fields: [{ label: "제목", value: "사진" }] };
      },
    };
    const repo = new SqliteDashboardRepository(db, provider);

    await repo.capture({
      raw: "사진 캡처",
      images: [{ name: "a.png", mimeType: "image/png", size: 4, mediaId: "m1", dataUrl: "data:image/png;base64,AAAA" }],
    });

    expect(seenImages[0]).toEqual([{ name: "a.png", mimeType: "image/png", size: 4, mediaId: "m1", dataUrl: "data:image/png;base64,AAAA" }]);

    const row = db.select().from(inboxItems).all()[0];
    expect(row.imagesJson).not.toContain("dataUrl");
    expect(JSON.parse(row.imagesJson!)).toEqual([{ name: "a.png", mimeType: "image/png", size: 4, mediaId: "m1" }]);
  });
});

describe("Gemini 캡처 분류 연동(HTTP)", () => {
  afterEach(() => {
    if (existsSync("mono.secret.key")) rmSync("mono.secret.key");
    vi.unstubAllGlobals();
  });

  it("API 키가 없으면 분석 실패로 처리되어 failed 상태 수집함 항목이 된다(회귀: null provider와 동일 동작)", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: "/dashboard/capture", payload: { raw: "키 없이 캡처" } });
    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/inbox/snapshot" })).body);
    expect(snapshot.items[0].status).toBe("failed");

    await app.close();
  });

  it("API 키가 있으면 Gemini 응답으로 실제 분류 결과가 들어간다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        target: "todo",
        confidence: 0.87,
        fields: [{ label: "제목", value: "기획안 검토" }],
      }) }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const app = buildServer(freshDb());
    await app.ready();
    await app.inject({ method: "POST", url: "/ai/gemini-key", payload: { apiKey: "gk-test" } });

    await app.inject({ method: "POST", url: "/dashboard/capture", payload: { raw: "기획안 검토하기" } });
    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/inbox/snapshot" })).body);
    expect(snapshot.items[0]).toMatchObject({ status: "pending", target: "todo", confidence: 0.87 });

    await app.close();
  });
});

describe("dashboard routes", () => {
  it("HTTP로 캡처와 스냅샷 조회가 이어진다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    const captured = await app.inject({ method: "POST", url: "/dashboard/capture", payload: { raw: "HTTP 캡처" } });
    expect(captured.statusCode).toBe(201);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/dashboard/snapshot" })).body);
    expect(snapshot.dateLabel).toContain("년");

    const missing = await app.inject({ method: "POST", url: "/dashboard/tasks/nope/toggle" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  // 회귀: Fastify 기본 bodyLimit(1MB)이면 사진을 붙인 캡처가 전부 413("Request body is too large")으로
  // 떨어진다. 데스크톱 QuickCapture는 원본 13MB까지 허용하므로 서버가 그만큼 받아야 한다.
  it("사진 data URL을 실은 큰 캡처 본문을 받는다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    const base64 = "A".repeat(8 * 1024 * 1024);
    const captured = await app.inject({
      method: "POST",
      url: "/dashboard/capture",
      payload: {
        raw: "영수증",
        images: [{ name: "a.png", mimeType: "image/png", size: 6_000_000, mediaId: "m1", dataUrl: `data:image/png;base64,${base64}` }],
      },
    });
    expect(captured.statusCode).toBe(201);

    await app.close();
  });
});
