import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { secrets } from "../db/schema.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";

const GEMINI_KEY = "gemini_api_key";
const OPENAI_KEY = "openai_api_key";
const ACTIVE_PROVIDER_KEY = "active_ai_provider";

export type AiProviderId = "gemini" | "openai";

export class SqliteSecretStore {
  private readonly db: Db;
  private readonly crypto: SecretCrypto;

  constructor(db: Db, crypto: SecretCrypto = new SecretCrypto()) {
    this.db = db;
    this.crypto = crypto;
  }

  hasGeminiApiKey(): boolean {
    return this.hasKey(GEMINI_KEY);
  }

  getGeminiApiKey(): string | null {
    return this.getKey(GEMINI_KEY);
  }

  setGeminiApiKey(apiKey: string): void {
    this.setKey(GEMINI_KEY, apiKey, "Gemini API 키를 입력해야 합니다.");
  }

  deleteGeminiApiKey(): void {
    this.deleteKey(GEMINI_KEY);
  }

  hasOpenaiApiKey(): boolean {
    return this.hasKey(OPENAI_KEY);
  }

  getOpenaiApiKey(): string | null {
    return this.getKey(OPENAI_KEY);
  }

  setOpenaiApiKey(apiKey: string): void {
    this.setKey(OPENAI_KEY, apiKey, "OpenAI API 키를 입력해야 합니다.");
  }

  deleteOpenaiApiKey(): void {
    this.deleteKey(OPENAI_KEY);
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

  private setKey(key: string, apiKey: string, emptyMessage: string): void {
    if (!apiKey.trim()) throw new Error(emptyMessage);
    const value = this.crypto.encrypt(apiKey);
    this.db.insert(secrets).values({ key, value })
      .onConflictDoUpdate({ target: secrets.key, set: { value } })
      .run();
  }

  private deleteKey(key: string): void {
    this.db.delete(secrets).where(eq(secrets.key, key)).run();
  }
}
