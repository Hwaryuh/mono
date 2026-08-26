import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { buildServer } from "../server.ts";
import { SqliteTodoRepository } from "./todo-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

async function seedLabel(repo: SqliteTodoRepository, name = "업무", color = "#b03a55") {
  await repo.createLabel({ name, color });
  return (await repo.getSnapshot()).labels.find((label) => label.name === name)!;
}

describe("SqliteTodoRepository", () => {
  let repo: SqliteTodoRepository;

  beforeEach(() => {
    repo = new SqliteTodoRepository(freshDb());
  });

  it("라벨과 항목을 저장하고 스냅샷을 최신순으로 반환한다", async () => {
    const label = await seedLabel(repo);
    await repo.create({ title: "첫째", labelId: label.id, dueDate: null, dueTime: null, note: "" });
    await repo.create({ title: "둘째", labelId: label.id, dueDate: "2026-08-26", dueTime: null, note: "메모" });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.items.map((item) => item.title)).toEqual(["둘째", "첫째"]);
    expect(snapshot.labels).toHaveLength(1);
    expect(snapshot.items[0].done).toBe(false);
  });

  it("같은 이름 라벨을 거부한다", async () => {
    await seedLabel(repo, "업무");
    await expect(repo.createLabel({ name: "업무", color: "#000000" })).rejects.toThrow("이미 있습니다");
  });

  it("완료 토글이 completedAt을 채우고 되돌린다", async () => {
    const label = await seedLabel(repo);
    await repo.create({ title: "할 일", labelId: label.id, dueDate: null, dueTime: null, note: "" });
    const id = (await repo.getSnapshot()).items[0].id;

    await repo.toggleComplete(id);
    let item = (await repo.getSnapshot()).items[0];
    expect(item.done).toBe(true);
    expect(item.completedAt).not.toBeNull();

    await repo.toggleComplete(id);
    item = (await repo.getSnapshot()).items[0];
    expect(item.done).toBe(false);
    expect(item.completedAt).toBeNull();
  });

  it("라벨 삭제 시 항목을 대체 라벨로 옮긴다", async () => {
    const a = await seedLabel(repo, "A");
    const b = await seedLabel(repo, "B");
    await repo.create({ title: "이동 대상", labelId: a.id, dueDate: null, dueTime: null, note: "" });

    await repo.deleteLabel(a.id, b.id);
    const snapshot = await repo.getSnapshot();
    expect(snapshot.labels.map((label) => label.name)).toEqual(["B"]);
    expect(snapshot.items[0].labelId).toBe(b.id);

    // 삭제 대상과 대체 라벨이 같으면 거부한다.
    await expect(repo.deleteLabel(b.id, b.id)).rejects.toThrow("달라야");
  });

  it("라벨 순서를 재배열한다", async () => {
    const a = await seedLabel(repo, "A");
    const b = await seedLabel(repo, "B");
    await repo.reorderLabels([b.id, a.id]);
    expect((await repo.getSnapshot()).labels.map((label) => label.name)).toEqual(["B", "A"]);
  });

  it("없는 항목 수정은 404 의미 오류를 던진다", async () => {
    await expect(repo.toggleComplete("nope")).rejects.toThrow("찾을 수 없습니다");
  });
});

describe("todo routes", () => {
  it("HTTP로 스냅샷 조회와 항목 생성이 이어진다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: "/todo/labels", payload: { name: "업무", color: "#b03a55" } })
      .then((res) => expect(res.statusCode).toBe(201));

    const labelId = JSON.parse((await app.inject({ method: "GET", url: "/todo/snapshot" })).body).labels[0].id;

    const created = await app.inject({ method: "POST", url: "/todo/items", payload: { title: "HTTP 할 일", labelId, dueDate: null, dueTime: null, note: "" } });
    expect(created.statusCode).toBe(201);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/todo/snapshot" })).body);
    expect(snapshot.items[0].title).toBe("HTTP 할 일");

    const missing = await app.inject({ method: "POST", url: "/todo/items/nope/toggle" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
