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
      // Since an event could be missed while connecting, the initial connect and a reconnect are corrected the same way.
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
