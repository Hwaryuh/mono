import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { secrets } from "../db/schema.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";

const ACTIVE_PROVIDER_KEY = "active_ai_provider";

export type AiProviderId = "gemini" | "openai";

export const AI_PROVIDER_IDS = ["gemini", "openai"] as const satisfies readonly AiProviderId[];

const PROVIDER_STORAGE_KEY: Record<AiProviderId, string> = {
  gemini: "gemini_api_key",
  openai: "openai_api_key",
};

const PROVIDER_LABEL: Record<AiProviderId, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
};

export class SqliteSecretStore {
  private readonly db: Db;
  private readonly crypto: SecretCrypto;

  constructor(db: Db, crypto: SecretCrypto = new SecretCrypto()) {
    this.db = db;
    this.crypto = crypto;
  }

  hasApiKey(provider: AiProviderId): boolean {
    return this.hasKey(PROVIDER_STORAGE_KEY[provider]);
  }

  getApiKey(provider: AiProviderId): string | null {
    return this.getKey(PROVIDER_STORAGE_KEY[provider]);
  }

  setApiKey(provider: AiProviderId, apiKey: string): void {
    if (!apiKey.trim()) throw new Error(`${PROVIDER_LABEL[provider]} API 키를 입력해야 합니다.`);
    this.setKey(PROVIDER_STORAGE_KEY[provider], apiKey);
  }

  deleteApiKey(provider: AiProviderId): void {
    this.deleteKey(PROVIDER_STORAGE_KEY[provider]);
  }

  getActiveProvider(): AiProviderId {
    const row = this.db.select().from(secrets).where(eq(secrets.key, ACTIVE_PROVIDER_KEY)).get();
    return row?.value === "openai" ? "openai" : "gemini";
  }

  setActiveProvider(provider: AiProviderId): void {
    this.db.insert(secrets).values({ key: ACTIVE_PROVIDER_KEY, value: provider })
      .onConflictDoUpdate({ target: secrets.key, set: { value: provider } })
      .run();
  }

  private hasKey(key: string): boolean {
    return this.db.select({ key: secrets.key }).from(secrets).where(eq(secrets.key, key)).get() !== undefined;
  }

  private getKey(key: string): string | null {
    const row = this.db.select().from(secrets).where(eq(secrets.key, key)).get();
    return row ? this.crypto.decrypt(row.value) : null;
  }

  private setKey(key: string, apiKey: string): void {
    const value = this.crypto.encrypt(apiKey);
    this.db.insert(secrets).values({ key, value })
      .onConflictDoUpdate({ target: secrets.key, set: { value } })
      .run();
  }

  private deleteKey(key: string): void {
    this.db.delete(secrets).where(eq(secrets.key, key)).run();
  }
}
