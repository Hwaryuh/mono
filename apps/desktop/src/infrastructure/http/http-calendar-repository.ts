import type { CalendarSnapshot } from "@mono/contracts";
import type { CalendarRepository } from "../../features/calendar/calendar-repository";
import { httpDelete, httpGet, httpPost, httpPut, httpPutVersioned } from "./http-client";

export function createHttpCalendarRepository(): CalendarRepository {
  return {
    getSnapshot: (range) =>
      httpGet<CalendarSnapshot>(range ? `/calendar/snapshot?from=${range.from}&to=${range.to}` : "/calendar/snapshot"),
    create: (input) => httpPost("/calendar/events", input),
    update: (eventId, input, scope, expectedVersion) =>
      httpPutVersioned(`/calendar/events/${encodeURIComponent(eventId)}`, expectedVersion, scope ? { ...input, scope } : input),
    remove: (eventId, scope) =>
      httpDelete(`/calendar/events/${encodeURIComponent(eventId)}`, scope ? { scope } : undefined),
    createCategory: (input) => httpPost("/calendar/categories", input),
    updateCategory: (categoryId, input, expectedVersion) => httpPutVersioned(`/calendar/categories/${encodeURIComponent(categoryId)}`, expectedVersion, input),
    reorderCategories: (categoryIds) => httpPut("/calendar/categories/order", { categoryIds }),
    deleteCategory: (categoryId, replacementCategoryId) =>
      httpDelete(`/calendar/categories/${encodeURIComponent(categoryId)}`, { replacementCategoryId }),
  };
}
