use std::path::Path;
use std::process::{Child, Command};
use std::sync::Mutex;

// API 서버는 모든 화면의 데이터 원본이다(architecture-decisions.md §9) - 없이는 앱이
// 빈 화면·연결 오류만 보여준다. release 빌드에서는 exe 옆의 sidecar 폴더(scripts/
// build-api-sidecar.ps1이 채워 넣는 node.exe + 번들된 API + better-sqlite3 네이티브
// 바이너리)를 자식 프로세스로 띄운다. 개발 모드는 건드리지 않는다 - hot reload가 있는
// `npm run dev --workspace @mono/api`를 그대로 쓴다.
pub struct ApiSidecar(Mutex<Option<Child>>);

impl ApiSidecar {
    pub fn spawn(db_path: &Path, secret_key_path: &Path) -> Self {
        if cfg!(debug_assertions) {
            return Self(Mutex::new(None));
        }
        match try_spawn(db_path, secret_key_path) {
            Ok(child) => Self(Mutex::new(Some(child))),
            Err(error) => {
                eprintln!("API 서버 자동 실행 실패: {error} - 화면에 연결 오류가 뜰 수 있습니다.");
                Self(Mutex::new(None))
            }
        }
    }

    /// 창을 닫을 때 등 앱 종료 시 호출한다. 안 부르면 node.exe가 고아 프로세스로 남아
    /// SQLite WAL 파일을 계속 붙잡는다.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.0.lock() else { return };
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
}

fn try_spawn(db_path: &Path, secret_key_path: &Path) -> Result<Child, String> {
    let exe_directory = std::env::current_exe()
        .map_err(|error| format!("실행 파일 경로 확인 실패: {error}"))?
        .parent()
        .ok_or("실행 파일 상위 경로를 확인할 수 없습니다")?
        .to_path_buf();
    let sidecar_directory = exe_directory.join("sidecar");
    let node = sidecar_directory.join("node.exe");
    let server = sidecar_directory.join("server.cjs");
    if !node.exists() || !server.exists() {
        return Err(format!("sidecar 파일이 없습니다: {}", sidecar_directory.display()));
    }

    let mut command = Command::new(&node);
    command
        .arg(&server)
        .current_dir(&sidecar_directory)
        .env("PORT", "4174")
        .env("MONO_DB_PATH", db_path)
        .env("MONO_SECRET_KEY_PATH", secret_key_path);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn().map_err(|error| format!("node.exe 실행 실패: {error}"))
}
