import { createHashRouter, Navigate } from "react-router";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { CalendarPage } from "../features/calendar/CalendarPage";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import { calendarViewStateStoreOf } from "../features/calendar/calendar-view-state-store";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { InboxPage } from "../features/inbox/InboxPage";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import { inboxViewStateStoreOf } from "../features/inbox/inbox-view-state-store";
import { LedgerPage } from "../features/ledger/LedgerPage";
import type { LedgerRepository } from "../features/ledger/ledger-repository";
import { ledgerViewStateStoreOf } from "../features/ledger/ledger-view-state-store";
import { RoutinePage } from "../features/routine/RoutinePage";
import type { RoutineRepository } from "../features/routine/routine-repository";
import { ScrapPage } from "../features/scrap/ScrapPage";
import type { ScrapRepository } from "../features/scrap/scrap-repository";
import { scrapViewStateStoreOf } from "../features/scrap/scrap-view-state-store";
import { TimerPage } from "../features/timer/TimerPage";
import { TodoPage } from "../features/todo/TodoPage";
import type { TodoRepository } from "../features/todo/todo-repository";
import { todoViewStateStoreOf } from "../features/todo/todo-view-state-store";
import { AppShell } from "../shell/AppShell";
import { RouteErrorScreen } from "./RouteErrorScreen";
import { InMemoryAiSettingsStore, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";
import { InMemoryMediaMaintenance, type MediaMaintenance } from "../infrastructure/media/media-maintenance";
import { InMemoryR2SettingsStore, type R2SettingsStore } from "../infrastructure/media/r2-settings-store";
import type { ServerSettingsStore } from "../infrastructure/server/server-settings-store";
import { TauriServerSettingsStore } from "../infrastructure/server/tauri-server-settings-store";

export function createAppRouter(
  dashboardRepository: DashboardRepository, inboxRepository: InboxRepository, todoRepository: TodoRepository, routineRepository: RoutineRepository,
  calendarRepository: CalendarRepository, scrapRepository: ScrapRepository, ledgerRepository: LedgerRepository,
  aiSettingsStore: AiSettingsStore = new InMemoryAiSettingsStore(),
  mediaMaintenance: MediaMaintenance = new InMemoryMediaMaintenance(),
  r2SettingsStore: R2SettingsStore = new InMemoryR2SettingsStore(),
  serverSettingsStore: ServerSettingsStore = new TauriServerSettingsStore(),
) {
  const inboxViewStateStore = inboxViewStateStoreOf();
  const todoViewStateStore = todoViewStateStoreOf();
  const calendarViewStateStore = calendarViewStateStoreOf();
  const scrapViewStateStore = scrapViewStateStoreOf();
  const ledgerViewStateStore = ledgerViewStateStoreOf();
  return createHashRouter([
    {
      path: "/",
      element: <AppShell aiSettingsStore={aiSettingsStore} calendarRepository={calendarRepository} dashboardRepository={dashboardRepository} inboxRepository={inboxRepository} mediaMaintenance={mediaMaintenance} r2SettingsStore={r2SettingsStore} routineRepository={routineRepository} serverSettingsStore={serverSettingsStore} todoRepository={todoRepository} />,
      errorElement: <RouteErrorScreen />,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <DashboardPage repository={dashboardRepository} scrapRepository={scrapRepository} /> },
        { path: "inbox", element: <InboxPage calendarRepository={calendarRepository} ledgerRepository={ledgerRepository} repository={inboxRepository} scrapRepository={scrapRepository} todoRepository={todoRepository} viewStateStore={inboxViewStateStore} /> },
        { path: "todo", element: <TodoPage repository={todoRepository} scrapRepository={scrapRepository} viewStateStore={todoViewStateStore} /> },
        { path: "routine", element: <RoutinePage repository={routineRepository} todoRepository={todoRepository} /> },
        { path: "timer", element: <TimerPage repository={todoRepository} /> },
        { path: "calendar", element: <CalendarPage repository={calendarRepository} viewStateStore={calendarViewStateStore} /> },
        { path: "scrap", element: <ScrapPage repository={scrapRepository} viewStateStore={scrapViewStateStore} /> },
        { path: "ledger", element: <LedgerPage repository={ledgerRepository} viewStateStore={ledgerViewStateStore} /> },
      ],
    },
  ]);
}
