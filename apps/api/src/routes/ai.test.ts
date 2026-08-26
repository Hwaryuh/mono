import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { AI_PROVIDER_IDS, type AiProviderId } from "../repositories/secret-store.ts";
import { buildServer } from "../server.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

describe.each(AI_PROVIDER_IDS)("ai routes(%s)", (provider: AiProviderId) => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("키를 설정·조회·삭제한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    expect(JSON.parse((await app.inject({ method: "GET", url: `/ai/keys/${provider}` })).body)).toEqual({ hasKey: false });

    const set = await app.inject({ method: "POST", url: `/ai/keys/${provider}`, payload: { apiKey: "test-key" } });
    expect(set.statusCode).toBe(201);

    expect(JSON.parse((await app.inject({ method: "GET", url: `/ai/keys/${provider}` })).body)).toEqual({ hasKey: true });

    const del = await app.inject({ method: "DELETE", url: `/ai/keys/${provider}` });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse((await app.inject({ method: "GET", url: `/ai/keys/${provider}` })).body)).toEqual({ hasKey: false });

    await app.close();
  });

  it("빈 키 설정은 400으로 거부한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "POST", url: `/ai/keys/${provider}`, payload: { apiKey: "  " } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("키 없이 test 호출하면 명확한 에러를 준다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "POST", url: `/ai/keys/${provider}/test` });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("API 키가 설정되지 않았습니다.");
    await app.close();
  });

  it("키가 있으면 test가 실제 연결 확인을 수행한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: `/ai/keys/${provider}`, payload: { apiKey: "test-key" } });
    const response = await app.inject({ method: "POST", url: `/ai/keys/${provider}/test` });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    await app.close();
  });
});

describe("ai routes", () => {
  it("알 수 없는 provider의 키 경로는 거부한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/ai/keys/claude" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("provider 기본값은 gemini고, openai로 전환·조회된다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    expect(JSON.parse((await app.inject({ method: "GET", url: "/ai/provider" })).body)).toEqual({ provider: "gemini" });

    const set = await app.inject({ method: "POST", url: "/ai/provider", payload: { provider: "openai" } });
    expect(set.statusCode).toBe(200);
    expect(JSON.parse((await app.inject({ method: "GET", url: "/ai/provider" })).body)).toEqual({ provider: "openai" });

    await app.close();
  });

  it("알 수 없는 provider는 거부한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/ai/provider", payload: { provider: "claude" } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
