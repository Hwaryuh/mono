import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { buildServer } from "../server.ts";
import { SqliteCalendarRepository } from "./calendar-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

async function seedCategory(repo: SqliteCalendarRepository, name = "취미", color = "#b03a55") {
  await repo.createCategory({ name, color });
  return (await repo.getSnapshot()).categories.find((category) => category.name === name)!;
}

describe("SqliteCalendarRepository", () => {
  let repo: SqliteCalendarRepository;

  beforeEach(() => {
    repo = new SqliteCalendarRepository(freshDb());
  });

  it("일정을 생성하고 최신순으로 반환한다", async () => {
    const category = await seedCategory(repo);
    await repo.create({ title: "첫 일정", startDate: "2026-08-26", startTime: null, endDate: "2026-08-26", endTime: null, location: "", categoryId: category.id, note: "" });
    await repo.create({ title: "둘째 일정", startDate: "2026-08-27", startTime: "10:00", endDate: "2026-08-27", endTime: "11:00", location: "카페", categoryId: category.id, note: "" });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.events.map((event) => event.title)).toEqual(["둘째 일정", "첫 일정"]);
  });

  it("같은 이름 분류를 거부한다", async () => {
    await seedCategory(repo, "취미");
    await expect(repo.createCategory({ name: "취미", color: "#000000" })).rejects.toThrow("이미 있습니다");
  });

  it("분류 삭제 시 일정을 대체 분류로 옮기고 마지막 분류는 지킨다", async () => {
    const a = await seedCategory(repo, "A");
    const b = await seedCategory(repo, "B");
    await repo.create({ title: "일정", startDate: "2026-08-26", startTime: null, endDate: "2026-08-26", endTime: null, location: "", categoryId: a.id, note: "" });

    await repo.deleteCategory(a.id, b.id);
    const snapshot = await repo.getSnapshot();
    expect(snapshot.categories.map((c) => c.name)).toEqual(["B"]);
    expect(snapshot.events[0].categoryId).toBe(b.id);

    await expect(repo.deleteCategory(b.id, b.id)).rejects.toThrow("달라야");
  });

  it("일정 수정과 없는 일정 404를 확인한다", async () => {
    const category = await seedCategory(repo);
    await repo.create({ title: "원본", startDate: "2026-08-26", startTime: null, endDate: "2026-08-26", endTime: null, location: "", categoryId: category.id, note: "" });
    const id = (await repo.getSnapshot()).events[0].id;
    await repo.update(id, { title: "수정됨", startDate: "2026-08-26", startTime: null, endDate: "2026-08-26", endTime: null, location: "", categoryId: category.id, note: "" });
    expect((await repo.getSnapshot()).events[0].title).toBe("수정됨");

    await expect(repo.update("nope", { title: "x", startDate: "2026-08-26", startTime: null, endDate: "2026-08-26", endTime: null, location: "", categoryId: category.id, note: "" })).rejects.toThrow("찾을 수 없습니다");
  });
});

describe("calendar routes", () => {
  it("HTTP로 스냅샷 조회와 일정 생성이 이어진다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: "/calendar/categories", payload: { name: "취미", color: "#b03a55" } });
    const categoryId = JSON.parse((await app.inject({ method: "GET", url: "/calendar/snapshot" })).body).categories[0].id;

    const created = await app.inject({
      method: "POST",
      url: "/calendar/events",
      payload: { title: "HTTP 일정", startDate: "2026-08-26", startTime: null, endDate: "2026-08-26", endTime: null, location: "", categoryId, note: "" },
    });
    expect(created.statusCode).toBe(201);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/calendar/snapshot" })).body);
    expect(snapshot.events[0].title).toBe("HTTP 일정");

    await app.close();
  });
});
