/**
 * Media scale. count/bytes are the cleanup-target (orphan) scale, total* is the entire bucket — used for the
 * warning against the R2 free tier limit (10GB). Both are computed from a single bucket listing call.
 */
export type OrphanMediaUsage = { count: number; bytes: number; totalCount: number; totalBytes: number };

/** The R2 free tier limit (monthly, per account). Overage: storage $0.015/GB, Class A $4.50/M, Class B $0.36/M. */
export const R2_FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const R2_FREE_CLASS_A = 1_000_000;
export const R2_FREE_CLASS_B = 10_000_000;

/** Cleans up orphaned media (unreferenced R2 objects). The server computes the reference list from its own DB. */
export interface MediaMaintenance {
  /** Doesn't delete anything — a preview before cleanup, plus the bucket's total usage. */
  orphanUsage(): Promise<OrphanMediaUsage>;
  /** Deletes all unreferenced media. Returns the number deleted. */
  gc(): Promise<number>;
}

/** An in-memory implementation used outside HTTP (tests, browser preview). */
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
