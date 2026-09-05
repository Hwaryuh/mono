import { translate } from "../../i18n/i18n";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:4174";

export let API_BASE_URL = DEFAULT_API_BASE_URL;
let apiToken = "";

export class HttpError extends Error {
  constructor(message: string, readonly status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "HttpError";
  }
}

/** An edit conflict (another device saved first) — an optimistic version mismatch. Doesn't close the edit form; re-reads the latest instead. */
export function isConflictError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === 409;
}

export function configureApiBaseUrl(value: string): void {
  API_BASE_URL = value.replace(/\/$/, "");
}

/** The bearer token to send when the server requires it in remote mode. Not sent as a header if empty. */
export function configureApiToken(value: string): void {
  apiToken = value.trim();
}

/** Attaches an Authorization header to every request init (only when a token exists). */
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
    throw new Error(translate("http.error.apiUnreachable", { apiUrl: API_BASE_URL }), { cause: error });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(
      extractErrorMessage(body) ?? translate("http.error.requestFailed", { status: response.status }),
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

// request() always assumes a JSON response. Media upload/download is binary and needs a separate path.
//
// Uses XMLHttpRequest instead of fetch — on macOS WKWebView (Tauri), fetch + FormData
// multipart uploads have been observed sending an empty body. XHR is stable in the same environment.
export function httpUpload(path: string, formData: FormData): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    // Content-Type is not set — XHR attaches FormData's multipart boundary on its own.
    if (apiToken) xhr.setRequestHeader("Authorization", `Bearer ${apiToken}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON response */ }
      reject(new Error(extractErrorMessage(body) ?? translate("http.error.requestFailed", { status: xhr.status })));
    };
    xhr.onerror = () => reject(new Error(translate("http.error.apiUnreachable", { apiUrl: API_BASE_URL })));
    xhr.send(formData);
  });
}

export async function httpGetBlob(path: string): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, withAuth());
  } catch (error) {
    throw new Error(translate("http.error.apiUnreachable", { apiUrl: API_BASE_URL }), { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(body) ?? translate("http.error.requestFailed", { status: response.status }));
  }
  return response.blob();
}
