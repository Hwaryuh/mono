import type { R2Credentials, R2SettingsStore, R2UsageReport } from "../media/r2-settings-store";
import { httpDelete, httpGet, httpPost } from "./http-client";

export class HttpR2SettingsStore implements R2SettingsStore {
  async hasCredentials(): Promise<boolean> {
    const { hasCredentials } = await httpGet<{ hasCredentials: boolean }>("/media/credentials");
    return hasCredentials;
  }

  async setCredentials(credentials: R2Credentials): Promise<void> {
    await httpPost("/media/credentials", credentials);
  }

  async deleteCredentials(): Promise<void> {
    await httpDelete("/media/credentials");
  }

  async testConnection(): Promise<void> {
    await httpPost("/media/credentials/test");
  }

  async hasAnalyticsToken(): Promise<boolean> {
    const { hasToken } = await httpGet<{ hasToken: boolean }>("/media/analytics-token");
    return hasToken;
  }

  async setAnalyticsToken(token: string): Promise<void> {
    await httpPost("/media/analytics-token", { token });
  }

  async deleteAnalyticsToken(): Promise<void> {
    await httpDelete("/media/analytics-token");
  }

  async usageReport(): Promise<R2UsageReport> {
    return httpGet<R2UsageReport>("/media/usage-report");
  }
}
