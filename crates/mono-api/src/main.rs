// The standalone mono API server. Run it on a home server/NAS/VPS so multiple desktops share the same DB.
// Auth is assumed to happen at the network level (Tailscale/WireGuard) — there is no app-level auth.
// Binding 0.0.0.0 means anyone on the same network can read the data, so only expose it inside a private network.
//
// env:
//   MONO_BIND_ADDR        default 0.0.0.0:4174
//   MONO_DB_PATH          default ./mono.sqlite
//   MONO_SECRET_KEY_PATH  default ./mono.secret.key
//   MONO_CORS_ORIGINS     comma-separated. Falls back to the desktop app's default origin list if unset.
//   MONO_API_TOKEN        if set, requires a Bearer token on every request except /health. No auth if unset.

use std::path::PathBuf;
use std::process::ExitCode;

enum Command {
    Serve,
    Backup {
        destination: PathBuf,
        keep: Option<usize>,
    },
    MirrorMedia {
        destination: PathBuf,
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
        Some("mirror-media") => {
            let destination = arguments
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| "mirror-media 대상 디렉터리가 필요합니다.".to_string())?;
            if arguments.next().is_some() {
                return Err("mirror-media 인수가 너무 많습니다.".into());
            }
            Ok(Command::MirrorMedia { destination })
        }
        Some(command) => Err(format!("알 수 없는 명령입니다: {command}")),
    }
}

fn print_help() {
    println!(
        "mono-api\n\nUSAGE:\n  mono-api [serve]\n  mono-api backup <directory> [--keep <count>]\n  mono-api mirror-media <directory>\n\nENV:\n  MONO_BIND_ADDR\n  MONO_DB_PATH\n  MONO_SECRET_KEY_PATH\n  MONO_CORS_ORIGINS"
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
        api_token: std::env::var("MONO_API_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
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
        Ok(Command::MirrorMedia { destination }) => {
            let database_path = PathBuf::from(env_or("MONO_DB_PATH", "mono.sqlite"));
            let secret_key_path = PathBuf::from(env_or("MONO_SECRET_KEY_PATH", "mono.secret.key"));
            match mono_api::mirror_media(&database_path, &secret_key_path, &destination) {
                Ok(mono_api::MediaMirrorOutcome::Skipped) => {
                    println!("mirror-media: R2 자격증명 미설정 — 건너뜀");
                    ExitCode::SUCCESS
                }
                Ok(mono_api::MediaMirrorOutcome::Mirrored { downloaded, skipped }) => {
                    println!("mirror-media: 받음 {downloaded} · 유지 {skipped}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("mirror-media failed: {error}");
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
    fn parses_mirror_media_destination() {
        let command = parse_command(
            ["mirror-media", "/var/backups/mono/media"]
                .into_iter()
                .map(String::from),
        )
        .unwrap();
        match command {
            Command::MirrorMedia { destination } => {
                assert_eq!(destination, PathBuf::from("/var/backups/mono/media"));
            }
            _ => panic!("mirror-media 명령이 아님"),
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
