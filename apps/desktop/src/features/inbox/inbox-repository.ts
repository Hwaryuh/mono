import type { InboxSnapshot, InboxUpdateInput } from "@mono/contracts";

export interface InboxRepository {
  getSnapshot(): Promise<InboxSnapshot>;
  approve(itemId: string): Promise<void>;
  approveHighConfidence(minimum: number): Promise<void>;
  update(itemId: string, input: InboxUpdateInput, expectedVersion?: number): Promise<void>;
  discard(itemId: string): Promise<void>;
}
