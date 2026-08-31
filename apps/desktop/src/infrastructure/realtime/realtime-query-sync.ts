import { realtimeModuleIds, type RealtimeModuleId } from "@mono/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeChangeSource } from "./realtime-change-source";

export class RealtimeQuerySync {
  private constructor(
    private readonly queryClient: QueryClient,
    private readonly source: RealtimeChangeSource,
  ) {}

  static of(queryClient: QueryClient, source: RealtimeChangeSource): RealtimeQuerySync {
    return new RealtimeQuerySync(queryClient, source);
  }

  start(): () => void {
    return this.source.connect({
      onChange: ({ modules }) => this.invalidate(modules),
      // 연결 중 빠진 이벤트가 있을 수 있으므로 최초 연결과 재연결을 같은 방식으로 보정한다.
      onOpen: () => this.invalidate(realtimeModuleIds),
      onResync: () => this.invalidate(realtimeModuleIds),
    });
  }

  private invalidate(modules: readonly RealtimeModuleId[]): void {
    for (const module of new Set(modules)) {
      void this.queryClient.invalidateQueries({ queryKey: [module] });
    }
  }
}
