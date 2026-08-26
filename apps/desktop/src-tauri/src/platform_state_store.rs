use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::Mutex, time::Duration};

const CURRENT_SCHEMA_VERSION: i64 = 2;

pub struct SqlitePlatformStateStore {
    connection: Mutex<Connection>,
}

impl SqlitePlatformStateStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut connection = Connection::open(path)
            .map_err(|error| format!("SQLite 데이터베이스 열기 실패: {error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("SQLite 대기 시간 설정 실패: {error}"))?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
            .map_err(|error| format!("SQLite 실행 설정 실패: {error}"))?;
        migrate(&mut connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn load(&self) -> Result<Option<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        connection
            .query_row(
                "SELECT payload FROM platform_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("SQLite 상태 읽기 실패: {error}"))
    }

    pub fn save(&self, payload: &str) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("SQLite 저장 트랜잭션 시작 실패: {error}"))?;
        transaction
            .execute(
                "INSERT INTO platform_state (id, payload, updated_at)
                 VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(id) DO UPDATE SET
                   payload = excluded.payload,
                   updated_at = excluded.updated_at",
                params![payload],
            )
            .map_err(|error| format!("SQLite 상태 저장 실패: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("SQLite 저장 커밋 실패: {error}"))
    }

    // ponytail: 미디어를 data URL(base64) TEXT로 저장한다. 상태 blob에서 분리하는 게 핵심.
    // 디스크를 아끼려면 나중에 BLOB 컬럼 + 바이너리 IPC로 올릴 수 있다.
    pub fn save_media(&self, id: &str, data_url: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        connection
            .execute(
                "INSERT INTO media (id, data_url, created_at)
                 VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(id) DO UPDATE SET data_url = excluded.data_url",
                params![id, data_url],
            )
            .map_err(|error| format!("SQLite 미디어 저장 실패: {error}"))?;
        Ok(())
    }

    pub fn load_media(&self, id: &str) -> Result<Option<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        connection
            .query_row(
                "SELECT data_url FROM media WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("SQLite 미디어 읽기 실패: {error}"))
    }

    pub fn delete_media(&self, id: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        connection
            .execute("DELETE FROM media WHERE id = ?1", params![id])
            .map_err(|error| format!("SQLite 미디어 삭제 실패: {error}"))?;
        Ok(())
    }

    /// 상태(state)가 더 이상 참조하지 않는 미디어를 지운다. keep_ids에 없는 행은 전부 삭제하고 삭제된 개수를 반환한다.
    pub fn gc_media(&self, keep_ids: &[String]) -> Result<usize, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        if keep_ids.is_empty() {
            return connection
                .execute("DELETE FROM media", [])
                .map_err(|error| format!("SQLite 미디어 GC 실패: {error}"));
        }
        let placeholders = std::iter::repeat("?")
            .take(keep_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("DELETE FROM media WHERE id NOT IN ({placeholders})");
        connection
            .execute(&sql, rusqlite::params_from_iter(keep_ids))
            .map_err(|error| format!("SQLite 미디어 GC 실패: {error}"))
    }
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               applied_at TEXT NOT NULL
             );",
        )
        .map_err(|error| format!("SQLite 마이그레이션 테이블 생성 실패: {error}"))?;

    let version = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("SQLite 스키마 버전 조회 실패: {error}"))?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "지원하지 않는 SQLite 스키마 버전입니다: {version} (앱 지원 버전: {CURRENT_SCHEMA_VERSION})"
        ));
    }

    if version < 1 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("SQLite 마이그레이션 시작 실패: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE platform_state (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   payload TEXT NOT NULL CHECK (json_valid(payload)),
                   updated_at TEXT NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                 VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
            )
            .map_err(|error| format!("SQLite 1번 마이그레이션 실패: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("SQLite 마이그레이션 커밋 실패: {error}"))?;
    }

    if version < 2 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("SQLite 2번 마이그레이션 시작 실패: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE media (
                   id TEXT PRIMARY KEY,
                   data_url TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                 VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
            )
            .map_err(|error| format!("SQLite 2번 마이그레이션 실패: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("SQLite 2번 마이그레이션 커밋 실패: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::SqlitePlatformStateStore;
    use tempfile::tempdir;

    #[test]
    fn migrates_empty_database_and_starts_without_seed() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqlitePlatformStateStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");

        assert_eq!(store.load().expect("초기 상태 읽기"), None);
    }

    #[test]
    fn saved_state_survives_store_reopen() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let path = directory.path().join("mono.sqlite3");
        let payload = r#"{"inbox":{"items":[{"id":"inbox-restart"}]}}"#;

        {
            let store = SqlitePlatformStateStore::open(&path).expect("첫 저장소 열기");
            store.save(payload).expect("상태 저장");
        }

        let reopened = SqlitePlatformStateStore::open(&path).expect("저장소 다시 열기");
        assert_eq!(
            reopened.load().expect("재실행 상태 읽기").as_deref(),
            Some(payload)
        );
    }

    #[test]
    fn latest_save_replaces_single_source_state_atomically() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqlitePlatformStateStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");

        store.save(r#"{"revision":1}"#).expect("첫 상태 저장");
        store.save(r#"{"revision":2}"#).expect("둘째 상태 저장");

        assert_eq!(
            store.load().expect("최신 상태 읽기").as_deref(),
            Some(r#"{"revision":2}"#)
        );
    }

    #[test]
    fn media_round_trips_and_deletes() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqlitePlatformStateStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");

        assert_eq!(store.load_media("m-1").expect("빈 미디어 읽기"), None);

        store
            .save_media("m-1", "data:image/png;base64,AAAA")
            .expect("미디어 저장");
        assert_eq!(
            store.load_media("m-1").expect("미디어 읽기").as_deref(),
            Some("data:image/png;base64,AAAA")
        );

        store.delete_media("m-1").expect("미디어 삭제");
        assert_eq!(store.load_media("m-1").expect("삭제 후 읽기"), None);
    }

    #[test]
    fn gc_media_removes_only_unreferenced_rows() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqlitePlatformStateStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");
        store
            .save_media("keep", "data:image/png;base64,AAAA")
            .expect("저장");
        store
            .save_media("orphan", "data:image/png;base64,BBBB")
            .expect("저장");

        let deleted = store.gc_media(&["keep".to_owned()]).expect("GC 실행");

        assert_eq!(deleted, 1);
        assert!(store.load_media("keep").expect("읽기").is_some());
        assert_eq!(store.load_media("orphan").expect("읽기"), None);
    }

    #[test]
    fn gc_media_with_empty_keep_list_removes_everything() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqlitePlatformStateStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");
        store
            .save_media("orphan-1", "data:image/png;base64,AAAA")
            .expect("저장");
        store
            .save_media("orphan-2", "data:image/png;base64,BBBB")
            .expect("저장");

        let deleted = store.gc_media(&[]).expect("GC 실행");

        assert_eq!(deleted, 2);
    }
}
