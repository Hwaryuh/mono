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
