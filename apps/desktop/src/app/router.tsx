import { createHashRouter, Navigate } from "react-router";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { CalendarPage } from "../features/calendar/CalendarPage";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { InboxPage } from "../features/inbox/InboxPage";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import { LedgerPage } from "../features/ledger/LedgerPage";
import type { LedgerRepository } from "../features/ledger/ledger-repository";
import { RoutinePage } from "../features/routine/RoutinePage";
import type { RoutineRepository } from "../features/routine/routine-repository";
import { ScrapPage } from "../features/scrap/ScrapPage";
import type { ScrapRepository } from "../features/scrap/scrap-repository";
import { TodoPage } from "../features/todo/TodoPage";
import type { TodoRepository } from "../features/todo/todo-repository";
import { AppShell } from "../shell/AppShell";
import { RouteErrorScreen } from "./RouteErrorScreen";
import { InMemoryAiSettingsStore, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";

export function createAppRouter(dashboardRepository: DashboardRepository, inboxRepository: InboxRepository, todoRepository: TodoRepository, routineRepository: RoutineRepository, calendarRepository: CalendarRepository, scrapRepository: ScrapRepository, ledgerRepository: LedgerRepository, aiSettingsStore: AiSettingsStore = new InMemoryAiSettingsStore()) {
  return createHashRouter([
    {
      path: "/",
      element: <AppShell aiSettingsStore={aiSettingsStore} calendarRepository={calendarRepository} dashboardRepository={dashboardRepository} inboxRepository={inboxRepository} routineRepository={routineRepository} todoRepository={todoRepository} />,
      errorElement: <RouteErrorScreen />,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <DashboardPage repository={dashboardRepository} /> },
        { path: "inbox", element: <InboxPage calendarRepository={calendarRepository} ledgerRepository={ledgerRepository} repository={inboxRepository} scrapRepository={scrapRepository} todoRepository={todoRepository} /> },
        { path: "todo", element: <TodoPage repository={todoRepository} /> },
        { path: "routine", element: <RoutinePage repository={routineRepository} todoRepository={todoRepository} /> },
        { path: "calendar", element: <CalendarPage repository={calendarRepository} /> },
        { path: "scrap", element: <ScrapPage repository={scrapRepository} /> },
        { path: "ledger", element: <LedgerPage repository={ledgerRepository} /> },
      ],
    },
  ]);
}
