import type { R2Credentials, R2SettingsStore } from "../media/r2-settings-store";
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
}
