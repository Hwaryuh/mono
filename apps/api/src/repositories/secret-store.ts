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

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const R2_KEYS = {
  accountId: "r2_account_id",
  accessKeyId: "r2_access_key_id",
  secretAccessKey: "r2_secret_access_key",
  bucket: "r2_bucket",
} as const satisfies Record<keyof R2Credentials, string>;

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

  hasR2Credentials(): boolean {
    return (Object.keys(R2_KEYS) as (keyof R2Credentials)[]).every((field) => this.hasKey(R2_KEYS[field]));
  }

  getR2Credentials(): R2Credentials | null {
    const accountId = this.getKey(R2_KEYS.accountId);
    const accessKeyId = this.getKey(R2_KEYS.accessKeyId);
    const secretAccessKey = this.getKey(R2_KEYS.secretAccessKey);
    const bucket = this.getKey(R2_KEYS.bucket);
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
    return { accountId, accessKeyId, secretAccessKey, bucket };
  }

  setR2Credentials(credentials: R2Credentials): void {
    for (const field of Object.keys(R2_KEYS) as (keyof R2Credentials)[]) {
      if (!credentials[field].trim()) throw new Error("R2 자격증명을 모두 입력해야 합니다.");
    }
    for (const field of Object.keys(R2_KEYS) as (keyof R2Credentials)[]) {
      this.setKey(R2_KEYS[field], credentials[field]);
    }
  }

  deleteR2Credentials(): void {
    for (const key of Object.values(R2_KEYS)) this.deleteKey(key);
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
