use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::Mutex, time::Duration};

const CURRENT_SCHEMA_VERSION: i64 = 2;

pub struct SqliteMediaStore {
    connection: Mutex<Connection>,
}

impl SqliteMediaStore {
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

    /// 정리 대상 미디어의 (개수, 총 바이트). 지우지 않는다 — 설정 화면 미리보기용이다.
    pub fn orphan_media_stats(&self, keep_ids: &[String]) -> Result<(i64, i64), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        let sql = format!(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(data_url)), 0) FROM media{}",
            orphan_filter(keep_ids.len())
        );
        connection
            .query_row(&sql, rusqlite::params_from_iter(keep_ids), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|error| format!("SQLite 미디어 통계 조회 실패: {error}"))
    }

    /// 어떤 항목도 참조하지 않는 미디어를 지운다. keep_ids에 없는 행은 전부 삭제하고 삭제된 개수를 반환한다.
    pub fn gc_media(&self, keep_ids: &[String]) -> Result<usize, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 저장소 잠금이 손상되었습니다.".to_owned())?;
        let sql = format!("DELETE FROM media{}", orphan_filter(keep_ids.len()));
        connection
            .execute(&sql, rusqlite::params_from_iter(keep_ids))
            .map_err(|error| format!("SQLite 미디어 GC 실패: {error}"))
    }
}

/// keep_ids에 없는 행만 고르는 WHERE 절. 빈 목록이면 전체가 대상이라 절 자체가 없다.
fn orphan_filter(keep_count: usize) -> String {
    if keep_count == 0 {
        return String::new();
    }
    let placeholders = std::iter::repeat("?")
        .take(keep_count)
        .collect::<Vec<_>>()
        .join(",");
    format!(" WHERE id NOT IN ({placeholders})")
}

// 마이그레이션은 append-only다. 1번이 만드는 platform_state 테이블은 더 이상 쓰지 않지만
// (상태 원본은 API 서버로 옮겼다 — architecture-decisions.md §9), 기존 설치본의 버전 사슬을
// 끊지 않으려고 그대로 둔다. 정리하려면 3번 마이그레이션에서 DROP TABLE 한다.
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
    use super::SqliteMediaStore;
    use tempfile::tempdir;

    #[test]
    fn media_round_trips_and_deletes() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqliteMediaStore::open(&directory.path().join("mono.sqlite3"))
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
    fn orphan_media_stats_counts_without_deleting() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqliteMediaStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");
        store.save_media("keep", "1234").expect("저장");
        store.save_media("orphan-1", "12345").expect("저장");
        store.save_media("orphan-2", "123").expect("저장");

        let (count, bytes) = store
            .orphan_media_stats(&["keep".to_owned()])
            .expect("통계 조회");

        assert_eq!(count, 2);
        assert_eq!(bytes, 8);
        // 조회는 아무것도 지우지 않는다.
        assert!(store.load_media("orphan-1").expect("읽기").is_some());
    }

    #[test]
    fn orphan_media_stats_with_empty_keep_list_counts_everything() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqliteMediaStore::open(&directory.path().join("mono.sqlite3"))
            .expect("SQLite 저장소 생성");
        store.save_media("a", "1234").expect("저장");

        assert_eq!(store.orphan_media_stats(&[]).expect("통계 조회"), (1, 4));
    }

    #[test]
    fn gc_media_removes_only_unreferenced_rows() {
        let directory = tempdir().expect("임시 디렉터리 생성");
        let store = SqliteMediaStore::open(&directory.path().join("mono.sqlite3"))
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
        let store = SqliteMediaStore::open(&directory.path().join("mono.sqlite3"))
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
