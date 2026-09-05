// crypto.randomUUID can be unavailable in a non-secure context (some WKWebView custom schemes).
// getRandomValues is far more widely supported, so it's used to build a v4 UUID directly.
export function newMediaId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The repository for original media (photo/video bytes). Since R2 is the single source of truth, this only handles upload/download/delete. */
export interface MediaStore {
  save(id: string, file: Blob): Promise<void>;
  /** Returns an object URL (or null). A string usable directly as src=. */
  load(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
}

/** An in-memory implementation used outside HTTP (tests, browser preview). */
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
