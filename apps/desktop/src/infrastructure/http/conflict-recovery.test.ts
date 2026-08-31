import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { resyncConflictVersion } from "./conflict-recovery";

type Snapshot = { items: Array<{ id: string; version: number }> };
const key = ["todo"] as const;

describe("resyncConflictVersion", () => {
  it("무효화 뒤 최신 snapshot의 version을 돌려준다(409 후 재저장이 stuck 되지 않도록)", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<Snapshot>(key, { items: [{ id: "a", version: 1 }] });
    // 다른 기기가 먼저 저장해 서버 version이 2로 올라간 상황을 무효화(=재조회)가 반영한다.
    const invalidate = vi.fn(async () => {
      queryClient.setQueryData<Snapshot>(key, { items: [{ id: "a", version: 2 }] });
    });

    const version = await resyncConflictVersion<Snapshot>(
      queryClient, key, invalidate,
      (snapshot) => snapshot.items.find((item) => item.id === "a"),
    );

    expect(invalidate).toHaveBeenCalledOnce();
    expect(version).toBe(2);
  });

  it("레코드가 사라졌으면 null(다른 기기 삭제)", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<Snapshot>(key, { items: [] });

    const version = await resyncConflictVersion<Snapshot>(
      queryClient, key, async () => {},
      (snapshot) => snapshot.items.find((item) => item.id === "gone"),
    );

    expect(version).toBeNull();
  });
});
