export type ServerMode = "embedded" | "remote";

/**
 * `server.json`에 저장된 설정과 지금 실행 중인 연결을 함께 나타낸다. 앱은 실행 시
 * 한 번만 연결을 결정하므로, 저장된 값과 실행 중인 값이 다를 수 있다(`restartRequired`).
 */
export interface ServerConnection {
  mode: ServerMode;
  /** 저장된 원격 주소. embedded이거나 미설정이면 "". 입력란 초기값으로 쓴다. */
  remoteUrl: string;
  /** 저장된 베어러 토큰. 없으면 "". 입력란 초기값으로 쓴다. */
  remoteToken: string;
  /** 지금 실행 중인 앱이 실제로 사용하는 주소. */
  effectiveApiBaseUrl: string;
  runningEmbedded: boolean;
  /** MONO_API_BASE_URL 환경 변수가 파일 설정을 덮어쓴 상태. */
  envOverride: boolean;
  /** 이 화면에서 설정을 바꿀 수 있는지. 웹 미리보기나 환경 변수 override면 false. */
  manageable: boolean;
  /** 저장된 설정을 적용하려면 앱을 다시 시작해야 하는지. */
  restartRequired: boolean;
}

export interface SaveServerConnectionInput {
  mode: ServerMode;
  /** mode가 "remote"일 때만 사용. 서버가 정규화·검증한다. */
  remoteUrl?: string;
  /** mode가 "remote"일 때만 사용. 비면 토큰 없이 저장. */
  token?: string;
}

export interface ServerSettingsStore {
  read(): Promise<ServerConnection>;
  save(input: SaveServerConnectionInput): Promise<ServerConnection>;
  /**
   * 주소가 mono 서버인지(`/health`), 그리고 토큰이 맞는지(인증 걸린 엔드포인트가 401이 아닌지)
   * 확인한다. 되면 resolve, 아니면 사람이 읽을 오류로 reject.
   */
  probe(baseUrl: string, token?: string): Promise<void>;
  /** 저장된 설정으로 앱을 다시 시작한다. 성공하면 반환하지 않는다. */
  restart(): Promise<void>;
}

export function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Rust `normalize_remote_url`의 가벼운 앞단 판정 — 저장 버튼 활성화에만 쓴다. */
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
      if (!next) throw new Error("원격 서버 주소를 입력해야 합니다.");
      if (!looksLikeRemoteApiUrl(next)) {
        throw new Error("원격 API는 HTTP 4174 또는 HTTPS 443/4174 포트를 사용해야 합니다.");
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
      throw new Error("서버에 연결할 수 없습니다. 주소와 Tailscale 연결을 확인하세요.");
    }
    if (this.requiredToken && (token ?? "").trim() !== this.requiredToken) {
      throw new Error((token ?? "").trim() ? "API 토큰이 올바르지 않습니다." : "이 서버는 API 토큰이 필요합니다.");
    }
  }

  async restart(): Promise<void> {
    this.running = this.mode === "embedded"
      ? { embedded: true, url: DEFAULT_EMBEDDED_URL }
      : { embedded: false, url: this.remoteUrl };
  }

  /** 테스트 편의: 이 주소를 도달 가능으로 표시한다. */
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
