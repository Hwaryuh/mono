import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAlarm } from "./timer-alarm";

class FakeAudio {
  static instances: FakeAudio[] = [];
  loop = false;
  paused = true;
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

describe("createAlarm", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("네이티브 loop 로 한 번만 재생하고, stop 이 멈춘다", async () => {
    const alarm = createAlarm();
    alarm.start();
    await Promise.resolve();

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].loop).toBe(true);
    expect(FakeAudio.instances[0].paused).toBe(false);

    alarm.stop();
    expect(FakeAudio.instances[0].paused).toBe(true);
  });

  it("start 를 연달아 불러도 오디오는 하나만 만든다", async () => {
    const alarm = createAlarm();
    alarm.start();
    alarm.start();
    await Promise.resolve();

    expect(FakeAudio.instances).toHaveLength(1);
    alarm.stop();
  });

  it("stop 뒤 다시 start 하면 새로 울린다", async () => {
    const alarm = createAlarm();
    alarm.start();
    await Promise.resolve();
    alarm.stop();
    alarm.start();
    await Promise.resolve();

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[1].paused).toBe(false);
    alarm.stop();
  });
});
