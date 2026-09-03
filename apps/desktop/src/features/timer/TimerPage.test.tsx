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

  it("설정한 집중 길이로 시작하고 흘려보낸 만큼 줄어든다", () => {
    renderTimer({ focusMinutes: 2 });
    expect(screen.getByText("02:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("큰 숫자를 눌러 집중 길이를 직접 입력한다", () => {
    const { settingsStore } = renderTimer({ focusMinutes: 25 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분)");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.blur(input);

    expect(screen.getByText("40:00")).toBeInTheDocument();
    expect(settingsStore.read().focusMinutes).toBe(40);
  });

  it("범위를 벗어난 입력은 경계로 잘라낸다", () => {
    const { settingsStore } = renderTimer({ focusMinutes: 25 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분)");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);

    expect(settingsStore.read().focusMinutes).toBe(180);
  });

  it("일시정지 중에도 길이를 고칠 수 있다", () => {
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

  it("카운트다운 중에는 숫자를 편집할 수 없다", () => {
    renderTimer({ focusMinutes: 2 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(1_000); });

    expect(screen.queryByLabelText("세션 길이(분)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("집중이 끝나면 알람이 울리고, 끄기 전에는 새 집중으로 돌아가지 않는다", () => {
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

  it("알람이 꺼져 있으면 곧바로 새 집중으로 돌아간다", () => {
    const { alarm } = renderTimer({ focusMinutes: 1, alarmEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(alarm.start).not.toHaveBeenCalled();
    expect(screen.getByText("01:00")).toBeInTheDocument();
  });

  it("건너뛰기는 세션을 기록하지 않는다", () => {
    const { sessionStore } = renderTimer({ focusMinutes: 1 });
    fireEvent.click(screen.getByRole("button", { name: "세션 건너뛰기" }));

    expect(sessionStore.read(currentIsoDate())).toHaveLength(0);
  });

  it("고른 할 일에 세션이 붙는다", async () => {
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
