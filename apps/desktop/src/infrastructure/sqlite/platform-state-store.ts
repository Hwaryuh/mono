import type { MockPlatformState } from "../mock/mock-platform-state";

export interface PlatformStateStore {
  load(): Promise<unknown | null>;
  save(state: MockPlatformState): Promise<void>;
}
