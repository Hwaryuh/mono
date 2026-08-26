import { existsSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";
import type { CaptureAnalysisProvider } from "./capture-analysis-provider.ts";
import { SelectableCaptureAnalysisProvider } from "./selectable-capture-analysis-provider.ts";
import { SqliteSecretStore } from "./secret-store.ts";

const keyPath = "test-selectable.key";

function fakeProvider(target: string): CaptureAnalysisProvider {
  return { analyze: async () => ({ target, confidence: 1, fields: [] }) as never };
}

describe("SelectableCaptureAnalysisProvider", () => {
  afterEach(() => {
    if (existsSync(keyPath)) rmSync(keyPath);
  });

  it("기본값(gemini)으로 위임하고, 전환하면 다음 호출부터 바뀐다", async () => {
    const secretStore = new SqliteSecretStore(createDb(":memory:") as Db, new SecretCrypto(keyPath));
    const provider = new SelectableCaptureAnalysisProvider(secretStore, {
      gemini: fakeProvider("scrap"),
      openai: fakeProvider("todo"),
    });

    expect((await provider.analyze({ raw: "x", images: [] })).target).toBe("scrap");

    secretStore.setActiveProvider("openai");
    expect((await provider.analyze({ raw: "x", images: [] })).target).toBe("todo");
  });
});
