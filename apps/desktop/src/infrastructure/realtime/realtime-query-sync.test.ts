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
  it("invalidates only the queries for the changed module", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const source = new FakeRealtimeChangeSource();
    RealtimeQuerySync.of(queryClient, source).start();

    source.listener?.onChange({ revision: 1, modules: ["todo", "dashboard"] });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["todo"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("revalidates all snapshots on connect and resync", () => {
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
