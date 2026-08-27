use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;

// API 서버는 모든 화면의 데이터 원본이다(architecture-decisions.md §9) - 없이는 앱이
// 빈 화면·연결 오류만 보여준다. release exe는 Node 런타임 + 번들된 API + better-sqlite3
// 네이티브 바이너리를 하나의 zip으로 통째로 임베드하고(scripts/build-api-sidecar.ps1이
// 채운다), 첫 실행 때 앱 데이터 폴더 밑 sidecar/ 로 풀어 자식 프로세스로 띄운다. 덕분에
// 배포물은 exe 파일 하나면 된다. 개발 모드는 건드리지 않는다 - hot reload가 있는
// `npm run dev --workspace @mono/api`를 그대로 쓴다.
//
// ponytail: ~50MB Node 런타임을 exe에 임베드하고 appdata로 1회 추출한다. exe 크기가
// 문제되면 API를 Rust(axum + rusqlite)로 재작성하는 게 정공법.
const SIDECAR_ZIP: &[u8] = include_bytes!("../sidecar.zip");

pub struct ApiSidecar(Mutex<Option<Child>>);

impl ApiSidecar {
    pub fn spawn(db_path: &Path, secret_key_path: &Path, sidecar_directory: &Path) -> Self {
        if cfg!(debug_assertions) {
            return Self(Mutex::new(None));
        }
        match try_spawn(db_path, secret_key_path, sidecar_directory) {
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

fn try_spawn(
    db_path: &Path,
    secret_key_path: &Path,
    sidecar_directory: &Path,
) -> Result<Child, String> {
    ensure_extracted(sidecar_directory)?;

    let node = sidecar_directory.join("node.exe");
    let server = sidecar_directory.join("server.cjs");
    if !node.exists() || !server.exists() {
        return Err(format!("sidecar 파일이 없습니다: {}", sidecar_directory.display()));
    }

    let mut command = Command::new(&node);
    command
        .arg(&server)
        .current_dir(sidecar_directory)
        // 임베드 Rust 서버(mod api)가 4174를 점유한다 — 이 sidecar는 아직 포팅 안 된
        // 라우트만 처리하는 내부 업스트림이라 4175로 띄우고 proxy.rs가 넘긴다.
        .env("PORT", "4175")
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

// 임베드된 zip을 sidecar/ 로 1회 추출한다. zip 바이트 길이를 지문 삼아 .bundle-id 에
// 적어 두고, 다음 실행 때 값이 같고 핵심 파일이 있으면 건너뛴다(앱 업데이트 시 자동 갱신).
fn ensure_extracted(sidecar_directory: &Path) -> Result<(), String> {
    let marker = sidecar_directory.join(".bundle-id");
    let bundle_id = SIDECAR_ZIP.len().to_string();
    let up_to_date = std::fs::read_to_string(&marker).map(|v| v == bundle_id).unwrap_or(false)
        && sidecar_directory.join("node.exe").exists()
        && sidecar_directory.join("server.cjs").exists();
    if up_to_date {
        return Ok(());
    }

    let _ = std::fs::remove_dir_all(sidecar_directory);
    std::fs::create_dir_all(sidecar_directory)
        .map_err(|error| format!("sidecar 디렉터리 생성 실패: {error}"))?;

    let mut archive = zip::ZipArchive::new(Cursor::new(SIDECAR_ZIP))
        .map_err(|error| format!("임베드된 sidecar zip 열기 실패: {error}"))?;
    archive
        .extract(PathBuf::from(sidecar_directory))
        .map_err(|error| format!("sidecar 추출 실패: {error}"))?;

    std::fs::write(&marker, &bundle_id)
        .map_err(|error| format!("sidecar 버전 표식 기록 실패: {error}"))?;
    Ok(())
}
