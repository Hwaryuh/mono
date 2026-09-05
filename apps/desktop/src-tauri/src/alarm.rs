//! Timer alarm. Loops the alarm sound indefinitely until the user turns it off after a session ends.
//!
//! Plays directly to OS audio via rodio — unlike the webview's `<audio>`, it keeps
//! ringing even when the window is minimized or hidden. Since `OutputStream` is `!Send` and can't be stored in Tauri state,
//! a dedicated thread owns the stream and only receives commands over a channel.

use std::io::Cursor;
use std::sync::mpsc::{self, Sender};
use std::thread;

use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};

/// The alarm sound. Embedded in the binary to avoid resolving a resource path (~128KB).
static ALARM_MP3: &[u8] = include_bytes!("../assets/alarm.mp3");

enum Cmd {
    Start,
    Stop,
}

/// Tauri managed state. Only sends commands to the audio thread.
pub struct Alarm {
    tx: Sender<Cmd>,
}

impl Alarm {
    pub fn spawn() -> Alarm {
        let (tx, rx) = mpsc::channel::<Cmd>();
        thread::spawn(move || {
            // Opens the output stream on the first alarm — this avoids waking the audio device for sessions that never ring.
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
                                // Skips if there's no output device. The OS notification banner serves as the backup signal.
                                Ok(opened) => stream.insert(opened),
                                Err(_) => continue,
                            },
                        };
                        let Ok(decoder) = Decoder::try_from(Cursor::new(ALARM_MP3)) else {
                            continue;
                        };
                        let new_sink = Sink::connect_new(stream.mixer());
                        // buffered(): reuses the once-decoded samples to loop seamlessly.
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
