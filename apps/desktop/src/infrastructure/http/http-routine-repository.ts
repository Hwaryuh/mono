import type { RoutineSnapshot } from "@mono/contracts";
import type { RoutineRepository } from "../../features/routine/routine-repository";
import { httpDelete, httpGet, httpPost, httpPutVersioned } from "./http-client";

export function createHttpRoutineRepository(): RoutineRepository {
  return {
    getSnapshot: () => httpGet<RoutineSnapshot>("/routine/snapshot"),
    create: (input) => httpPost("/routine/items", input),
    update: (routineId, input, expectedVersion) => httpPutVersioned(`/routine/items/${encodeURIComponent(routineId)}`, expectedVersion, input),
    delete: (routineId) => httpDelete(`/routine/items/${encodeURIComponent(routineId)}`),
    toggleToday: (routineId) => httpPost(`/routine/items/${encodeURIComponent(routineId)}/toggle-today`),
  };
}
