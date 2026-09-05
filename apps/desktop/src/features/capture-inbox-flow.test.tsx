import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { createMockDashboardRepository } from "../infrastructure/mock/mock-dashboard-repository";
import { createMockCalendarRepository } from "../infrastructure/mock/mock-calendar-repository";
import { createMockInboxRepository } from "../infrastructure/mock/mock-inbox-repository";
import { createMockLedgerRepository } from "../infrastructure/mock/mock-ledger-repository";
import { createMockPlatformState } from "../infrastructure/mock/mock-platform-state";
import { createMockScrapRepository } from "../infrastructure/mock/mock-scrap-repository";
import { createMockTodoRepository } from "../infrastructure/mock/mock-todo-repository";
import { DashboardPage } from "./dashboard/DashboardPage";
import { InboxPage } from "./inbox/InboxPage";

describe("quick capture to inbox flow", () => {
  it("reflects the captured original text and pending count on the inbox screen", async () => {
    const state = createMockPlatformState();
    const dashboardRepository = createMockDashboardRepository(state);
    const calendarRepository = createMockCalendarRepository(state);
    const inboxRepository = createMockInboxRepository(state);
    const ledgerRepository = createMockLedgerRepository(state);
    const scrapRepository = createMockScrapRepository(state);
    const todoRepository = createMockTodoRepository(state);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="dashboard" element={<DashboardPage repository={dashboardRepository} scrapRepository={scrapRepository} />} />
            <Route path="inbox" element={<InboxPage calendarRepository={calendarRepository} ledgerRepository={ledgerRepository} repository={inboxRepository} scrapRepository={scrapRepository} todoRepository={todoRepository} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = await screen.findByRole("textbox", { name: "빠른 캡처" });

    fireEvent.change(input, { target: { value: "분기 보고서 초안 검토" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByRole("link", { name: /수집함 5건 대기/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("link", { name: /수집함 5건 대기/ }));

    expect((await screen.findAllByText("분기 보고서 초안 검토")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /대기 5/ })).toBeInTheDocument();
  });
});
