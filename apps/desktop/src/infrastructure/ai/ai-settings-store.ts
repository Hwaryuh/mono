export type AiProviderId = "gemini" | "openai";

export const AI_PROVIDER_IDS = ["gemini", "openai"] as const satisfies readonly AiProviderId[];

export interface AiSettingsStore {
  hasApiKey(provider: AiProviderId): Promise<boolean>;
  setApiKey(provider: AiProviderId, apiKey: string): Promise<void>;
  deleteApiKey(provider: AiProviderId): Promise<void>;
  testConnection(provider: AiProviderId): Promise<void>;
  getActiveProvider(): Promise<AiProviderId>;
  setActiveProvider(provider: AiProviderId): Promise<void>;
}

const PROVIDER_LABEL: Record<AiProviderId, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
};

export class InMemoryAiSettingsStore implements AiSettingsStore {
  private keys: Record<AiProviderId, string | null> = { gemini: null, openai: null };
  private activeProvider: AiProviderId = "gemini";

  async hasApiKey(provider: AiProviderId): Promise<boolean> {
    return this.keys[provider] !== null;
  }

  async setApiKey(provider: AiProviderId, apiKey: string): Promise<void> {
    if (!apiKey.trim()) throw new Error(`${PROVIDER_LABEL[provider]} API 키를 입력해야 합니다.`);
    this.keys[provider] = apiKey;
  }

  async deleteApiKey(provider: AiProviderId): Promise<void> {
    this.keys[provider] = null;
  }

  async testConnection(provider: AiProviderId): Promise<void> {
    if (this.keys[provider] === null) throw new Error(`${PROVIDER_LABEL[provider]} API 키가 설정되지 않았습니다.`);
  }

  async getActiveProvider(): Promise<AiProviderId> {
    return this.activeProvider;
  }

  async setActiveProvider(provider: AiProviderId): Promise<void> {
    this.activeProvider = provider;
  }
}
