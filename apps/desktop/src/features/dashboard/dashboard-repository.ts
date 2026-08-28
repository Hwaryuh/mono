import type { CaptureInput, DashboardSnapshot } from "@mono/contracts";

export interface DashboardRepository {
  getSnapshot(): Promise<DashboardSnapshot>;
  capture(input: CaptureInput): Promise<void>;
  toggleTask(taskId: string): Promise<void>;
}
