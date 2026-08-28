const DEFAULT_API_BASE_URL = "http://127.0.0.1:4174";

export let API_BASE_URL = DEFAULT_API_BASE_URL;

export function configureApiBaseUrl(value: string): void {
  API_BASE_URL = value.replace(/\/$/, "");
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

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    throw new Error(`API 서버(${API_BASE_URL})에 연결할 수 없습니다.`, { cause: error });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? `요청이 실패했습니다. (${response.status})`);
  }
  return body as T;
}

export const httpGet = <T>(path: string): Promise<T> => request<T>(path);
export const httpPost = <T = void>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit("POST", body));
export const httpPut = <T = void>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit("PUT", body));
export const httpDelete = <T = void>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit("DELETE", body));

// request()는 항상 JSON 응답을 가정한다. 미디어 업로드·다운로드는 바이너리라 별도 경로가 필요하다.
export async function httpUpload(path: string, formData: FormData): Promise<void> {
  // Content-Type을 직접 지정하면 안 된다 — fetch가 FormData의 multipart boundary를 스스로 설정한다.
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method: "POST", body: formData });
  } catch (error) {
    throw new Error(`API 서버(${API_BASE_URL})에 연결할 수 없습니다.`, { cause: error });
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(body) ?? `요청이 실패했습니다. (${response.status})`);
  }
}

export async function httpGetBlob(path: string): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`);
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
