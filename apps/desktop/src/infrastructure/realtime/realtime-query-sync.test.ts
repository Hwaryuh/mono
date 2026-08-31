import type { RealtimeChangeListener, RealtimeChangeSource } from "./realtime-change-source";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { RealtimeQuerySync } from "./realtime-query-sync";

class FakeRealtimeChangeSource implements RealtimeChangeSource {
  listener?: RealtimeChangeListener;

  connect(listener: RealtimeChangeListener): () => void {
    this.listener = listener;
    return vi.fn();
  }
}

describe("RealtimeQuerySync", () => {
  it("변경된 모듈의 쿼리만 무효화한다", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const source = new FakeRealtimeChangeSource();
    RealtimeQuerySync.of(queryClient, source).start();

    source.listener?.onChange({ revision: 1, modules: ["todo", "dashboard"] });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["todo"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("연결과 재동기화 때 모든 snapshot을 다시 검증한다", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const source = new FakeRealtimeChangeSource();
    RealtimeQuerySync.of(queryClient, source).start();

    source.listener?.onOpen();
    expect(invalidate).toHaveBeenCalledTimes(7);

    invalidate.mockClear();
    source.listener?.onResync();
    expect(invalidate).toHaveBeenCalledTimes(7);
  });
});
