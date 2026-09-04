/**
 * 미디어 규모. count/bytes는 정리 대상(고아) 규모, total*은 버킷 전체 — R2 무료 한도(10GB)
 * 대비 경고에 쓴다. 한 번의 버킷 목록 조회로 둘 다 계산된다.
 */
export type OrphanMediaUsage = { count: number; bytes: number; totalCount: number; totalBytes: number };

/** R2 무료 한도 (월, 계정 단위). 초과분: 저장 $0.015/GB, Class A $4.50/M, Class B $0.36/M. */
export const R2_FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const R2_FREE_CLASS_A = 1_000_000;
export const R2_FREE_CLASS_B = 10_000_000;

/** 고아 미디어(참조 없는 R2 객체) 정리. 참조 목록은 서버가 자체 DB에서 계산한다. */
export interface MediaMaintenance {
  /** 지우지 않는다 — 정리 전 미리보기 + 버킷 전체 사용량. */
  orphanUsage(): Promise<OrphanMediaUsage>;
  /** 참조 없는 미디어를 전부 지운다. 지운 개수를 반환한다. */
  gc(): Promise<number>;
}

/** HTTP 밖(테스트·브라우저 미리보기)에서 쓰는 인메모리 구현. */
export class InMemoryMediaMaintenance implements MediaMaintenance {
  constructor(private usage: OrphanMediaUsage = { count: 0, bytes: 0, totalCount: 0, totalBytes: 0 }) {}

  async orphanUsage(): Promise<OrphanMediaUsage> {
    return this.usage;
  }

  async gc(): Promise<number> {
    const { count } = this.usage;
    this.usage = { ...this.usage, count: 0, bytes: 0 };
    return count;
  }
}
