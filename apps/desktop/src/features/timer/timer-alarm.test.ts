import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => core);

import { createAlarm } from "./timer-alarm";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAlarm", () => {
  beforeEach(() => core.invoke.mockClear());
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("inside Tauri, start/stop invoke the native commands", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const alarm = createAlarm();

    alarm.start();
    await flush();
    expect(core.invoke).toHaveBeenCalledWith("alarm_start");

    alarm.stop();
    await flush();
    expect(core.invoke).toHaveBeenCalledWith("alarm_stop");
  });

  it("does nothing outside Tauri", async () => {
    const alarm = createAlarm();
    alarm.start();
    alarm.stop();
    await flush();

    expect(core.invoke).not.toHaveBeenCalled();
  });
});
