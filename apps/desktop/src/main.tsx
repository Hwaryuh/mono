if (import.meta.env.DEV) {
  import("react-grab");
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createAppRouter } from "./app/router";
import { createHttpRepositories } from "./infrastructure/http/http-repositories";
import { PlatformApiEndpointProvider } from "./infrastructure/http/api-endpoint";
import { API_BASE_URL, configureApiBaseUrl, configureApiToken } from "./infrastructure/http/http-client";
import { SseRealtimeChangeSource } from "./infrastructure/realtime/realtime-change-source";
import { RealtimeQuerySync } from "./infrastructure/realtime/realtime-query-sync";
import { HttpAiSettingsStore } from "./infrastructure/http/http-ai-settings-store";
import { HttpMediaMaintenance } from "./infrastructure/http/http-media-maintenance";
import { HttpMediaStore } from "./infrastructure/http/http-media-store";
import { HttpR2SettingsStore } from "./infrastructure/http/http-r2-settings-store";
import { TauriServerSettingsStore } from "./infrastructure/server/tauri-server-settings-store";
import { MediaStoreProvider } from "./infrastructure/media/media-store-context";
import { AppUpdater } from "./features/updater/AppUpdater";
import { I18nProvider, translate } from "./i18n/i18n";
import "@mono/ui/tokens.css";
import "@mono/ui/styles.css";
import "./styles/global.css";

const mediaStore = new HttpMediaStore();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // networkMode "always": 서버는 항상 localhost. 브라우저 navigator.onLine 오탐으로
      // 쿼리가 "paused" 상태로 멈춰 오류 화면이 뜨지 않는 것을 막는다.
      networkMode: "always",
    },
    mutations: {
      networkMode: "always",
    },
  },
});

async function start() {
  const endpoint = PlatformApiEndpointProvider.of();
  configureApiBaseUrl(await endpoint.resolve());
  configureApiToken(await endpoint.resolveToken());
  const stopRealtimeSync = RealtimeQuerySync.of(
    queryClient,
    SseRealtimeChangeSource.of(`${API_BASE_URL}/events`),
  ).start();
  window.addEventListener("beforeunload", stopRealtimeSync, { once: true });
  const {
    dashboardRepository,
    inboxRepository,
    todoRepository,
    routineRepository,
    calendarRepository,
    scrapRepository,
    ledgerRepository,
  } = createHttpRepositories();
  const router = createAppRouter(
    dashboardRepository, inboxRepository, todoRepository, routineRepository, calendarRepository, scrapRepository, ledgerRepository,
    new HttpAiSettingsStore(), new HttpMediaMaintenance(), new HttpR2SettingsStore(), new TauriServerSettingsStore(),
  );

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <MediaStoreProvider value={mediaStore}>
            <RouterProvider router={router} />
            <AppUpdater />
          </MediaStoreProvider>
        </I18nProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const root = document.getElementById("root");
  if (root) root.textContent = translate("app.error.bootstrap", { message });
  console.error(error);
});
