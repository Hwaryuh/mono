import type { CalendarRepository } from "../../features/calendar/calendar-repository";
import type { DayRepository } from "../../features/day/day-repository";
import type { DashboardRepository } from "../../features/dashboard/dashboard-repository";
import type { InboxRepository } from "../../features/inbox/inbox-repository";
import type { LedgerRepository } from "../../features/ledger/ledger-repository";
import type { RoutineRepository } from "../../features/routine/routine-repository";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";
import type { TodoRepository } from "../../features/todo/todo-repository";
import { createHttpCalendarRepository } from "./http-calendar-repository";
import { createHttpDayRepository } from "./http-day-repository";
import { createHttpDashboardRepository } from "./http-dashboard-repository";
import { createHttpInboxRepository } from "./http-inbox-repository";
import { createHttpLedgerRepository } from "./http-ledger-repository";
import { createHttpRoutineRepository } from "./http-routine-repository";
import { createHttpScrapRepository } from "./http-scrap-repository";
import { createHttpTodoRepository } from "./http-todo-repository";

export type PlatformRepositories = {
  dashboardRepository: DashboardRepository;
  inboxRepository: InboxRepository;
  todoRepository: TodoRepository;
  routineRepository: RoutineRepository;
  calendarRepository: CalendarRepository;
  scrapRepository: ScrapRepository;
  ledgerRepository: LedgerRepository;
  dayRepository: DayRepository;
};

export function createHttpRepositories(): PlatformRepositories {
  return {
    dashboardRepository: createHttpDashboardRepository(),
    inboxRepository: createHttpInboxRepository(),
    todoRepository: createHttpTodoRepository(),
    routineRepository: createHttpRoutineRepository(),
    calendarRepository: createHttpCalendarRepository(),
    scrapRepository: createHttpScrapRepository(),
    ledgerRepository: createHttpLedgerRepository(),
    dayRepository: createHttpDayRepository(),
  };
}
