// todo_labels / ledger_categories / calendar_categories 는 (id, name, color, order_index)
// 스키마가 같고 CRUD 로직도 대부분 같다. 테이블명·에러 문구만 다른 조각을 여기 모은다.
// 삭제 시맨틱(대체 라벨 필요 여부·의존 테이블)은 모듈마다 달라 각자 둔다.
use rusqlite::{params, Connection, OptionalExtension};

use super::common::validated_color;
use super::error::{ApiError, ApiResult};

// "기타" 예약 항목의 id — 항상 존재하고 마지막 순서에 남는다(db.rs SEED).
pub const RESERVED_ID: &str = "other";

/// 이름 검증: 트림 후 1~100자. (todo 라벨 / ledger·calendar 분류 공통 문구)
pub fn validated_name(raw: &str) -> ApiResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(ApiError::validation("라벨 이름을 입력해야 합니다."));
    }
    if name.chars().count() > 100 {
        return Err(ApiError::validation("라벨 이름은 100자 이하여야 합니다."));
    }
    Ok(name.to_string())
}

// 모듈별로 다른 부분(테이블명·문구)만 선언으로 담는다. 나머지 로직은 메서드가 공유.
pub struct Categories {
    pub table: &'static str,
    /// require() 실패 시 "{not_found}: {id}".
    pub not_found: &'static str,
    /// 이름 중복 시 문구.
    pub clash: &'static str,
    /// reorder 입력 자체가 비었/빈 id 포함.
    pub reorder_invalid: &'static str,
    /// reorder 목록이 현재 집합과 불일치.
    pub reorder_mismatch: &'static str,
}

impl Categories {
    pub fn exists(&self, conn: &Connection, id: &str) -> ApiResult<bool> {
        let sql = format!("SELECT 1 FROM {} WHERE id = ?1", self.table);
        Ok(conn.query_row(&sql, [id], |_| Ok(())).is_ok())
    }

    pub fn require(&self, conn: &Connection, id: &str) -> ApiResult<()> {
        if self.exists(conn, id)? {
            Ok(())
        } else {
            Err(ApiError::NotFound(format!("{}: {id}", self.not_found)))
        }
    }

    pub fn assert_unique_name(
        &self,
        conn: &Connection,
        name: &str,
        except_id: Option<&str>,
    ) -> ApiResult<()> {
        // ponytail: SQLite lower()는 ASCII만 접는다. 한글은 대소문자가 없어 무관하고
        //           영문 대소문자 중복도 잡힌다. 라틴 확장(é 등)까지 접으려면 앱 단 재비교.
        // id는 UUID 또는 "other"라 빈 문자열이 sentinel로 안전(생성 시 except 없음).
        let sql = format!(
            "SELECT 1 FROM {} WHERE lower(name) = lower(?1) AND id != ?2 LIMIT 1",
            self.table
        );
        let clash = conn
            .query_row(&sql, params![name, except_id.unwrap_or("")], |_| Ok(()))
            .optional()?
            .is_some();
        if clash {
            return Err(ApiError::BadRequest(self.clash.into()));
        }
        Ok(())
    }

    /// 이름·색 검증 + 중복 확인 + 삽입. "기타"보다 뒤 순서로 붙인다.
    pub fn insert(&self, conn: &Connection, name_raw: &str, color_raw: &str) -> ApiResult<()> {
        let name = validated_name(name_raw)?;
        let color = validated_color(color_raw)?;
        self.assert_unique_name(conn, &name, None)?;
        let next_order: i64 = conn.query_row(
            &format!("SELECT COALESCE(MAX(order_index), -1) FROM {} WHERE id != ?1", self.table),
            [RESERVED_ID],
            |row| row.get(0),
        )?;
        conn.execute(
            &format!("INSERT INTO {} (id, name, color, order_index) VALUES (?1, ?2, ?3, ?4)", self.table),
            params![uuid::Uuid::new_v4().to_string(), name, color, next_order + 1],
        )?;
        Ok(())
    }

    pub fn update(
        &self,
        conn: &Connection,
        id: &str,
        name_raw: &str,
        color_raw: &str,
        expected: Option<i64>,
    ) -> ApiResult<()> {
        self.require(conn, id)?;
        let name = validated_name(name_raw)?;
        let color = validated_color(color_raw)?;
        self.assert_unique_name(conn, &name, Some(id))?;
        let changed = conn.execute(
            &format!(
                "UPDATE {} SET name = ?1, color = ?2, version = version + 1 \
                 WHERE id = ?3 AND (?4 IS NULL OR version = ?4)",
                self.table
            ),
            params![name, color, id, expected],
        )?;
        crate::version::ensure_versioned_update(changed, expected)
    }

    pub fn reorder(&self, conn: &mut Connection, ids: Vec<String>) -> ApiResult<()> {
        if ids.is_empty() || ids.iter().any(|id| id.is_empty()) {
            return Err(ApiError::validation(self.reorder_invalid));
        }
        let current: Vec<String> = conn
            .prepare(&format!("SELECT id FROM {}", self.table))?
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let unique: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
        if ids.len() != current.len()
            || unique.len() != current.len()
            || current.iter().any(|id| !unique.contains(id.as_str()))
        {
            return Err(ApiError::BadRequest(self.reorder_mismatch.into()));
        }
        let tx = conn.transaction()?;
        for (index, id) in ids.iter().enumerate() {
            tx.execute(
                &format!("UPDATE {} SET order_index = ?1 WHERE id = ?2", self.table),
                params![index as i64, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}
