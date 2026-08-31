import type { RoutineSnapshot } from "@mono/contracts";
import type { RoutineRepository } from "../../features/routine/routine-repository";
import { httpGet, httpPost, httpPut, httpPutVersioned } from "./http-client";

export function createHttpRoutineRepository(): RoutineRepository {
  return {
    getSnapshot: () => httpGet<RoutineSnapshot>("/routine/snapshot"),
    create: (input) => httpPost("/routine/items", input),
    update: (routineId, input, expectedVersion) => httpPutVersioned(`/routine/items/${encodeURIComponent(routineId)}`, expectedVersion, input),
    toggleToday: (routineId) => httpPost(`/routine/items/${encodeURIComponent(routineId)}/toggle-today`),
  };
}
