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

  it("Tauri 안에서는 start/stop 이 네이티브 명령을 부른다", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const alarm = createAlarm();

    alarm.start();
    await flush();
    expect(core.invoke).toHaveBeenCalledWith("alarm_start");

    alarm.stop();
    await flush();
    expect(core.invoke).toHaveBeenCalledWith("alarm_stop");
  });

  it("Tauri 밖에서는 아무것도 하지 않는다", async () => {
    const alarm = createAlarm();
    alarm.start();
    alarm.stop();
    await flush();

    expect(core.invoke).not.toHaveBeenCalled();
  });
});
