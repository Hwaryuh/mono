export type AiProviderId = "gemini" | "openai";

export interface AiSettingsStore {
  hasGeminiApiKey(): Promise<boolean>;
  setGeminiApiKey(apiKey: string): Promise<void>;
  deleteGeminiApiKey(): Promise<void>;
  testGeminiConnection(): Promise<void>;
  hasOpenaiApiKey(): Promise<boolean>;
  setOpenaiApiKey(apiKey: string): Promise<void>;
  deleteOpenaiApiKey(): Promise<void>;
  testOpenaiConnection(): Promise<void>;
  getActiveProvider(): Promise<AiProviderId>;
  setActiveProvider(provider: AiProviderId): Promise<void>;
}

export class InMemoryAiSettingsStore implements AiSettingsStore {
  private geminiKey: string | null = null;
  private openaiKey: string | null = null;
  private activeProvider: AiProviderId = "gemini";

  async hasGeminiApiKey(): Promise<boolean> {
    return this.geminiKey !== null;
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    if (!apiKey.trim()) throw new Error("Gemini API 키를 입력해야 합니다.");
    this.geminiKey = apiKey;
  }

  async deleteGeminiApiKey(): Promise<void> {
    this.geminiKey = null;
  }

  async testGeminiConnection(): Promise<void> {
    if (this.geminiKey === null) throw new Error("Gemini API 키가 설정되지 않았습니다.");
  }

  async hasOpenaiApiKey(): Promise<boolean> {
    return this.openaiKey !== null;
  }

  async setOpenaiApiKey(apiKey: string): Promise<void> {
    if (!apiKey.trim()) throw new Error("OpenAI API 키를 입력해야 합니다.");
    this.openaiKey = apiKey;
  }

  async deleteOpenaiApiKey(): Promise<void> {
    this.openaiKey = null;
  }

  async testOpenaiConnection(): Promise<void> {
    if (this.openaiKey === null) throw new Error("OpenAI API 키가 설정되지 않았습니다.");
  }

  async getActiveProvider(): Promise<AiProviderId> {
    return this.activeProvider;
  }

  async setActiveProvider(provider: AiProviderId): Promise<void> {
    this.activeProvider = provider;
  }
}
