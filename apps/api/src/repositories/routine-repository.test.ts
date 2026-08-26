import { currentIsoDate } from "@mono/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { buildServer } from "../server.ts";
import { SqliteRoutineRepository } from "./routine-repository.ts";
import { SqliteTodoRepository } from "./todo-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

const today = currentIsoDate();
const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
const otherWeekday = (todayWeekday + 1) % 7;

describe("SqliteRoutineRepository", () => {
  let db: Db;
  let repo: SqliteRoutineRepository;
  let todoRepo: SqliteTodoRepository;

  beforeEach(async () => {
    db = freshDb();
    repo = new SqliteRoutineRepository(db);
    todoRepo = new SqliteTodoRepository(db);
    await todoRepo.createLabel({ name: "집안일", color: "#b03a55" });
  });

  it("오늘 요일 루틴은 오늘 occurrence를 만들고, 다른 요일 루틴은 만들지 않는다", async () => {
    const label = (await todoRepo.getSnapshot()).labels[0];
    await repo.create({ title: "오늘 루틴", labelId: label.id, days: [todayWeekday], endDate: null });
    await repo.create({ title: "비지정 루틴", labelId: label.id, days: [otherWeekday], endDate: null });

    const snapshot = await repo.getSnapshot();
    const todayRoutine = snapshot.items.find((item) => item.title === "오늘 루틴")!;
    const otherRoutine = snapshot.items.find((item) => item.title === "비지정 루틴")!;

    expect(snapshot.occurrences.some((o) => o.routineId === todayRoutine.id && o.occurrenceDate === today)).toBe(true);
    expect(snapshot.occurrences.some((o) => o.routineId === otherRoutine.id)).toBe(false);
  });

  it("occurrence 결정 키가 멱등이다 — 반복 조회로 중복 생성하지 않는다", async () => {
    const label = (await todoRepo.getSnapshot()).labels[0];
    await repo.create({ title: "루틴", labelId: label.id, days: [todayWeekday], endDate: null });
    await repo.getSnapshot();
    await repo.getSnapshot();
    const snapshot = await repo.getSnapshot();
    expect(snapshot.occurrences).toHaveLength(1);
  });

  it("오늘 완료 토글이 completedAt을 채우고 되돌린다", async () => {
    const label = (await todoRepo.getSnapshot()).labels[0];
    await repo.create({ title: "루틴", labelId: label.id, days: [todayWeekday], endDate: null });
    const routineId = (await repo.getSnapshot()).items[0].id;

    await repo.toggleToday(routineId);
    let occurrence = (await repo.getSnapshot()).occurrences[0];
    expect(occurrence.done).toBe(true);
    expect(occurrence.completedAt).not.toBeNull();

    await repo.toggleToday(routineId);
    occurrence = (await repo.getSnapshot()).occurrences[0];
    expect(occurrence.done).toBe(false);
  });

  it("오늘 실행하지 않는 루틴은 toggleToday를 거부한다", async () => {
    const label = (await todoRepo.getSnapshot()).labels[0];
    await repo.create({ title: "비지정 루틴", labelId: label.id, days: [otherWeekday], endDate: null });
    const routineId = (await repo.getSnapshot()).items[0].id;
    await expect(repo.toggleToday(routineId)).rejects.toThrow("오늘 실행하는 루틴이 아닙니다");
  });

  it("종료일 이후에는 occurrence가 생성되지 않는다", async () => {
    const label = (await todoRepo.getSnapshot()).labels[0];
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await repo.create({ title: "만료 루틴", labelId: label.id, days: [todayWeekday], endDate: yesterday });
    const snapshot = await repo.getSnapshot();
    expect(snapshot.occurrences).toHaveLength(0);
  });

  it("toggleOccurrenceById로 occurrence id 직접 토글이 되고, 대상 아니면 false다", async () => {
    const label = (await todoRepo.getSnapshot()).labels[0];
    await repo.create({ title: "루틴", labelId: label.id, days: [todayWeekday], endDate: null });
    const occurrenceId = (await repo.getSnapshot()).occurrences[0].id;

    expect(await repo.toggleOccurrenceById("nope")).toBe(false);
    expect(await repo.toggleOccurrenceById(occurrenceId)).toBe(true);
    expect((await repo.getSnapshot()).occurrences[0].done).toBe(true);
  });

  it("없는 루틴 수정은 404 의미 오류를 던진다", async () => {
    await expect(repo.update("nope", { title: "x", labelId: "x", days: [0], endDate: null })).rejects.toThrow("찾을 수 없습니다");
  });
});

describe("routine routes", () => {
  it("HTTP로 스냅샷 조회와 루틴 생성이 이어진다", async () => {
    const db = freshDb();
    const app = buildServer(db);
    await app.ready();

    await app.inject({ method: "POST", url: "/todo/labels", payload: { name: "집안일", color: "#b03a55" } });
    const labelId = JSON.parse((await app.inject({ method: "GET", url: "/todo/snapshot" })).body).labels[0].id;

    const created = await app.inject({ method: "POST", url: "/routine/items", payload: { title: "청소", labelId, days: [todayWeekday], endDate: null } });
    expect(created.statusCode).toBe(201);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/routine/snapshot" })).body);
    expect(snapshot.items[0].title).toBe("청소");
    expect(snapshot.occurrences).toHaveLength(1);

    const missing = await app.inject({ method: "POST", url: "/routine/items/nope/toggle-today" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
