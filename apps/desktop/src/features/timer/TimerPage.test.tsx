import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTodoRepository } from "../../infrastructure/mock/mock-todo-repository";
import { I18nProvider } from "../../i18n/i18n";
import { InMemoryTimerSessionStore } from "./timer-session-store";
import { InMemoryTimerSettingsStore, type TimerSettings } from "./timer-settings-store";
import { TimerPage } from "./TimerPage";

function renderTimer(settings?: Partial<TimerSettings>) {
  const sessionStore = new InMemoryTimerSessionStore();
  const settingsStore = new InMemoryTimerSettingsStore();
  if (settings) settingsStore.write({ ...settingsStore.read(), ...settings });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TimerPage repository={createMockTodoRepository()} sessionStore={sessionStore} settingsStore={settingsStore} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { sessionStore };
}

describe("TimerPage", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("설정한 집중 길이로 시작하고 흘려보낸 만큼 줄어든다", () => {
    renderTimer({ focusMinutes: 2 });
    expect(screen.getByText("02:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("집중이 끝나면 세션을 기록하고 휴식으로 넘어간다", () => {
    const { sessionStore } = renderTimer({ focusMinutes: 1, shortBreakMinutes: 3, autoStartBreak: false });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(screen.getByText("03:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^시작$/ })).toBeInTheDocument();
    expect(sessionStore.read(new Date().toISOString().slice(0, 10))).toHaveLength(1);
  });

  it("건너뛰기는 세션을 기록하지 않는다", () => {
    const { sessionStore } = renderTimer({ focusMinutes: 1 });
    fireEvent.click(screen.getByRole("button", { name: "세션 건너뛰기" }));

    expect(sessionStore.read(new Date().toISOString().slice(0, 10))).toHaveLength(0);
  });

  it("고른 할 일에 세션이 붙는다", async () => {
    const { sessionStore } = renderTimer({ focusMinutes: 1 });
    const tasks = await screen.findAllByRole("button", { pressed: false });
    const target = tasks.find((task) => task.classList.contains("timer-task"))!;
    fireEvent.click(target);
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    const [session] = sessionStore.read(new Date().toISOString().slice(0, 10));
    expect(session.todoId).not.toBeNull();
    expect(within(target).getByText("1세션")).toBeInTheDocument();
  });
});
