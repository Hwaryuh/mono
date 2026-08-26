import { describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";
import { SqliteSecretStore } from "./secret-store.ts";

// 키 파일 경로는 test/setup.ts가 파일마다 고유한 임시 디렉터리로 지정하고 정리한다.
function freshStore(): SqliteSecretStore {
  const db: Db = createDb(":memory:");
  return new SqliteSecretStore(db, new SecretCrypto());
}

describe("SqliteSecretStore", () => {

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

  it("OpenAI 키는 Gemini 키와 독립적으로 저장·삭제된다", () => {
    const store = freshStore();
    store.setGeminiApiKey("gk-test");
    store.setOpenaiApiKey("sk-test");

    expect(store.getGeminiApiKey()).toBe("gk-test");
    expect(store.getOpenaiApiKey()).toBe("sk-test");

    store.deleteOpenaiApiKey();
    expect(store.hasOpenaiApiKey()).toBe(false);
    expect(store.getGeminiApiKey()).toBe("gk-test");
  });

  it("OpenAI 키도 빈 문자열은 거부한다", () => {
    const store = freshStore();
    expect(() => store.setOpenaiApiKey(" ")).toThrow("OpenAI API 키를 입력해야 합니다.");
  });

  it("활성 provider는 기본 gemini이고, 설정한 값을 그대로 돌려준다", () => {
    const store = freshStore();
    expect(store.getActiveProvider()).toBe("gemini");
    store.setActiveProvider("openai");
    expect(store.getActiveProvider()).toBe("openai");
    store.setActiveProvider("gemini");
    expect(store.getActiveProvider()).toBe("gemini");
  });
});
