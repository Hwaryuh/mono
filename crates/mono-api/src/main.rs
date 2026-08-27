// standalone mono API 서버. 홈서버/NAS/VPS에서 실행해 여러 데스크톱이 같은 DB를 공유한다.
// 임베드 모드(Tauri `spawn()`)는 별개 — 이 바이너리 없이도 데스크톱은 단독 실행된다.
//
// 인증은 네트워크 레벨(Tailscale/WireGuard) 전제 — 앱 레벨 인증 없음.
// 0.0.0.0 바인드는 같은 네트워크의 누구나 데이터를 읽을 수 있다는 뜻이니 사설망 안에서만 노출할 것.
//
// env:
//   MONO_BIND_ADDR        기본 0.0.0.0:4174
//   MONO_DB_PATH          기본 ./mono.sqlite      (systemd WorkingDirectory 기준)
//   MONO_SECRET_KEY_PATH  기본 ./mono.secret.key  (비밀 복호화 마스터 키 — DB와 함께 백업/이관)
//   MONO_CORS_ORIGINS     콤마 구분. 없으면 데스크톱 앱 기본 origin 목록.
//
// ponytail: env 파싱 인라인, config 파일 없음. 옵션이 늘면 그때 clap/figment.

use std::path::PathBuf;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn main() {
    let config = mono_api::Config {
        bind_addr: env_or("MONO_BIND_ADDR", "0.0.0.0:4174"),
        db_path: PathBuf::from(env_or("MONO_DB_PATH", "mono.sqlite")),
        secret_key_path: PathBuf::from(env_or("MONO_SECRET_KEY_PATH", "mono.secret.key")),
        cors_origins: std::env::var("MONO_CORS_ORIGINS")
            .ok()
            .map(|s| {
                s.split(',').map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).collect()
            })
            .unwrap_or_default(),
    };
    eprintln!("mono-api: binding {}", config.bind_addr);
    mono_api::serve(config);
}
