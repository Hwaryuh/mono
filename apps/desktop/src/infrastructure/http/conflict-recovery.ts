import type { QueryClient } from "@tanstack/react-query";

/**
 * After a 409 conflict, re-reads the latest snapshot and returns just the version of the record being edited.
 * The edit draft is left untouched by the caller — saving again with the returned version succeeds on top of the latest base.
 * Returns null if the record is gone (deleted on another device).
 */
export async function resyncConflictVersion<S>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  invalidate: () => Promise<void>,
  pick: (snapshot: S) => { version?: number } | undefined,
): Promise<number | null> {
  await invalidate();
  const snapshot = queryClient.getQueryData<S>(queryKey);
  if (!snapshot) return null;
  return pick(snapshot)?.version ?? null;
}
