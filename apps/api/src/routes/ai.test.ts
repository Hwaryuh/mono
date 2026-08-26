import { existsSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { buildServer } from "../server.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

describe("ai routes", () => {
  afterEach(() => {
    if (existsSync("mono.secret.key")) rmSync("mono.secret.key");
    vi.unstubAllGlobals();
  });

  it("키를 설정·조회·삭제한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    expect(JSON.parse((await app.inject({ method: "GET", url: "/ai/gemini-key" })).body)).toEqual({ hasKey: false });

    const set = await app.inject({ method: "POST", url: "/ai/gemini-key", payload: { apiKey: "gk-test" } });
    expect(set.statusCode).toBe(201);

    expect(JSON.parse((await app.inject({ method: "GET", url: "/ai/gemini-key" })).body)).toEqual({ hasKey: true });

    const del = await app.inject({ method: "DELETE", url: "/ai/gemini-key" });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse((await app.inject({ method: "GET", url: "/ai/gemini-key" })).body)).toEqual({ hasKey: false });

    await app.close();
  });

  it("빈 키 설정은 422/400으로 거부한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/ai/gemini-key", payload: { apiKey: "  " } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("키 없이 test 호출하면 명확한 에러를 준다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/ai/gemini-key/test" });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Gemini API 키가 설정되지 않았습니다.");
    await app.close();
  });

  it("키가 있으면 test가 실제 연결 확인을 수행한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: "/ai/gemini-key", payload: { apiKey: "gk-test" } });
    const response = await app.inject({ method: "POST", url: "/ai/gemini-key/test" });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    await app.close();
  });
});
