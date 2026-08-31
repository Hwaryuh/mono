import type { QueryClient } from "@tanstack/react-query";

/**
 * 409 충돌 뒤 최신 snapshot을 다시 읽어 편집 중 레코드의 version만 돌려준다.
 * 편집 draft는 호출부가 그대로 유지한다 — 반환된 version으로 다시 저장하면 최신 base 위에서 성공한다.
 * 레코드가 사라졌으면(다른 기기에서 삭제) null.
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
