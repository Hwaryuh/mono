import { translate } from "../../i18n/i18n";
export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** A Cloudflare GraphQL Analytics usage report. Based on the entire account (all buckets). */
export interface R2UsageReport {
  storageBytes: number;
  objectCount: number;
  sampledAt: string | null;
  classA: number;
  classB: number;
  freeOps: number;
  otherOps: number;
  monthStart: string;
}

export interface R2SettingsStore {
  hasCredentials(): Promise<boolean>;
  setCredentials(credentials: R2Credentials): Promise<void>;
  deleteCredentials(): Promise<void>;
  testConnection(): Promise<void>;
  hasAnalyticsToken(): Promise<boolean>;
  setAnalyticsToken(token: string): Promise<void>;
  deleteAnalyticsToken(): Promise<void>;
  usageReport(): Promise<R2UsageReport>;
}

export class InMemoryR2SettingsStore implements R2SettingsStore {
  private credentials: R2Credentials | null = null;
  private analyticsToken: string | null = null;
  private report: R2UsageReport | null = null;

  constructor(report?: R2UsageReport) {
    this.report = report ?? null;
    if (report) this.analyticsToken = "test-token";
  }

  async hasCredentials(): Promise<boolean> {
    return this.credentials !== null;
  }

  async setCredentials(credentials: R2Credentials): Promise<void> {
    if (!credentials.accountId.trim() || !credentials.accessKeyId.trim() || !credentials.secretAccessKey.trim() || !credentials.bucket.trim()) {
      throw new Error(translate("r2.validation.credentialsRequired"));
    }
    this.credentials = credentials;
  }

  async deleteCredentials(): Promise<void> {
    this.credentials = null;
  }

  async testConnection(): Promise<void> {
    if (this.credentials === null) throw new Error(translate("r2.error.credentialsNotConfigured"));
  }

  async hasAnalyticsToken(): Promise<boolean> {
    return this.analyticsToken !== null;
  }

  async setAnalyticsToken(token: string): Promise<void> {
    if (!token.trim()) throw new Error(translate("r2.validation.credentialsRequired"));
    this.analyticsToken = token;
  }

  async deleteAnalyticsToken(): Promise<void> {
    this.analyticsToken = null;
    this.report = null;
  }

  async usageReport(): Promise<R2UsageReport> {
    if (this.report === null) throw new Error(translate("r2.error.credentialsNotConfigured"));
    return this.report;
  }
}
