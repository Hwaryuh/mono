/** 세션이 끝나면 사용자가 끌 때까지 이어서 울리는 알람. 파일을 못 읽으면 비프음으로 대체한다. */
export interface Alarm {
  start(): void;
  stop(): void;
}

export function createAlarm(src = "/alarm.mp3"): Alarm {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let buffer: AudioBuffer | null = null;
  let beep: ReturnType<typeof setInterval> | null = null;
  let stopped = true;

  // 파일을 못 쓸 때만 도는 880Hz 짧은 핑.
  function synth() {
    if (!ctx || beep) return;
    const ping = () => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    };
    ping();
    beep = setInterval(ping, 900);
  }

  function play() {
    if (!ctx || stopped || source || beep) return;
    if (!buffer) {
      synth();
      return;
    }
    // AudioBufferSourceNode.loop 은 샘플 단위로 이어 붙는다 — <audio loop> 의 mp3 이음매 갭이 없다.
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(ctx.destination);
    source.start();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (!Ctor) return;
      ctx ??= new Ctor();
      void ctx.resume();
      if (buffer) {
        play();
        return;
      }
      fetch(src)
        .then((res) => res.arrayBuffer())
        .then((bytes) => ctx!.decodeAudioData(bytes))
        .then((decoded) => {
          buffer = decoded;
          play();
        })
        .catch(() => {
          if (!stopped) synth();
        });
    },
    stop() {
      stopped = true;
      try {
        source?.stop();
      } catch {
        // 아직 start 전이면 무시.
      }
      source?.disconnect();
      source = null;
      if (beep) {
        clearInterval(beep);
        beep = null;
      }
      void ctx?.suspend();
    },
  };
}
