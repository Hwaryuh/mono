import type { CalendarSnapshot } from "@mono/contracts";
import type { CalendarRepository } from "../../features/calendar/calendar-repository";
import { httpDelete, httpGet, httpPost, httpPut } from "./http-client";

export function createHttpCalendarRepository(): CalendarRepository {
  return {
    getSnapshot: (range) =>
      httpGet<CalendarSnapshot>(range ? `/calendar/snapshot?from=${range.from}&to=${range.to}` : "/calendar/snapshot"),
    create: (input) => httpPost("/calendar/events", input),
    update: (eventId, input, scope) =>
      httpPut(`/calendar/events/${encodeURIComponent(eventId)}`, scope ? { ...input, scope } : input),
    remove: (eventId, scope) =>
      httpDelete(`/calendar/events/${encodeURIComponent(eventId)}`, scope ? { scope } : undefined),
    createCategory: (input) => httpPost("/calendar/categories", input),
    updateCategory: (categoryId, input) => httpPut(`/calendar/categories/${encodeURIComponent(categoryId)}`, input),
    reorderCategories: (categoryIds) => httpPut("/calendar/categories/order", { categoryIds }),
    deleteCategory: (categoryId, replacementCategoryId) =>
      httpDelete(`/calendar/categories/${encodeURIComponent(categoryId)}`, { replacementCategoryId }),
  };
}
