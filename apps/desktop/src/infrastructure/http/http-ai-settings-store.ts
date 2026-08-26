import type { AiSettingsStore } from "../ai/ai-settings-store";
import { httpDelete, httpGet, httpPost } from "./http-client";

export class HttpAiSettingsStore implements AiSettingsStore {
  async hasGeminiApiKey(): Promise<boolean> {
    const { hasKey } = await httpGet<{ hasKey: boolean }>("/ai/gemini-key");
    return hasKey;
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    await httpPost("/ai/gemini-key", { apiKey });
  }

  async deleteGeminiApiKey(): Promise<void> {
    await httpDelete("/ai/gemini-key");
  }

  async testGeminiConnection(): Promise<void> {
    await httpPost("/ai/gemini-key/test");
  }
}
