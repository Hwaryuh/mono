import type { DashboardSnapshot } from "@mono/contracts";
import type { DashboardRepository } from "../../features/dashboard/dashboard-repository";
import { httpGet, httpPost } from "./http-client";

export function createHttpDashboardRepository(): DashboardRepository {
  return {
    getSnapshot: () => httpGet<DashboardSnapshot>("/dashboard/snapshot"),
    capture: (input) => httpPost("/dashboard/capture", input),
    toggleTask: (taskId) => httpPost(`/dashboard/tasks/${encodeURIComponent(taskId)}/toggle`),
  };
}
