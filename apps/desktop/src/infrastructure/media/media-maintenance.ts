/** 정리 대상 미디어의 규모. */
export type OrphanMediaUsage = { count: number; bytes: number };

/** 고아 미디어(참조 없는 R2 객체) 정리. 참조 목록은 서버가 자체 DB에서 계산한다. */
export interface MediaMaintenance {
  /** 지우지 않는다 — 정리 전 미리보기용이다. */
  orphanUsage(): Promise<OrphanMediaUsage>;
  /** 참조 없는 미디어를 전부 지운다. 지운 개수를 반환한다. */
  gc(): Promise<number>;
}

/** HTTP 밖(테스트·브라우저 미리보기)에서 쓰는 인메모리 구현. */
export class InMemoryMediaMaintenance implements MediaMaintenance {
  constructor(private usage: OrphanMediaUsage = { count: 0, bytes: 0 }) {}

  async orphanUsage(): Promise<OrphanMediaUsage> {
    return this.usage;
  }

  async gc(): Promise<number> {
    const { count } = this.usage;
    this.usage = { count: 0, bytes: 0 };
    return count;
  }
}
