import { invoke } from "@tauri-apps/api/core";

/** 미디어 원본(data URL)의 저장소. 상태 blob과 분리해 여기만 무거운 바이트를 다룬다. */
export interface MediaStore {
  save(id: string, dataUrl: string): Promise<void>;
  load(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
  /** keepIds에 없는 미디어를 전부 지운다(고아 GC). 지운 개수를 반환한다. */
  gc(keepIds: Iterable<string>): Promise<number>;
}

export class TauriMediaStore implements MediaStore {
  async save(id: string, dataUrl: string): Promise<void> {
    await invoke("save_media", { id, dataUrl });
  }

  async load(id: string): Promise<string | null> {
    return await invoke<string | null>("load_media", { id });
  }

  async delete(id: string): Promise<void> {
    await invoke("delete_media", { id });
  }

  async gc(keepIds: Iterable<string>): Promise<number> {
    return await invoke<number>("gc_media", { keepIds: Array.from(keepIds) });
  }
}

/** Tauri 밖(테스트·브라우저 미리보기)에서 쓰는 인메모리 구현. */
export class InMemoryMediaStore implements MediaStore {
  private readonly items = new Map<string, string>();

  async save(id: string, dataUrl: string): Promise<void> {
    this.items.set(id, dataUrl);
  }

  async load(id: string): Promise<string | null> {
    return this.items.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  async gc(keepIds: Iterable<string>): Promise<number> {
    const keep = new Set(keepIds);
    const orphans = Array.from(this.items.keys()).filter((id) => !keep.has(id));
    orphans.forEach((id) => this.items.delete(id));
    return orphans.length;
  }
}
