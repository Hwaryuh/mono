export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4174";

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
