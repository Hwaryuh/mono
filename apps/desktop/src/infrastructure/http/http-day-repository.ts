import type { DaySnapshot } from "@mono/contracts";
import type { DayRepository } from "../../features/day/day-repository";
import { httpDelete, httpGet, httpPost, httpPutVersioned } from "./http-client";

export function createHttpDayRepository(): DayRepository {
  return {
    getSnapshot: (date) => httpGet<DaySnapshot>(`/day/snapshot?date=${encodeURIComponent(date)}`),
    create: (input) => httpPost("/day/entries", input),
    update: (entryId, input, expectedVersion) => httpPutVersioned(`/day/entries/${encodeURIComponent(entryId)}`, expectedVersion, input),
    remove: (entryId) => httpDelete(`/day/entries/${encodeURIComponent(entryId)}`),
  };
}
