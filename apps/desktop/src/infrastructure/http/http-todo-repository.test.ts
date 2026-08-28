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

  it("GET으로 스냅샷을 받아온다", async () => {
    const snapshot = { today: "2026-08-26", labels: [], items: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot));

    const repository = createHttpTodoRepository();
    await expect(repository.getSnapshot()).resolves.toEqual(snapshot);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4174/todo/snapshot");
    expect(init).toEqual({});
  });

  it("생성 시 POST로 JSON 바디를 전송한다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, 201));

    const repository = createHttpTodoRepository();
    const input = { title: "장보기", labelId: "personal", dueDate: null, dueTime: null, note: "" };
    await repository.create(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4174/todo/items");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify(input) });
  });

  it("서버 오류 응답의 error 메시지를 Error로 던진다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "항목을 찾을 수 없습니다." }, 404));

    const repository = createHttpTodoRepository();
    await expect(repository.delete("missing")).rejects.toThrow("항목을 찾을 수 없습니다.");
  });

  it("Zod 검증 오류(422) 배열에서 첫 메시지를 뽑아 Error로 던진다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: [{ message: "제목을 입력해야 합니다." }] }, 422));

    const repository = createHttpTodoRepository();
    await expect(
      repository.create({ title: "", labelId: "personal", dueDate: null, dueTime: null, note: "" }),
    ).rejects.toThrow("제목을 입력해야 합니다.");
  });

  it("네트워크 연결 실패를 이해 가능한 Error로 감싼다", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const repository = createHttpTodoRepository();
    await expect(repository.getSnapshot()).rejects.toThrow("API 서버");
  });
});
