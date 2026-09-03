import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAlarm } from "./timer-alarm";

class FakeSource {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  connect() {}
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    if (!this.started) throw new Error("not started");
    this.stopped = true;
  }
}

class FakeCtx {
  static sources: FakeSource[] = [];
  static decodeCalls = 0;
  state: "running" | "suspended" = "suspended";
  createBufferSource() {
    const s = new FakeSource();
    FakeCtx.sources.push(s);
    return s;
  }
  createOscillator() {
    return { frequency: {}, connect: () => ({ connect: () => {} }), start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) };
  }
  get currentTime() {
    return 0;
  }
  decodeAudioData() {
    FakeCtx.decodeCalls += 1;
    return Promise.resolve({ sampleRate: 48000 });
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAlarm", () => {
  beforeEach(() => {
    FakeCtx.sources = [];
    FakeCtx.decodeCalls = 0;
    vi.stubGlobal("AudioContext", FakeCtx);
    vi.stubGlobal("fetch", () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("디코드한 버퍼를 loop 로 재생하고 stop 이 멈춘다", async () => {
    const alarm = createAlarm();
    alarm.start();
    await flush();

    expect(FakeCtx.sources).toHaveLength(1);
    expect(FakeCtx.sources[0].loop).toBe(true);
    expect(FakeCtx.sources[0].started).toBe(true);

    alarm.stop();
    expect(FakeCtx.sources[0].stopped).toBe(true);
  });

  it("start 를 연달아 불러도 소스는 하나만 만든다", async () => {
    const alarm = createAlarm();
    alarm.start();
    alarm.start();
    await flush();

    expect(FakeCtx.sources).toHaveLength(1);
    alarm.stop();
  });

  it("stop 뒤 다시 start 하면 다시 디코드 없이 새 소스로 운다", async () => {
    const alarm = createAlarm();
    alarm.start();
    await flush();
    alarm.stop();
    alarm.start();
    await flush();

    expect(FakeCtx.decodeCalls).toBe(1);
    expect(FakeCtx.sources).toHaveLength(2);
    expect(FakeCtx.sources[1].started).toBe(true);
    alarm.stop();
  });

  it("파일을 못 읽으면 비프음으로 대체한다", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const alarm = createAlarm();
    alarm.start();
    await flush();

    // 버퍼 소스는 못 만들지만 죽지 않는다.
    expect(FakeCtx.sources).toHaveLength(0);
    alarm.stop();
  });
});
