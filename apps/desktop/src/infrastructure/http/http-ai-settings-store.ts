import type { AiProviderId, AiSettingsStore } from "../ai/ai-settings-store";
import { httpDelete, httpGet, httpPost } from "./http-client";

export class HttpAiSettingsStore implements AiSettingsStore {
  async hasApiKey(provider: AiProviderId): Promise<boolean> {
    const { hasKey } = await httpGet<{ hasKey: boolean }>(`/ai/keys/${provider}`);
    return hasKey;
  }

  async setApiKey(provider: AiProviderId, apiKey: string): Promise<void> {
    await httpPost(`/ai/keys/${provider}`, { apiKey });
  }

  async deleteApiKey(provider: AiProviderId): Promise<void> {
    await httpDelete(`/ai/keys/${provider}`);
  }

  async testConnection(provider: AiProviderId): Promise<void> {
    await httpPost(`/ai/keys/${provider}/test`);
  }

  async getActiveProvider(): Promise<AiProviderId> {
    const { provider } = await httpGet<{ provider: AiProviderId }>("/ai/provider");
    return provider;
  }

  async setActiveProvider(provider: AiProviderId): Promise<void> {
    await httpPost("/ai/provider", { provider });
  }
}
