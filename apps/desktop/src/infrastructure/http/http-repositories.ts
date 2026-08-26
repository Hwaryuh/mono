import type { PlatformRepositories } from "../sqlite/sqlite-repositories";
import { createHttpCalendarRepository } from "./http-calendar-repository";
import { createHttpDashboardRepository } from "./http-dashboard-repository";
import { createHttpInboxRepository } from "./http-inbox-repository";
import { createHttpLedgerRepository } from "./http-ledger-repository";
import { createHttpRoutineRepository } from "./http-routine-repository";
import { createHttpScrapRepository } from "./http-scrap-repository";
import { createHttpTodoRepository } from "./http-todo-repository";

export type { PlatformRepositories };

export function createHttpRepositories(): PlatformRepositories {
  return {
    dashboardRepository: createHttpDashboardRepository(),
    inboxRepository: createHttpInboxRepository(),
    todoRepository: createHttpTodoRepository(),
    routineRepository: createHttpRoutineRepository(),
    calendarRepository: createHttpCalendarRepository(),
    scrapRepository: createHttpScrapRepository(),
    ledgerRepository: createHttpLedgerRepository(),
  };
}
