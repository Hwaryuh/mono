import { currentIsoDate } from "@mono/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { buildServer } from "../server.ts";
import { SqliteLedgerRepository } from "./ledger-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

async function seedCategory(repo: SqliteLedgerRepository, name = "식비", color = "#b03a55") {
  await repo.createCategory({ name, color });
  return (await repo.getSnapshot()).categories.find((category) => category.name === name)!;
}

const today = currentIsoDate();
const thisMonth = today.slice(0, 7);
const prevMonthDate = (() => {
  const [year, month] = thisMonth.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
})();

describe("SqliteLedgerRepository", () => {
  let repo: SqliteLedgerRepository;

  beforeEach(() => {
    repo = new SqliteLedgerRepository(freshDb());
  });

  it("기타 분류가 항상 존재하고 마지막 순서다", async () => {
    const snapshot = await repo.getSnapshot();
    expect(snapshot.categories.map((category) => category.id)).toEqual(["other"]);
    expect(snapshot.categories[0].name).toBe("기타");
  });

  it("지출을 저장하고 최신순으로 반환한다", async () => {
    const food = await seedCategory(repo, "식비");
    await repo.create({ title: "점심", amountWon: 12_000, date: `${thisMonth}-05`, categoryId: food.id, note: "" });
    await repo.create({ title: "저녁", amountWon: 20_000, date: `${thisMonth}-06`, categoryId: food.id, note: "" });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.expenses.map((expense) => expense.title)).toEqual(["저녁", "점심"]);
  });

  it("같은 이름 분류를 거부한다", async () => {
    await seedCategory(repo, "식비");
    await expect(repo.createCategory({ name: "식비", color: "#000000" })).rejects.toThrow("이미 있습니다");
  });

  it("기타 분류는 삭제할 수 없다", async () => {
    await expect(repo.deleteCategory("other")).rejects.toThrow("삭제할 수 없습니다");
  });

  it("분류 삭제 시 지출을 기타로 옮긴다", async () => {
    const food = await seedCategory(repo, "식비");
    await repo.create({ title: "점심", amountWon: 12_000, date: `${thisMonth}-05`, categoryId: food.id, note: "" });

    await repo.deleteCategory(food.id);
    const snapshot = await repo.getSnapshot();
    expect(snapshot.categories.map((category) => category.id)).toEqual(["other"]);
    expect(snapshot.expenses[0].categoryId).toBe("other");
  });

  it("분류 순서를 재배열해도 기타는 남는다", async () => {
    const a = await seedCategory(repo, "A");
    const b = await seedCategory(repo, "B");
    await repo.reorderCategories(["other", b.id, a.id]);
    expect((await repo.getSnapshot()).categories.map((category) => category.id)).toEqual(["other", b.id, a.id]);
  });

  it("전월 대비 지출 증감을 실제 데이터로 계산한다", async () => {
    const food = await seedCategory(repo, "식비");
    await repo.create({ title: "이번 달", amountWon: 20_000, date: `${thisMonth}-10`, categoryId: food.id, note: "" });
    await repo.create({ title: "지난 달", amountWon: 10_000, date: prevMonthDate, categoryId: food.id, note: "" });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.comparison).toEqual({ direction: "more", percentage: 100 });
  });

  it("없는 분류 삭제는 404 의미 오류를 던진다", async () => {
    await expect(repo.deleteCategory("nope")).rejects.toThrow("찾을 수 없습니다");
  });
});

describe("ledger routes", () => {
  it("HTTP로 스냅샷 조회와 지출 생성이 이어진다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: "/ledger/categories", payload: { name: "식비", color: "#b03a55" } })
      .then((res) => expect(res.statusCode).toBe(201));

    const snapshot0 = JSON.parse((await app.inject({ method: "GET", url: "/ledger/snapshot" })).body);
    const categoryId = snapshot0.categories.find((c: { name: string }) => c.name === "식비").id;

    const created = await app.inject({
      method: "POST",
      url: "/ledger/expenses",
      payload: { title: "HTTP 지출", amountWon: "16,000원", date: today, categoryId, note: "" },
    });
    expect(created.statusCode).toBe(201);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/ledger/snapshot" })).body);
    expect(snapshot.expenses[0]).toMatchObject({ title: "HTTP 지출", amountWon: 16_000 });

    const missing = await app.inject({ method: "DELETE", url: "/ledger/categories/nope" });
    expect(missing.statusCode).toBe(404);

    const forbidden = await app.inject({ method: "DELETE", url: "/ledger/categories/other" });
    expect(forbidden.statusCode).toBe(400);

    await app.close();
  });
});
