import type { CalendarSnapshot } from "@mono/contracts";
import type { CalendarRepository } from "../../features/calendar/calendar-repository";
import { httpDelete, httpGet, httpPost, httpPut } from "./http-client";

export function createHttpCalendarRepository(): CalendarRepository {
  return {
    getSnapshot: () => httpGet<CalendarSnapshot>("/calendar/snapshot"),
    create: (input) => httpPost("/calendar/events", input),
    update: (eventId, input) => httpPut(`/calendar/events/${encodeURIComponent(eventId)}`, input),
    createCategory: (input) => httpPost("/calendar/categories", input),
    updateCategory: (categoryId, input) => httpPut(`/calendar/categories/${encodeURIComponent(categoryId)}`, input),
    reorderCategories: (categoryIds) => httpPut("/calendar/categories/order", { categoryIds }),
    deleteCategory: (categoryId, replacementCategoryId) =>
      httpDelete(`/calendar/categories/${encodeURIComponent(categoryId)}`, { replacementCategoryId }),
  };
}
