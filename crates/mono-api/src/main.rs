// standalone mono API 서버. 홈서버/NAS/VPS에서 실행해 여러 데스크톱이 같은 DB를 공유한다.
// 인증은 네트워크 레벨(Tailscale/WireGuard) 전제 — 앱 레벨 인증 없음.
// 0.0.0.0 바인드는 같은 네트워크의 누구나 데이터를 읽을 수 있다는 뜻이니 사설망 안에서만 노출할 것.
//
// env:
//   MONO_BIND_ADDR        기본 0.0.0.0:4174
//   MONO_DB_PATH          기본 ./mono.sqlite
//   MONO_SECRET_KEY_PATH  기본 ./mono.secret.key
//   MONO_CORS_ORIGINS     콤마 구분. 없으면 데스크톱 앱 기본 origin 목록.

use std::path::PathBuf;
use std::process::ExitCode;

enum Command {
    Serve,
    Backup {
        destination: PathBuf,
        keep: Option<usize>,
    },
    Help,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn parse_command<I>(mut arguments: I) -> Result<Command, String>
where
    I: Iterator<Item = String>,
{
    match arguments.next().as_deref() {
        None | Some("serve") => Ok(Command::Serve),
        Some("--help" | "-h" | "help") => Ok(Command::Help),
        Some("backup") => {
            let destination = arguments
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| "backup 대상 디렉터리가 필요합니다.".to_string())?;
            let keep = match arguments.next().as_deref() {
                None => None,
                Some("--keep") => Some(
                    arguments
                        .next()
                        .ok_or_else(|| "--keep 뒤에 보존 개수가 필요합니다.".to_string())?
                        .parse::<usize>()
                        .map_err(|_| "백업 보존 개수는 양의 정수여야 합니다.".to_string())?,
                ),
                Some(argument) => return Err(format!("알 수 없는 backup 옵션입니다: {argument}")),
            };
            if arguments.next().is_some() {
                return Err("backup 인수가 너무 많습니다.".into());
            }
            Ok(Command::Backup { destination, keep })
        }
        Some(command) => Err(format!("알 수 없는 명령입니다: {command}")),
    }
}

fn print_help() {
    println!(
        "mono-api\n\nUSAGE:\n  mono-api [serve]\n  mono-api backup <directory> [--keep <count>]\n\nENV:\n  MONO_BIND_ADDR\n  MONO_DB_PATH\n  MONO_SECRET_KEY_PATH\n  MONO_CORS_ORIGINS"
    );
}

fn serve() -> Result<(), mono_api::ServeError> {
    let config = mono_api::Config {
        bind_addr: env_or("MONO_BIND_ADDR", "0.0.0.0:4174"),
        db_path: PathBuf::from(env_or("MONO_DB_PATH", "mono.sqlite")),
        secret_key_path: PathBuf::from(env_or("MONO_SECRET_KEY_PATH", "mono.secret.key")),
        cors_origins: std::env::var("MONO_CORS_ORIGINS")
            .ok()
            .map(|value| {
                value
                    .split(',')
                    .map(|origin| origin.trim().to_string())
                    .filter(|origin| !origin.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
    };
    eprintln!("mono-api: binding {}", config.bind_addr);
    mono_api::serve(config)
}

fn main() -> ExitCode {
    match parse_command(std::env::args().skip(1)) {
        Ok(Command::Serve) => {
            if let Err(error) = serve() {
                eprintln!("{error}");
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            }
        }
        Ok(Command::Backup { destination, keep }) => {
            let database_path = PathBuf::from(env_or("MONO_DB_PATH", "mono.sqlite"));
            let secret_key_path = PathBuf::from(env_or("MONO_SECRET_KEY_PATH", "mono.secret.key"));
            match mono_api::backup::create(&database_path, &secret_key_path, &destination, keep) {
                Ok(result) => {
                    println!(
                        "backup: {} (pruned {})",
                        result.directory.display(),
                        result.pruned
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("backup failed: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Ok(Command::Help) => {
            print_help();
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}\n");
            print_help();
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_backup_retention() {
        let command = parse_command(
            ["backup", "/var/backups/mono", "--keep", "14"]
                .into_iter()
                .map(String::from),
        )
        .unwrap();
        match command {
            Command::Backup { destination, keep } => {
                assert_eq!(destination, PathBuf::from("/var/backups/mono"));
                assert_eq!(keep, Some(14));
            }
            _ => panic!("backup 명령이 아님"),
        }
    }

    #[test]
    fn rejects_unknown_backup_options() {
        let error = parse_command(
            ["backup", "/tmp", "--unknown"]
                .into_iter()
                .map(String::from),
        )
        .err()
        .unwrap();
        assert!(error.contains("알 수 없는"));
    }
}
