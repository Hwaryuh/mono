const DEFAULT_API_BASE_URL = "http://127.0.0.1:4174";

export let API_BASE_URL = DEFAULT_API_BASE_URL;
let apiToken = "";

export class HttpError extends Error {
  constructor(message: string, readonly status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "HttpError";
  }
}

/** 편집 충돌(다른 기기가 먼저 저장) — 낙관적 버전 불일치. 편집 폼은 닫지 않고 최신을 다시 읽는다. */
export function isConflictError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === 409;
}

export function configureApiBaseUrl(value: string): void {
  API_BASE_URL = value.replace(/\/$/, "");
}

/** 원격 모드에서 서버가 요구할 때 보낼 베어러 토큰. 빈 문자열이면 헤더 미전송. */
export function configureApiToken(value: string): void {
  apiToken = value.trim();
}

/** 모든 요청 init에 Authorization 헤더를 얹는다(토큰이 있을 때만). */
function withAuth(init: RequestInit = {}): RequestInit {
  if (!apiToken) return init;
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${apiToken}` } };
}

function extractErrorMessage(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const { error } = body as { error?: unknown };
  if (typeof error === "string") return error;
  if (Array.isArray(error) && error.length > 0) {
    const [first] = error as unknown[];
    if (first && typeof first === "object" && "message" in first) {
      return String((first as { message: unknown }).message);
    }
  }
  return null;
}

function jsonInit(method: string, body?: unknown, expectedVersion?: number): RequestInit {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (expectedVersion !== undefined) headers["If-Match"] = `"${expectedVersion}"`;
  return { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, withAuth(init));
  } catch (error) {
    throw new Error(`API 서버(${API_BASE_URL})에 연결할 수 없습니다.`, { cause: error });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(
      extractErrorMessage(body) ?? `요청이 실패했습니다. (${response.status})`,
      response.status,
    );
  }
  return body as T;
}

export const httpGet = <T>(path: string): Promise<T> => request<T>(path);
export const httpPost = <T = void>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit("POST", body));
export const httpPut = <T = void>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit("PUT", body));
export const httpPutVersioned = <T = void>(path: string, expectedVersion: number | undefined, body?: unknown): Promise<T> =>
  request<T>(path, jsonInit("PUT", body, expectedVersion));
export const httpDelete = <T = void>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit("DELETE", body));

// request()는 항상 JSON 응답을 가정한다. 미디어 업로드·다운로드는 바이너리라 별도 경로가 필요하다.
//
// fetch가 아니라 XMLHttpRequest를 쓴다 — macOS WKWebView(Tauri)에서 fetch + FormData
// 멀티파트 업로드가 본문을 비워 보내는 사례가 있다. XHR은 같은 환경에서 안정적이다.
export function httpUpload(path: string, formData: FormData): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    // Content-Type은 지정하지 않는다 — XHR이 FormData의 multipart boundary를 스스로 붙인다.
    if (apiToken) xhr.setRequestHeader("Authorization", `Bearer ${apiToken}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* 비 JSON 응답 */ }
      reject(new Error(extractErrorMessage(body) ?? `요청이 실패했습니다. (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error(`API 서버(${API_BASE_URL})에 연결할 수 없습니다.`));
    xhr.send(formData);
  });
}

export async function httpGetBlob(path: string): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, withAuth());
  } catch (error) {
    throw new Error(`API 서버(${API_BASE_URL})에 연결할 수 없습니다.`, { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(body) ?? `요청이 실패했습니다. (${response.status})`);
  }
  return response.blob();
}
