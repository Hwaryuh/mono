export interface AiSettingsStore {
  hasGeminiApiKey(): Promise<boolean>;
  setGeminiApiKey(apiKey: string): Promise<void>;
  deleteGeminiApiKey(): Promise<void>;
  testGeminiConnection(): Promise<void>;
}

export class InMemoryAiSettingsStore implements AiSettingsStore {
  private apiKey: string | null = null;

  async hasGeminiApiKey(): Promise<boolean> {
    return this.apiKey !== null;
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    if (!apiKey.trim()) throw new Error("Gemini API 키를 입력해야 합니다.");
    this.apiKey = apiKey;
  }

  async deleteGeminiApiKey(): Promise<void> {
    this.apiKey = null;
  }

  async testGeminiConnection(): Promise<void> {
    if (this.apiKey === null) throw new Error("Gemini API 키가 설정되지 않았습니다.");
  }
}
