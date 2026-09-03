//! 타이머 알람. 세션이 끝나면 사용자가 끌 때까지 알람음을 무한 루프한다.
//!
//! rodio 로 OS 오디오에 직접 재생한다 — 웹뷰의 `<audio>` 와 달리 창이 최소화되거나
//! 가려져도 계속 울린다. `OutputStream` 은 `!Send` 라 Tauri state 에 못 두므로,
//! 전용 스레드가 스트림을 소유하고 채널로 명령만 받는다.

use std::io::Cursor;
use std::sync::mpsc::{self, Sender};
use std::thread;

use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};

/// 알람음. 바이너리에 박아 리소스 경로 해석을 없앤다(≈128KB).
static ALARM_MP3: &[u8] = include_bytes!("../assets/alarm.mp3");

enum Cmd {
    Start,
    Stop,
}

/// Tauri managed state. 오디오 스레드로 명령만 보낸다.
pub struct Alarm {
    tx: Sender<Cmd>,
}

impl Alarm {
    pub fn spawn() -> Alarm {
        let (tx, rx) = mpsc::channel::<Cmd>();
        thread::spawn(move || {
            // 출력 스트림은 첫 알람 때 연다 — 알람을 안 울리는 세션에서 오디오 장치를 깨우지 않는다.
            let mut stream: Option<OutputStream> = None;
            let mut sink: Option<Sink> = None;
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    Cmd::Start => {
                        if sink.is_some() {
                            continue;
                        }
                        let stream = match &mut stream {
                            Some(stream) => stream,
                            None => match OutputStreamBuilder::open_default_stream() {
                                // 출력 장치가 없으면 넘어간다. OS 알림 배너가 백업 신호.
                                Ok(opened) => stream.insert(opened),
                                Err(_) => continue,
                            },
                        };
                        let Ok(decoder) = Decoder::try_from(Cursor::new(ALARM_MP3)) else {
                            continue;
                        };
                        let new_sink = Sink::connect_new(stream.mixer());
                        // buffered(): 한 번 디코드한 샘플을 재사용해 이음매 없이 반복한다.
                        new_sink.append(decoder.buffered().repeat_infinite());
                        sink = Some(new_sink);
                    }
                    Cmd::Stop => {
                        if let Some(sink) = sink.take() {
                            sink.stop();
                        }
                    }
                }
            }
        });
        Alarm { tx }
    }
}

#[tauri::command]
pub fn alarm_start(state: tauri::State<'_, Alarm>) {
    let _ = state.tx.send(Cmd::Start);
}

#[tauri::command]
pub fn alarm_stop(state: tauri::State<'_, Alarm>) {
    let _ = state.tx.send(Cmd::Stop);
}
