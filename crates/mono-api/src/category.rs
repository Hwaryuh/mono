// todo_labels / ledger_categories / calendar_categories share the same (id, name, color, order_index)
// schema, and most of the CRUD logic is the same. This gathers just the pieces that differ — table names and error text.
// Delete semantics (whether a replacement label is required, dependent tables) differ per module, so those stay separate.
use rusqlite::{params, Connection, OptionalExtension};

use super::common::validated_color;
use super::error::{ApiError, ApiResult};

// The id of the reserved "Other" item — always exists and stays last in order (db.rs SEED).
pub const RESERVED_ID: &str = "other";

/// Name validation: 1-100 characters after trimming. (Shared wording for todo labels / ledger·calendar categories)
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

// Only the parts that differ per module (table name, wording) are held as declarations. The rest of the logic is shared by the methods.
pub struct Categories {
    pub table: &'static str,
    /// "{not_found}: {id}" on a require() failure.
    pub not_found: &'static str,
    /// The wording for a duplicate name.
    pub clash: &'static str,
    /// The reorder input itself is empty, or contains an empty id.
    pub reorder_invalid: &'static str,
    /// The reorder list doesn't match the current set.
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
        // ponytail: SQLite's lower() only folds ASCII. That's irrelevant for Korean since it has no case, and
        //           English case-duplicates are still caught. Folding extended Latin (é etc.) too would need an app-side recheck.
        // Since id is either a UUID or "other", an empty string is a safe sentinel (no id is excepted on create).
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

    /// Validates name/color + checks for duplicates + inserts. Appended with an order after "Other".
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
