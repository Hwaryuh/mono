import { currentIsoDate } from "@mono/domain";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  render(
    <I18nProvider>
      <TimerPage sessionStore={sessionStore} settingsStore={settingsStore} alarm={alarm} />
    </I18nProvider>,
  );
  return { sessionStore, settingsStore, alarm };
}

describe("TimerPage", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("starts at the configured focus duration and counts down as time elapses", () => {
    renderTimer({ focusSeconds: 120 });
    expect(screen.getByText("02:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("taps the large number to directly enter the focus duration", () => {
    const { settingsStore } = renderTimer({ focusSeconds: 1500 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분:초)");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.blur(input);

    expect(screen.getByText("40:00")).toBeInTheDocument();
    expect(settingsStore.read().focusSeconds).toBe(2400);
  });

  it("accepts a M:SS duration down to the second", () => {
    const { settingsStore } = renderTimer({ focusSeconds: 1500 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분:초)");
    fireEvent.change(input, { target: { value: "1:30" } });
    fireEvent.blur(input);

    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(settingsStore.read().focusSeconds).toBe(90);
  });

  it("clamps an out-of-range input to the boundary", () => {
    const { settingsStore } = renderTimer({ focusSeconds: 1500 });

    fireEvent.click(screen.getByRole("button", { name: "25:00" }));
    const input = screen.getByLabelText("세션 길이(분:초)");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);

    expect(settingsStore.read().focusSeconds).toBe(180 * 60);
  });

  it("allows editing the duration even while paused", () => {
    const { settingsStore } = renderTimer({ focusSeconds: 120 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(screen.getByRole("button", { name: /일시정지/ }));

    fireEvent.click(screen.getByRole("button", { name: "01:30" }));
    const input = screen.getByLabelText("세션 길이(분:초)");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);

    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(settingsStore.read().focusSeconds).toBe(600);
  });

  it("does not allow editing the number while counting down", () => {
    renderTimer({ focusSeconds: 120 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(1_000); });

    expect(screen.queryByLabelText("세션 길이(분:초)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("sounds the alarm when focus ends and does not return to a new focus session until it's turned off", () => {
    const { sessionStore, alarm } = renderTimer({ focusSeconds: 60 });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(alarm.start).toHaveBeenCalled();
    expect(sessionStore.read(currentIsoDate())).toHaveLength(1);
    expect(screen.getByText("00:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "알람 끄기" }));

    expect(alarm.stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "01:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^시작$/ })).toBeInTheDocument();
  });

  it("returns immediately to a new focus session when the alarm is off", () => {
    const { alarm } = renderTimer({ focusSeconds: 60, alarmEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(alarm.start).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "01:00" })).toBeInTheDocument();
  });

  it("does not record a session when skipping", () => {
    const { sessionStore } = renderTimer({ focusSeconds: 60 });
    fireEvent.click(screen.getByRole("button", { name: "세션 건너뛰기" }));

    expect(sessionStore.read(currentIsoDate())).toHaveLength(0);
  });

  it("records a finished focus session in the history", () => {
    const { sessionStore } = renderTimer({ focusSeconds: 60, alarmEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: /시작/ }));
    act(() => { vi.advanceTimersByTime(61_000); });

    expect(sessionStore.read(currentIsoDate())).toHaveLength(1);
  });
});
