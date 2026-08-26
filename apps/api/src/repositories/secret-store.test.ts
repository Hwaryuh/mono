import { describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";
import { AI_PROVIDER_IDS, type AiProviderId, SqliteSecretStore } from "./secret-store.ts";

// 키 파일 경로는 test/setup.ts가 파일마다 고유한 임시 디렉터리로 지정하고 정리한다.
function freshStore(): SqliteSecretStore {
  const db: Db = createDb(":memory:");
  return new SqliteSecretStore(db, new SecretCrypto());
}

describe.each(AI_PROVIDER_IDS)("SqliteSecretStore(%s)", (provider: AiProviderId) => {
  it("키가 없으면 hasApiKey는 false, getApiKey는 null이다", () => {
    const store = freshStore();
    expect(store.hasApiKey(provider)).toBe(false);
    expect(store.getApiKey(provider)).toBeNull();
  });

  it("설정한 키를 암호화해 저장하고 그대로 복호화해 돌려준다", () => {
    const store = freshStore();
    store.setApiKey(provider, "test-key-123");
    expect(store.hasApiKey(provider)).toBe(true);
    expect(store.getApiKey(provider)).toBe("test-key-123");
  });

  it("같은 키를 다시 설정하면 덮어쓴다", () => {
    const store = freshStore();
    store.setApiKey(provider, "first");
    store.setApiKey(provider, "second");
    expect(store.getApiKey(provider)).toBe("second");
  });

  it("빈 문자열은 거부한다", () => {
    const store = freshStore();
    expect(() => store.setApiKey(provider, "  ")).toThrow("API 키를 입력해야 합니다.");
  });

  it("삭제하면 다시 없는 상태가 된다", () => {
    const store = freshStore();
    store.setApiKey(provider, "test-key-123");
    store.deleteApiKey(provider);
    expect(store.hasApiKey(provider)).toBe(false);
    expect(store.getApiKey(provider)).toBeNull();
  });
});

describe("SqliteSecretStore", () => {
  it("provider별 키는 서로 독립적으로 저장·삭제된다", () => {
    const store = freshStore();
    store.setApiKey("gemini", "gk-test");
    store.setApiKey("openai", "sk-test");

    expect(store.getApiKey("gemini")).toBe("gk-test");
    expect(store.getApiKey("openai")).toBe("sk-test");

    store.deleteApiKey("openai");
    expect(store.hasApiKey("openai")).toBe(false);
    expect(store.getApiKey("gemini")).toBe("gk-test");
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
