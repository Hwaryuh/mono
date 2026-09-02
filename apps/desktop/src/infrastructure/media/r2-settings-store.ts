import { translate } from "../../i18n/i18n";
export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface R2SettingsStore {
  hasCredentials(): Promise<boolean>;
  setCredentials(credentials: R2Credentials): Promise<void>;
  deleteCredentials(): Promise<void>;
  testConnection(): Promise<void>;
}

export class InMemoryR2SettingsStore implements R2SettingsStore {
  private credentials: R2Credentials | null = null;

  async hasCredentials(): Promise<boolean> {
    return this.credentials !== null;
  }

  async setCredentials(credentials: R2Credentials): Promise<void> {
    if (!credentials.accountId.trim() || !credentials.accessKeyId.trim() || !credentials.secretAccessKey.trim() || !credentials.bucket.trim()) {
      throw new Error(translate("r2.text.001"));
    }
    this.credentials = credentials;
  }

  async deleteCredentials(): Promise<void> {
    this.credentials = null;
  }

  async testConnection(): Promise<void> {
    if (this.credentials === null) throw new Error(translate("r2.text.002"));
  }
}
