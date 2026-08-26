import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { secrets } from "../db/schema.ts";
import { SecretCrypto } from "../security/secret-crypto.ts";

const GEMINI_KEY = "gemini_api_key";

export class SqliteSecretStore {
  private readonly db: Db;
  private readonly crypto: SecretCrypto;

  constructor(db: Db, crypto: SecretCrypto = new SecretCrypto()) {
    this.db = db;
    this.crypto = crypto;
  }

  hasGeminiApiKey(): boolean {
    return this.db.select({ key: secrets.key }).from(secrets).where(eq(secrets.key, GEMINI_KEY)).get() !== undefined;
  }

  getGeminiApiKey(): string | null {
    const row = this.db.select().from(secrets).where(eq(secrets.key, GEMINI_KEY)).get();
    return row ? this.crypto.decrypt(row.value) : null;
  }

  setGeminiApiKey(apiKey: string): void {
    if (!apiKey.trim()) throw new Error("Gemini API 키를 입력해야 합니다.");
    const value = this.crypto.encrypt(apiKey);
    this.db.insert(secrets).values({ key: GEMINI_KEY, value })
      .onConflictDoUpdate({ target: secrets.key, set: { value } })
      .run();
  }

  deleteGeminiApiKey(): void {
    this.db.delete(secrets).where(eq(secrets.key, GEMINI_KEY)).run();
  }
}
