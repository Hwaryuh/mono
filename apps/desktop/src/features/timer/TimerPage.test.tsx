import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { currentIsoDate } from "@mono/domain";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTodoRepository } from "../../infrastructure/mock/mock-todo-repository";
import { I18nProvider } from "../../i18n/i18n";
import type { Alarm } from "./timer-alarm";
import { InMemoryTimerSessionStore } from "./timer-session-store";
import { InMemoryTimerSettingsStore, type TimerSettings } from "./timer-settings-store";
import { TimerPage } from "./TimerPage";

function renderTimer(settings?: Partial<TimerSettings>) {
  const sessionStore = new InMemoryTimerSessionStore();
  const settingsStore = new InMemoryTimerSettingsStore();
  if (settings) settingsStore.write({ ...settingsStore.read(), ...settings });
  const alarm: Alarm = { start: vi.fn(), stop: vi.fn() };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TimerPage repository={createMockTodoRepository()} sessionStore={sessionStore} settingsStore={settingsStore} alarm={alarm} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { sessionStore, settingsStore, alarm };
}

describe("TimerPage", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("starts at the configured focus duration and counts down as time elapses", () => {
    renderTimer({ focusMinutes: 2 });
    expect(screen.getByText("02:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("taps the large number to directly enter the focus duration", () => {
    const { settingsStore } = renderTimer({ focusMinutes: 25 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분)");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.blur(input);

    expect(screen.getByText("40:00")).toBeInTheDocument();
    expect(settingsStore.read().focusMinutes).toBe(40);
  });

  it("clamps an out-of-range input to the boundary", () => {
    const { settingsStore } = renderTimer({ focusMinutes: 25 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분)");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);

    expect(settingsStore.read().focusMinutes).toBe(180);
  });

  it("allows editing the duration even while paused", () => {
    const { settingsStore } = renderTimer({ focusMinutes: 2 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(screen.getByRole("button", { name: /일시정지/ }));

    fireEvent.click(screen.getByRole("button", { name: "01:30" }));
    const input = screen.getByLabelText("세션 길이(분)");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);

    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(settingsStore.read().focusMinutes).toBe(10);
  });

  it("does not allow editing the number while counting down", () => {
    renderTimer({ focusMinutes: 2 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(1_000); });

    expect(screen.queryByLabelText("세션 길이(분)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("sounds the alarm when focus ends and does not return to a new focus session until it's turned off", () => {
    const { sessionStore, alarm } = renderTimer({ focusMinutes: 1 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(alarm.start).toHaveBeenCalled();
    expect(sessionStore.read(currentIsoDate())).toHaveLength(1);
    expect(screen.getByText("00:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "알람 끄기" }));

    expect(alarm.stop).toHaveBeenCalled();
    expect(screen.getByText("01:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^시작$/ })).toBeInTheDocument();
  });

  it("returns immediately to a new focus session when the alarm is off", () => {
    const { alarm } = renderTimer({ focusMinutes: 1, alarmEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(alarm.start).not.toHaveBeenCalled();
    expect(screen.getByText("01:00")).toBeInTheDocument();
  });

  it("does not record a session when skipping", () => {
    const { sessionStore } = renderTimer({ focusMinutes: 1 });
    fireEvent.click(screen.getByRole("button", { name: "세션 건너뛰기" }));

    expect(sessionStore.read(currentIsoDate())).toHaveLength(0);
  });

  it("attaches the session to the selected todo", async () => {
    const { sessionStore } = renderTimer({ focusMinutes: 1 });
    const tasks = await screen.findAllByRole("button", { pressed: false });
    const target = tasks.find((task) => task.classList.contains("timer-task"))!;
    fireEvent.click(target);
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    const [session] = sessionStore.read(currentIsoDate());
    expect(session.todoId).not.toBeNull();
    expect(within(target).getByText("1세션")).toBeInTheDocument();
  });
});
