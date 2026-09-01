import { InMemoryViewStateStore, type ViewStateStore } from "../../app/view-state-store";

export type CalendarView = "month" | "agenda";
export type CalendarViewState = { view: CalendarView; visibleMonth: string };
export type CalendarViewStateStore = ViewStateStore<CalendarViewState>;

export function calendarViewStateStoreOf(initialMonth = currentMonth()): CalendarViewStateStore {
  return InMemoryViewStateStore.of({ view: "month", visibleMonth: initialMonth });
}

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
