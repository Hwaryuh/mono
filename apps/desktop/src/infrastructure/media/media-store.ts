// crypto.randomUUID는 비보안 컨텍스트(일부 WKWebView 커스텀 스킴)에서 없을 수 있다.
// getRandomValues는 훨씬 넓게 지원되므로 그걸로 UUID v4를 직접 만든다.
export function newMediaId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 미디어 원본(사진·영상 바이트)의 저장소. R2가 단일 원본이라 여기는 업로드/다운로드/삭제만 다룬다. */
export interface MediaStore {
  save(id: string, file: Blob): Promise<void>;
  /** object URL(또는 null)을 돌려준다. src=에 그대로 쓸 수 있는 문자열이다. */
  load(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
}

/** HTTP 밖(테스트·브라우저 미리보기)에서 쓰는 인메모리 구현. */
export class InMemoryMediaStore implements MediaStore {
  private readonly items = new Map<string, Blob>();

  async save(id: string, file: Blob): Promise<void> {
    this.items.set(id, file);
  }

  async load(id: string): Promise<string | null> {
    const file = this.items.get(id);
    return file ? URL.createObjectURL(file) : null;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}
