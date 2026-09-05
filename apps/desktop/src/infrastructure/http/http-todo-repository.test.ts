import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpTodoRepository } from "./http-todo-repository";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createHttpTodoRepository", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches the snapshot via GET", async () => {
    const snapshot = { today: "2026-08-26", labels: [], items: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot));

    const repository = createHttpTodoRepository();
    await expect(repository.getSnapshot()).resolves.toEqual(snapshot);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4174/todo/snapshot");
    expect(init).toEqual({});
  });

  it("sends a JSON body via POST when creating", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, 201));

    const repository = createHttpTodoRepository();
    const input = { title: "장보기", labelId: "personal", dueDate: null, dueTime: null, note: "" };
    await repository.create(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4174/todo/items");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify(input) });
  });

  it("throws the server error response's error message as an Error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "항목을 찾을 수 없습니다." }, 404));

    const repository = createHttpTodoRepository();
    await expect(repository.delete("missing")).rejects.toThrow("항목을 찾을 수 없습니다.");
  });

  it("extracts the first message from a Zod validation error (422) array and throws it as an Error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: [{ message: "제목을 입력해야 합니다." }] }, 422));

    const repository = createHttpTodoRepository();
    await expect(
      repository.create({ title: "", labelId: "personal", dueDate: null, dueTime: null, note: "" }),
    ).rejects.toThrow("제목을 입력해야 합니다.");
  });

  it("wraps a network connection failure in an understandable Error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const repository = createHttpTodoRepository();
    await expect(repository.getSnapshot()).rejects.toThrow("API 서버");
  });
});
