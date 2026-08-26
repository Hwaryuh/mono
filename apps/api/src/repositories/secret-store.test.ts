import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";
import { SqliteSecretStore } from "./secret-store.ts";

const keyPath = "test-secret.key";

function freshStore(): SqliteSecretStore {
  const db: Db = createDb(":memory:");
  return new SqliteSecretStore(db, new SecretCrypto(keyPath));
}

describe("SqliteSecretStore", () => {
  afterEach(() => {
    if (existsSync(keyPath)) rmSync(keyPath);
  });

  it("키가 없으면 hasGeminiApiKey는 false, getGeminiApiKey는 null이다", () => {
    const store = freshStore();
    expect(store.hasGeminiApiKey()).toBe(false);
    expect(store.getGeminiApiKey()).toBeNull();
  });

  it("설정한 키를 암호화해 저장하고 그대로 복호화해 돌려준다", () => {
    const store = freshStore();
    store.setGeminiApiKey("gk-test-123");
    expect(store.hasGeminiApiKey()).toBe(true);
    expect(store.getGeminiApiKey()).toBe("gk-test-123");
  });

  it("같은 키를 다시 설정하면 덮어쓴다", () => {
    const store = freshStore();
    store.setGeminiApiKey("gk-first");
    store.setGeminiApiKey("gk-second");
    expect(store.getGeminiApiKey()).toBe("gk-second");
  });

  it("빈 문자열은 거부한다", () => {
    const store = freshStore();
    expect(() => store.setGeminiApiKey("  ")).toThrow("Gemini API 키를 입력해야 합니다.");
  });

  it("삭제하면 다시 없는 상태가 된다", () => {
    const store = freshStore();
    store.setGeminiApiKey("gk-test-123");
    store.deleteGeminiApiKey();
    expect(store.hasGeminiApiKey()).toBe(false);
    expect(store.getGeminiApiKey()).toBeNull();
  });
});
