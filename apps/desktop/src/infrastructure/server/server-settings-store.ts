import { translate } from "../../i18n/i18n";
export type ServerMode = "embedded" | "remote";

/**
 * Represents both the setting stored in `server.json` and the currently running connection together. Since the app
 * decides the connection only once at launch, the stored value and the running value can differ (`restartRequired`).
 */
export interface ServerConnection {
  mode: ServerMode;
  /** The stored remote address. "" if embedded or unset. Used as the input field's initial value. */
  remoteUrl: string;
  /** The stored bearer token. "" if none. Used as the input field's initial value. */
  remoteToken: string;
  /** The address the currently running app actually uses. */
  effectiveApiBaseUrl: string;
  runningEmbedded: boolean;
  /** Whether the MONO_API_BASE_URL environment variable is overriding the file setting. */
  envOverride: boolean;
  /** Whether the setting can be changed from this screen. False for a web preview or an environment-variable override. */
  manageable: boolean;
  /** Whether the app must be restarted to apply the stored setting. */
  restartRequired: boolean;
}

export interface SaveServerConnectionInput {
  mode: ServerMode;
  /** Only used when mode is "remote". The server normalizes and validates it. */
  remoteUrl?: string;
  /** Only used when mode is "remote". Saved without a token if empty. */
  token?: string;
}

export interface ServerSettingsStore {
  read(): Promise<ServerConnection>;
  save(input: SaveServerConnectionInput): Promise<ServerConnection>;
  /**
   * Confirms the address is a mono server (`/health`), and that the token is correct (the authenticated endpoint isn't a 401).
   * Resolves if it succeeds, otherwise rejects with a human-readable error.
   */
  probe(baseUrl: string, token?: string): Promise<void>;
  /** Restarts the app with the stored setting. Does not return on success. */
  restart(): Promise<void>;
}

export function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** A lightweight front-end check mirroring Rust's `normalize_remote_url` — used only to enable the save button. */
export function looksLikeRemoteApiUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (url.protocol === "http:") return url.port === "4174";
  if (url.protocol === "https:") return url.port === "" || url.port === "443" || url.port === "4174";
  return false;
}

const DEFAULT_EMBEDDED_URL = "http://127.0.0.1:4174";

export class InMemoryServerSettingsStore implements ServerSettingsStore {
  private mode: ServerMode = "embedded";
  private remoteUrl = "";
  private remoteToken = "";
  private running: { embedded: boolean; url: string } = { embedded: true, url: DEFAULT_EMBEDDED_URL };
  private readonly reachable: Set<string>;
  private readonly requiredToken: string;

  constructor(options: { reachable?: string[]; requiredToken?: string } = {}) {
    this.reachable = new Set((options.reachable ?? []).map(trimBaseUrl));
    this.reachable.add(DEFAULT_EMBEDDED_URL);
    this.requiredToken = options.requiredToken ?? "";
  }

  async read(): Promise<ServerConnection> {
    return this.snapshot();
  }

  async save({ mode, remoteUrl, token }: SaveServerConnectionInput): Promise<ServerConnection> {
    if (mode === "remote") {
      const next = trimBaseUrl(remoteUrl ?? "");
      if (!next) throw new Error(translate("server.validation.remoteUrlRequired"));
      if (!looksLikeRemoteApiUrl(next)) {
        throw new Error(translate("server.validation.remotePort"));
      }
      this.remoteUrl = next;
      this.remoteToken = (token ?? "").trim();
    } else {
      this.remoteUrl = "";
      this.remoteToken = "";
    }
    this.mode = mode;
    return this.snapshot();
  }

  async probe(baseUrl: string, token?: string): Promise<void> {
    if (!this.reachable.has(trimBaseUrl(baseUrl))) {
      throw new Error(translate("server.error.unreachable"));
    }
    if (this.requiredToken && (token ?? "").trim() !== this.requiredToken) {
      throw new Error((token ?? "").trim() ? translate("server.auth.invalidToken") : translate("server.auth.tokenRequired"));
    }
  }

  async restart(): Promise<void> {
    this.running = this.mode === "embedded"
      ? { embedded: true, url: DEFAULT_EMBEDDED_URL }
      : { embedded: false, url: this.remoteUrl };
  }

  /** Test convenience: marks this address as reachable. */
  markReachable(baseUrl: string): void {
    this.reachable.add(trimBaseUrl(baseUrl));
  }

  private snapshot(): ServerConnection {
    const target = this.mode === "embedded" ? DEFAULT_EMBEDDED_URL : this.remoteUrl;
    return {
      mode: this.mode,
      remoteUrl: this.remoteUrl,
      remoteToken: this.remoteToken,
      effectiveApiBaseUrl: this.running.url,
      runningEmbedded: this.running.embedded,
      envOverride: false,
      manageable: true,
      restartRequired: target !== this.running.url || (this.mode === "embedded") !== this.running.embedded,
    };
  }
}
