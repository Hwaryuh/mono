import type { AiProviderId, AiSettingsStore } from "../ai/ai-settings-store";
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

  async hasOpenaiApiKey(): Promise<boolean> {
    const { hasKey } = await httpGet<{ hasKey: boolean }>("/ai/openai-key");
    return hasKey;
  }

  async setOpenaiApiKey(apiKey: string): Promise<void> {
    await httpPost("/ai/openai-key", { apiKey });
  }

  async deleteOpenaiApiKey(): Promise<void> {
    await httpDelete("/ai/openai-key");
  }

  async testOpenaiConnection(): Promise<void> {
    await httpPost("/ai/openai-key/test");
  }

  async getActiveProvider(): Promise<AiProviderId> {
    const { provider } = await httpGet<{ provider: AiProviderId }>("/ai/provider");
    return provider;
  }

  async setActiveProvider(provider: AiProviderId): Promise<void> {
    await httpPost("/ai/provider", { provider });
  }
}
