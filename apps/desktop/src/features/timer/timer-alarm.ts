/** 페이즈가 끝나면 사용자가 끌 때까지 계속 울리는 알람. 파일이 없거나 재생이 막히면 비프음으로 대체한다. */
export interface Alarm {
  start(): void;
  stop(): void;
}

export function createAlarm(src = "/alarm.mp3"): Alarm {
  let audio: HTMLAudioElement | null = null;
  let ctx: AudioContext | null = null;
  let beep: ReturnType<typeof setInterval> | null = null;
  let stopped = true;

  function synth() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || ctx) return;
    ctx = new Ctor();
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

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      const el = new Audio(src);
      // 네이티브 loop 에 맡긴다. 벽시계 setInterval 로 되감으면 play() 지연·디코드 멈춤·
      // 백그라운드 스로틀에 밀려 클립이 겹치거나("두 번 연속") 한참 비게 된다.
      el.loop = true;
      audio = el;
      Promise.resolve(el.play())
        .then(() => {
          if (stopped) el.pause();
        })
        .catch(() => {
          if (!stopped) synth();
        });
    },
    stop() {
      stopped = true;
      audio?.pause();
      audio = null;
      if (beep) {
        clearInterval(beep);
        beep = null;
      }
      void ctx?.close();
      ctx = null;
    },
  };
}
