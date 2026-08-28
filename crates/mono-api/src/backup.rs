use std::fmt::{Display, Formatter};
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection, OpenFlags, MAIN_DB};
use serde_json::json;

const BACKUP_PREFIX: &str = "mono-backup-";
const MANIFEST_FILE: &str = "manifest.json";
const DATABASE_FILE: &str = "mono.sqlite";
const SECRET_KEY_FILE: &str = "mono.secret.key";

#[derive(Debug)]
pub enum BackupError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    InvalidInput(String),
}

impl Display for BackupError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Sqlite(error) => write!(formatter, "{error}"),
            Self::InvalidInput(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for BackupError {}

impl From<std::io::Error> for BackupError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for BackupError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

#[derive(Debug, PartialEq)]
pub struct BackupResult {
    pub directory: PathBuf,
    pub pruned: usize,
}

pub fn create(
    database_path: &Path,
    secret_key_path: &Path,
    destination_root: &Path,
    keep: Option<usize>,
) -> Result<BackupResult, BackupError> {
    require_source_file(database_path, "데이터베이스")?;
    require_source_file(secret_key_path, "마스터 키")?;
    if keep == Some(0) {
        return Err(BackupError::InvalidInput(
            "백업 보존 개수는 1 이상이어야 합니다.".into(),
        ));
    }

    std::fs::create_dir_all(destination_root)?;
    let created_at = Utc::now();
    let backup_name = format!("{BACKUP_PREFIX}{}", created_at.format("%Y%m%dT%H%M%S%.3fZ"));
    let staging_directory = destination_root.join(format!(".{backup_name}.partial"));
    let backup_directory = destination_root.join(&backup_name);
    std::fs::create_dir(&staging_directory)?;
    set_private_directory_permissions(&staging_directory)?;

    let write_result = write_backup(
        database_path,
        secret_key_path,
        &staging_directory,
        &created_at.to_rfc3339(),
    );
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&staging_directory);
        return Err(error);
    }

    std::fs::rename(&staging_directory, &backup_directory)?;
    let pruned = keep
        .map(|count| prune(destination_root, count))
        .transpose()?
        .unwrap_or(0);
    Ok(BackupResult {
        directory: backup_directory,
        pruned,
    })
}

fn require_source_file(path: &Path, label: &str) -> Result<(), BackupError> {
    if path.is_file() {
        Ok(())
    } else {
        Err(BackupError::InvalidInput(format!(
            "{label} 파일이 없습니다: {}",
            path.display()
        )))
    }
}

fn write_backup(
    database_path: &Path,
    secret_key_path: &Path,
    staging_directory: &Path,
    created_at: &str,
) -> Result<(), BackupError> {
    let database_backup_path = staging_directory.join(DATABASE_FILE);
    let source = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    source.backup(MAIN_DB, &database_backup_path, None)?;

    // 원본의 WAL 설정도 함께 복제된다. 백업 묶음은 단일 DB 파일이어야 하므로 DELETE 모드로
    // checkpoint해 빈 -wal/-shm 보조 파일을 남기지 않는다. 복원 후 서버가 다시 WAL로 연다.
    let backup = Connection::open(&database_backup_path)?;
    backup.pragma_update(None, "journal_mode", "DELETE")?;
    let integrity: String = backup.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(BackupError::InvalidInput(format!(
            "백업 데이터베이스 무결성 검사 실패: {integrity}"
        )));
    }

    let secret_key_backup_path = staging_directory.join(SECRET_KEY_FILE);
    std::fs::copy(secret_key_path, &secret_key_backup_path)?;
    set_private_file_permissions(&database_backup_path)?;
    set_private_file_permissions(&secret_key_backup_path)?;

    let manifest = serde_json::to_vec_pretty(&json!({
        "formatVersion": 1,
        "createdAt": created_at,
        "database": DATABASE_FILE,
        "secretKey": SECRET_KEY_FILE,
        "serverVersion": env!("CARGO_PKG_VERSION")
    }))
    .map_err(|error| BackupError::InvalidInput(format!("백업 manifest 생성 실패: {error}")))?;
    let manifest_path = staging_directory.join(MANIFEST_FILE);
    std::fs::write(&manifest_path, manifest)?;
    set_private_file_permissions(&manifest_path)?;
    Ok(())
}

fn prune(destination_root: &Path, keep: usize) -> Result<usize, BackupError> {
    let mut backups = std::fs::read_dir(destination_root)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(BACKUP_PREFIX)
                && entry.path().join(MANIFEST_FILE).is_file()
        })
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    backups.sort();

    let remove_count = backups.len().saturating_sub(keep);
    for backup in backups.into_iter().take(remove_count) {
        std::fs::remove_dir_all(backup)?;
    }
    Ok(remove_count)
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mono-backup-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn creates_consistent_database_and_key_backup() {
        let root = test_directory("create");
        let database_path = root.join("source.sqlite");
        let secret_key_path = root.join("source.key");
        let destination = root.join("backups");
        let source = Connection::open(&database_path).unwrap();
        source
            .execute("CREATE TABLE sample (value TEXT NOT NULL)", [])
            .unwrap();
        source
            .execute("INSERT INTO sample VALUES ('saved')", [])
            .unwrap();
        std::fs::write(&secret_key_path, "secret").unwrap();

        let result = create(&database_path, &secret_key_path, &destination, None).unwrap();
        let value: String = Connection::open(result.directory.join(DATABASE_FILE))
            .unwrap()
            .query_row("SELECT value FROM sample", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "saved");
        assert_eq!(
            std::fs::read_to_string(result.directory.join(SECRET_KEY_FILE)).unwrap(),
            "secret"
        );
        assert!(result.directory.join(MANIFEST_FILE).is_file());
        assert!(!result
            .directory
            .join(format!("{DATABASE_FILE}-wal"))
            .exists());
        assert!(!result
            .directory
            .join(format!("{DATABASE_FILE}-shm"))
            .exists());
        drop(source);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pruning_only_removes_recognized_old_backups() {
        let root = test_directory("prune");
        for name in ["mono-backup-1", "mono-backup-2", "mono-backup-3"] {
            let directory = root.join(name);
            std::fs::create_dir(&directory).unwrap();
            std::fs::write(directory.join(MANIFEST_FILE), "{}").unwrap();
        }
        let unrelated = root.join("mono-backup-manual");
        std::fs::create_dir(&unrelated).unwrap();

        assert_eq!(prune(&root, 2).unwrap(), 1);
        assert!(!root.join("mono-backup-1").exists());
        assert!(root.join("mono-backup-2").exists());
        assert!(root.join("mono-backup-3").exists());
        assert!(unrelated.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
