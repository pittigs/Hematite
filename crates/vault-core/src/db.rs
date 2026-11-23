use crate::model::{
    BacklinkItem, Block, BlockLookup, BlockType, BrokenLinkInfo, CanvasData, DatabaseQuery,
    DatabaseQueryResult, DatabaseRow, Document, DocumentSnapshot, DocumentSummary, HubDocInfo,
    IndexStats, LinkType, OptimizeReport, SearchResponse, SearchResult, TaskMetadata, TaskStatus,
    TaskViewItem, UnlinkedMention, VaultAnalytics,
};
use crate::parser::{parse_markdown_document, ParsedDocument};
use anyhow::{Context, Result};
use rayon::prelude::*;
use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

pub struct Database {
    conn: Connection,
}

impl Database {
    /// Opens (or creates) the local SQLite turbo-index with WAL, mmap, FTS5, and JSONB enabled.
    pub fn open(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)
            .with_context(|| format!("Failed to open SQLite database at {}", db_path.display()))?;

        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA mmap_size = 268435456;
            PRAGMA cache_size = -64000;
            PRAGMA foreign_keys = ON;
            ",
        )?;

        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                blake3_hash TEXT NOT NULL,
                frontmatter_jsonb BLOB NOT NULL,
                tags_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                parent_block_id TEXT,
                depth INTEGER NOT NULL DEFAULT 0,
                sort_order REAL NOT NULL,
                block_type TEXT NOT NULL,
                heading_level INTEGER,
                code_lang TEXT,
                has_explicit_id INTEGER NOT NULL DEFAULT 0,
                raw_content TEXT NOT NULL,
                plain_text TEXT NOT NULL,
                properties_jsonb BLOB NOT NULL,
                tags_json TEXT NOT NULL,
                collapsed INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_blocks_doc_sort ON blocks(doc_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_blocks_parent ON blocks(parent_block_id);

            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
                source_doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                target_doc_id TEXT,
                target_block_id TEXT,
                target_raw TEXT NOT NULL,
                link_type TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_block_id);
            CREATE INDEX IF NOT EXISTS idx_links_target_doc ON links(target_doc_id);
            CREATE INDEX IF NOT EXISTS idx_links_target_block ON links(target_block_id);
            CREATE INDEX IF NOT EXISTS idx_links_target_raw ON links(target_raw);

            CREATE TABLE IF NOT EXISTS tasks (
                block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                priority INTEGER,
                scheduled_at TEXT,
                deadline_at TEXT,
                recurrence TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline ON tasks(status, deadline_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);

            CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
                plain_text,
                content='blocks',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
                INSERT INTO blocks_fts(rowid, plain_text) VALUES (new.rowid, new.plain_text);
            END;

            CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks BEGIN
                INSERT INTO blocks_fts(blocks_fts, rowid, plain_text) VALUES('delete', old.rowid, old.plain_text);
            END;

            CREATE TRIGGER IF NOT EXISTS blocks_au AFTER UPDATE ON blocks BEGIN
                INSERT INTO blocks_fts(blocks_fts, rowid, plain_text) VALUES('delete', old.rowid, old.plain_text);
                INSERT INTO blocks_fts(rowid, plain_text) VALUES (new.rowid, new.plain_text);
            END;

            CREATE TABLE IF NOT EXISTS canvas_nodes (
                id TEXT PRIMARY KEY,
                canvas_path TEXT NOT NULL,
                ref_doc_path TEXT,
                ref_block_id TEXT,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                node_type TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS canvas_edges (
                id TEXT PRIMARY KEY,
                canvas_path TEXT NOT NULL,
                from_node_id TEXT NOT NULL,
                to_node_id TEXT NOT NULL,
                label TEXT
            );

            CREATE TABLE IF NOT EXISTS doc_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_path TEXT NOT NULL,
                blake3_hash TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_snapshots_path_time ON doc_snapshots(doc_path, created_at DESC);
            ",
        )?;
        Ok(())
    }

    /// Scans the vault directory in parallel with BLAKE3 hashing and incrementally updates SQLite.
    pub fn sync_vault(&mut self, vault_path: &Path) -> Result<IndexStats> {
        let start = Instant::now();

        let existing_hashes = self.load_existing_hashes()?;
        let mut disk_files: Vec<(String, PathBuf)> = Vec::new();

        for entry in WalkDir::new(vault_path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !(e.depth() > 0
                    && (name.starts_with('.')
                        || name == "node_modules"
                        || name == "target"
                        || name == "dist"))
            })
        {
            let entry = entry?;
            if entry.file_type().is_file() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Ok(rel) = path.strip_prefix(vault_path) {
                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        disk_files.push((rel_str, path.to_path_buf()));
                    }
                }
            }
        }

        let files_scanned = disk_files.len();
        let disk_set: HashSet<String> = disk_files.iter().map(|(r, _)| r.clone()).collect();
        let deleted_paths: Vec<String> = existing_hashes
            .keys()
            .filter(|p| !disk_set.contains(*p))
            .cloned()
            .collect();

        enum FileWorkResult {
            Unchanged,
            Parsed(ParsedDocument),
        }

        let work_results: Vec<Result<FileWorkResult>> = disk_files
            .par_iter()
            .map(|(rel_path, abs_path)| {
                let content = fs::read_to_string(abs_path)
                    .with_context(|| format!("Failed to read {}", abs_path.display()))?;
                let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
                if existing_hashes.get(rel_path).map(|h| h == &hash).unwrap_or(false) {
                    return Ok(FileWorkResult::Unchanged);
                }
                let meta = fs::metadata(abs_path)?;
                let updated_at = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or_else(now_unix);
                let created_at = meta
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(updated_at);

                Ok(FileWorkResult::Parsed(parse_markdown_document(
                    rel_path,
                    &content,
                    created_at,
                    updated_at,
                )))
            })
            .collect();

        let mut parsed_docs = Vec::new();
        let mut files_skipped_unchanged = 0usize;
        for res in work_results {
            match res? {
                FileWorkResult::Unchanged => files_skipped_unchanged += 1,
                FileWorkResult::Parsed(doc) => parsed_docs.push(doc),
            }
        }

        let files_reindexed = parsed_docs.len();
        let files_deleted = deleted_paths.len();

        if files_reindexed > 0 || files_deleted > 0 {
            let tx = self.conn.transaction()?;
            {
                let mut del_doc_stmt = tx.prepare_cached("DELETE FROM documents WHERE path = ?1")?;
                for path in &deleted_paths {
                    del_doc_stmt.execute(params![path])?;
                }

                for parsed in &parsed_docs {
                    Self::upsert_parsed_doc_in_tx(&tx, parsed)?;
                }

                Self::resolve_links_in_tx(&tx)?;
            }
            tx.commit()?;
        }

        let (total_documents, total_blocks, total_links, total_tasks, _) = self.get_vault_counts()?;

        Ok(IndexStats {
            files_scanned,
            files_reindexed,
            files_skipped_unchanged,
            files_deleted,
            total_documents,
            total_blocks,
            total_links,
            total_tasks,
            elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
        })
    }

    pub fn upsert_single_document(&mut self, parsed: &ParsedDocument) -> Result<()> {
        let tx = self.conn.transaction()?;
        Self::upsert_parsed_doc_in_tx(&tx, parsed)?;
        Self::resolve_links_in_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_document_by_path(&mut self, rel_path: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM documents WHERE path = ?1", params![rel_path])?;
        Self::resolve_links_in_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }

    fn load_existing_hashes(&self) -> Result<HashMap<String, String>> {
        let mut stmt = self.conn.prepare("SELECT path, blake3_hash FROM documents")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = HashMap::new();
        for row in rows {
            let (p, h) = row?;
            map.insert(p, h);
        }
        Ok(map)
    }

    fn upsert_parsed_doc_in_tx(tx: &rusqlite::Transaction<'_>, parsed: &ParsedDocument) -> Result<()> {
        let doc = &parsed.document;
        let fm_json = serde_json::to_string(&doc.frontmatter)?;
        let tags_json = serde_json::to_string(&doc.tags)?;

        // Delete existing document row by path or id cleanly so cascade refreshes blocks/tasks/links.
        tx.execute(
            "DELETE FROM documents WHERE path = ?1 OR id = ?2",
            params![doc.path, doc.id],
        )?;

        tx.prepare_cached(
            "INSERT INTO documents (id, path, title, blake3_hash, frontmatter_jsonb, tags_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, jsonb(?5), ?6, ?7, ?8)",
        )?
        .execute(params![
            doc.id,
            doc.path,
            doc.title,
            doc.blake3_hash,
            fm_json,
            tags_json,
            doc.created_at,
            doc.updated_at,
        ])?;

        let mut block_stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO blocks
             (id, doc_id, parent_block_id, depth, sort_order, block_type, heading_level, code_lang,
              has_explicit_id, raw_content, plain_text, properties_jsonb, tags_json, collapsed, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, jsonb(?12), ?13, ?14, ?15)",
        )?;

        let mut task_stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO tasks (block_id, status, priority, scheduled_at, deadline_at, recurrence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;

        let mut link_stmt = tx.prepare_cached(
            "INSERT INTO links (source_block_id, source_doc_id, target_doc_id, target_block_id, target_raw, link_type)
             VALUES (?1, ?2, NULL, NULL, ?3, ?4)",
        )?;

        for pb in &parsed.blocks {
            let b = &pb.block;
            let props_json = serde_json::to_string(&b.properties)?;
            let blk_tags_json = serde_json::to_string(&b.tags)?;

            block_stmt.execute(params![
                b.id,
                b.doc_id,
                b.parent_block_id,
                b.depth,
                b.sort_order,
                b.block_type.as_str(),
                b.heading_level.map(|v| v as i64),
                b.code_lang,
                if b.has_explicit_id { 1 } else { 0 },
                b.raw_content,
                b.plain_text,
                props_json,
                blk_tags_json,
                if b.collapsed { 1 } else { 0 },
                b.updated_at,
            ])?;

            if let Some(ref task) = b.task {
                task_stmt.execute(params![
                    b.id,
                    task.status.as_str(),
                    task.priority.map(|p| p as i64),
                    task.scheduled_at,
                    task.deadline_at,
                    task.recurrence,
                ])?;
            }

            for link in &pb.links {
                link_stmt.execute(params![
                    b.id,
                    doc.id,
                    link.target_raw,
                    link.link_type.as_str(),
                ])?;
            }
        }

        Ok(())
    }

    fn resolve_links_in_tx(tx: &rusqlite::Transaction<'_>) -> Result<()> {
        let mut doc_lookup: HashMap<String, String> = HashMap::new();
        {
            let mut stmt =
                tx.prepare("SELECT id, path, title, json(frontmatter_jsonb) FROM documents")?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?;
            for row in rows {
                let (id, path, title, fm_str) = row?;
                doc_lookup.insert(title.to_lowercase(), id.clone());
                let stem = Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&path)
                    .to_lowercase();
                doc_lookup.entry(stem).or_insert_with(|| id.clone());
                let path_no_ext = path.strip_suffix(".md").unwrap_or(&path).to_lowercase();
                doc_lookup.entry(path_no_ext).or_insert_with(|| id.clone());

                let fm: BTreeMap<String, Value> = serde_json::from_str(&fm_str).unwrap_or_default();
                for alias in extract_frontmatter_aliases(&fm) {
                    doc_lookup
                        .entry(alias.to_lowercase())
                        .or_insert_with(|| id.clone());
                }
            }
        }

        let mut block_lookup: HashMap<String, String> = HashMap::new();
        {
            let mut stmt = tx.prepare("SELECT id, doc_id FROM blocks")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (bid, did) = row?;
                block_lookup.insert(bid, did);
            }
        }

        let mut pending: Vec<(i64, String, String)> = Vec::new();
        {
            let mut stmt = tx.prepare(
                "SELECT id, target_raw, link_type FROM links WHERE link_type IN ('wiki_link', 'embed', 'property_rel', 'block_ref')",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                pending.push(row?);
            }
        }

        let mut upd = tx.prepare_cached(
            "UPDATE links SET target_doc_id = ?1, target_block_id = ?2 WHERE id = ?3",
        )?;

        for (link_id, target_raw, link_type) in pending {
            if link_type == "block_ref" {
                if let Some(doc_id) = block_lookup.get(&target_raw) {
                    upd.execute(params![doc_id, target_raw, link_id])?;
                } else {
                    upd.execute(params![Option::<String>::None, Option::<String>::None, link_id])?;
                }
            } else {
                let key = target_raw.to_lowercase();
                if let Some(doc_id) = doc_lookup.get(&key) {
                    upd.execute(params![doc_id, Option::<String>::None, link_id])?;
                } else {
                    upd.execute(params![Option::<String>::None, Option::<String>::None, link_id])?;
                }
            }
        }

        Ok(())
    }

    pub fn get_vault_counts(&self) -> Result<(usize, usize, usize, usize, usize)> {
        let docs: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))?;
        let blocks: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM blocks", [], |r| r.get(0))?;
        let links: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM links", [], |r| r.get(0))?;
        let tasks: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))?;
        let open_tasks: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status IN ('TODO', 'DOING')",
            [],
            |r| r.get(0),
        )?;
        Ok((docs, blocks, links, tasks, open_tasks))
    }

    pub fn list_document_summaries(&self) -> Result<Vec<DocumentSummary>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                d.id,
                d.path,
                d.title,
                d.blake3_hash,
                json(d.frontmatter_jsonb),
                d.tags_json,
                d.updated_at,
                (SELECT COUNT(*) FROM blocks b WHERE b.doc_id = d.id) AS block_count,
                (SELECT COUNT(*) FROM blocks b INNER JOIN tasks t ON t.block_id = b.id WHERE b.doc_id = d.id) AS task_count
            FROM documents d
            ORDER BY d.path ASC
            ",
        )?;

        let rows = stmt.query_map([], |r| {
            let fm_str: String = r.get(4)?;
            let tags_str: String = r.get(5)?;
            let frontmatter: BTreeMap<String, Value> =
                serde_json::from_str(&fm_str).unwrap_or_default();
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(DocumentSummary {
                id: r.get(0)?,
                path: r.get(1)?,
                title: r.get(2)?,
                blake3_hash: r.get(3)?,
                frontmatter,
                tags,
                updated_at: r.get(6)?,
                block_count: r.get::<_, usize>(7)?,
                task_count: r.get::<_, usize>(8)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_document_by_path(&self, rel_path: &str) -> Result<Option<(Document, Vec<Block>)>> {
        let doc = self
            .conn
            .query_row(
                "SELECT id, path, title, blake3_hash, json(frontmatter_jsonb), tags_json, created_at, updated_at
                 FROM documents WHERE path = ?1",
                params![rel_path],
                Self::map_document_row,
            )
            .optional()?;

        let Some(doc) = doc else {
            return Ok(None);
        };
        let blocks = self.load_blocks_for_doc(&doc.id)?;
        Ok(Some((doc, blocks)))
    }

    pub fn get_document_by_id_or_title(&self, target: &str) -> Result<Option<(Document, Vec<Block>)>> {
        let doc = self
            .conn
            .query_row(
                "SELECT id, path, title, blake3_hash, json(frontmatter_jsonb), tags_json, created_at, updated_at
                 FROM documents
                 WHERE id = ?1 OR lower(title) = lower(?1) OR lower(path) = lower(?1) OR lower(path) = lower(?2)
                 LIMIT 1",
                params![target, format!("{}.md", target)],
                Self::map_document_row,
            )
            .optional()?;

        if let Some(doc) = doc {
            let blocks = self.load_blocks_for_doc(&doc.id)?;
            return Ok(Some((doc, blocks)));
        }

        // Fall back to case-insensitive frontmatter alias match
        let needle = target.trim().to_lowercase();
        if needle.is_empty() {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, path, title, blake3_hash, json(frontmatter_jsonb), tags_json, created_at, updated_at
             FROM documents",
        )?;
        let rows = stmt.query_map([], Self::map_document_row)?;
        for row in rows {
            let candidate = row?;
            let aliases = extract_frontmatter_aliases(&candidate.frontmatter);
            if aliases.iter().any(|a| a.to_lowercase() == needle) {
                let blocks = self.load_blocks_for_doc(&candidate.id)?;
                return Ok(Some((candidate, blocks)));
            }
        }

        Ok(None)
    }

    fn map_document_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
        let fm_str: String = r.get(4)?;
        let tags_str: String = r.get(5)?;
        Ok(Document {
            id: r.get(0)?,
            path: r.get(1)?,
            title: r.get(2)?,
            blake3_hash: r.get(3)?,
            frontmatter: serde_json::from_str(&fm_str).unwrap_or_default(),
            tags: serde_json::from_str(&tags_str).unwrap_or_default(),
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    }

    fn load_blocks_for_doc(&self, doc_id: &str) -> Result<Vec<Block>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                b.id, b.doc_id, b.parent_block_id, b.depth, b.sort_order, b.block_type,
                b.heading_level, b.code_lang, b.has_explicit_id, b.raw_content, b.plain_text,
                json(b.properties_jsonb), b.tags_json, b.collapsed, b.updated_at,
                t.status, t.priority, t.scheduled_at, t.deadline_at, t.recurrence
            FROM blocks b
            LEFT JOIN tasks t ON t.block_id = b.id
            WHERE b.doc_id = ?1
            ORDER BY b.sort_order ASC
            ",
        )?;

        let rows = stmt.query_map(params![doc_id], Self::map_block_row)?;
        let mut blocks = Vec::new();
        for row in rows {
            blocks.push(row?);
        }
        Ok(blocks)
    }

    fn map_block_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Block> {
        let props_str: String = r.get(11)?;
        let tags_str: String = r.get(12)?;
        let task_status: Option<String> = r.get(15)?;
        let task = task_status.map(|status| TaskMetadata {
            status: TaskStatus::from_db_str(&status),
            priority: r.get::<_, Option<i64>>(16).ok().flatten().map(|v| v as u8),
            scheduled_at: r.get(17).ok().flatten(),
            deadline_at: r.get(18).ok().flatten(),
            recurrence: r.get(19).ok().flatten(),
        });

        Ok(Block {
            id: r.get(0)?,
            doc_id: r.get(1)?,
            parent_block_id: r.get(2)?,
            depth: r.get::<_, u32>(3)?,
            sort_order: r.get(4)?,
            block_type: BlockType::from_db_str(&r.get::<_, String>(5)?),
            heading_level: r.get::<_, Option<i64>>(6)?.map(|v| v as u8),
            code_lang: r.get(7)?,
            has_explicit_id: r.get::<_, i64>(8)? != 0,
            raw_content: r.get(9)?,
            plain_text: r.get(10)?,
            properties: serde_json::from_str(&props_str).unwrap_or_default(),
            tags: serde_json::from_str(&tags_str).unwrap_or_default(),
            collapsed: r.get::<_, i64>(13)? != 0,
            task,
            updated_at: r.get(14)?,
        })
    }

    pub fn get_block_by_id(&self, block_id: &str) -> Result<Option<BlockLookup>> {
        let row = self
            .conn
            .query_row(
                "
                SELECT
                    b.id, b.doc_id, b.parent_block_id, b.depth, b.sort_order, b.block_type,
                    b.heading_level, b.code_lang, b.has_explicit_id, b.raw_content, b.plain_text,
                    json(b.properties_jsonb), b.tags_json, b.collapsed, b.updated_at,
                    t.status, t.priority, t.scheduled_at, t.deadline_at, t.recurrence,
                    d.path, d.title
                FROM blocks b
                INNER JOIN documents d ON d.id = b.doc_id
                LEFT JOIN tasks t ON t.block_id = b.id
                WHERE b.id = ?1
                ",
                params![block_id],
                |r| {
                    let block = Self::map_block_row(r)?;
                    let doc_path: String = r.get(20)?;
                    let doc_title: String = r.get(21)?;
                    Ok(BlockLookup {
                        block,
                        doc_path,
                        doc_title,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Executes an FTS5 BM25 full-text search with structured operator support:
    /// `tag:#foo`/`tag:foo`, `path:daily/`, `status:TODO|DOING|DONE|CANCELED`,
    /// `"exact phrase"`, `-excluded`, and plain prefix terms.
    /// Also supports filter-only queries without free-text keywords.
    pub fn search_fts(&self, raw_query: &str, limit: usize) -> Result<SearchResponse> {
        let start = Instant::now();
        let trimmed = raw_query.trim();
        if trimmed.is_empty() {
            return Ok(SearchResponse {
                query: raw_query.to_string(),
                elapsed_us: start.elapsed().as_micros() as u64,
                total_hits: 0,
                results: Vec::new(),
            });
        }

        let parsed = parse_search_query(trimmed);
        let fts_expr = build_fts5_expr(&parsed);
        let has_structured = !parsed.tags.is_empty()
            || !parsed.paths.is_empty()
            || !parsed.statuses.is_empty()
            || !parsed.excluded.is_empty();

        if fts_expr.is_empty() && !has_structured {
            return Ok(SearchResponse {
                query: raw_query.to_string(),
                elapsed_us: start.elapsed().as_micros() as u64,
                total_hits: 0,
                results: Vec::new(),
            });
        }

        let mut sql = String::new();
        let mut where_clauses: Vec<String> = Vec::new();
        let mut bind_vals: Vec<SqlValue> = Vec::new();

        if !fts_expr.is_empty() {
            sql.push_str(
                "
                SELECT
                    b.id,
                    b.doc_id,
                    d.path,
                    d.title,
                    snippet(blocks_fts, 0, '<mark>', '</mark>', '…', 18),
                    b.plain_text,
                    bm25(blocks_fts) AS score
                FROM blocks_fts
                INNER JOIN blocks b ON b.rowid = blocks_fts.rowid
                INNER JOIN documents d ON d.id = b.doc_id
                LEFT JOIN tasks t ON t.block_id = b.id
                ",
            );
            bind_vals.push(SqlValue::Text(fts_expr));
            where_clauses.push(format!("blocks_fts MATCH ?{}", bind_vals.len()));
        } else {
            sql.push_str(
                "
                SELECT
                    b.id,
                    b.doc_id,
                    d.path,
                    d.title,
                    b.plain_text,
                    b.plain_text,
                    0.0 AS score
                FROM blocks b
                INNER JOIN documents d ON d.id = b.doc_id
                LEFT JOIN tasks t ON t.block_id = b.id
                ",
            );
        }

        for tag in &parsed.tags {
            let prefix = format!("{}/", tag);
            bind_vals.push(SqlValue::Text(tag.clone()));
            let p_exact = bind_vals.len();
            bind_vals.push(SqlValue::Text(prefix));
            let p_pref = bind_vals.len();
            where_clauses.push(format!(
                "(EXISTS (SELECT 1 FROM json_each(b.tags_json) WHERE lower(value) = ?{p_exact} OR substr(lower(value), 1, length(?{p_pref})) = ?{p_pref}) \
                 OR EXISTS (SELECT 1 FROM json_each(d.tags_json) WHERE lower(value) = ?{p_exact} OR substr(lower(value), 1, length(?{p_pref})) = ?{p_pref}))"
            ));
        }

        for path_filter in &parsed.paths {
            bind_vals.push(SqlValue::Text(path_filter.clone()));
            let idx = bind_vals.len();
            where_clauses.push(format!("instr(lower(d.path), ?{idx}) > 0"));
        }

        if !parsed.statuses.is_empty() {
            let mut placeholders = Vec::with_capacity(parsed.statuses.len());
            for status in &parsed.statuses {
                bind_vals.push(SqlValue::Text(status.clone()));
                placeholders.push(format!("?{}", bind_vals.len()));
            }
            where_clauses.push(format!("upper(t.status) IN ({})", placeholders.join(", ")));
        }

        for excl in &parsed.excluded {
            bind_vals.push(SqlValue::Text(excl.clone()));
            let idx = bind_vals.len();
            where_clauses.push(format!("instr(lower(b.plain_text), ?{idx}) = 0"));
        }

        if !where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&where_clauses.join(" AND "));
        }

        bind_vals.push(SqlValue::Integer(limit as i64));
        let limit_idx = bind_vals.len();

        if !parsed.phrases.is_empty() || !parsed.terms.is_empty() {
            sql.push_str(&format!(" ORDER BY score ASC LIMIT ?{limit_idx}"));
        } else {
            sql.push_str(&format!(
                " ORDER BY d.updated_at DESC, b.sort_order ASC LIMIT ?{limit_idx}"
            ));
        }

        let is_filter_only = parsed.phrases.is_empty() && parsed.terms.is_empty();
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(bind_vals.iter()), |r| {
            let raw_snippet: String = r.get(4)?;
            let plain_text: String = r.get(5)?;
            let snippet = if is_filter_only {
                truncate_snippet(&raw_snippet, 160)
            } else {
                raw_snippet
            };
            Ok(SearchResult {
                block_id: r.get(0)?,
                doc_id: r.get(1)?,
                doc_path: r.get(2)?,
                doc_title: r.get(3)?,
                snippet,
                plain_text,
                bm25_score: r.get(6)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }

        Ok(SearchResponse {
            query: raw_query.to_string(),
            elapsed_us: start.elapsed().as_micros() as u64,
            total_hits: results.len(),
            results,
        })
    }

    pub fn get_backlinks(&self, doc_id: &str) -> Result<Vec<BacklinkItem>> {
        let mut stmt = self.conn.prepare_cached(
            "
            SELECT DISTINCT
                d.id,
                d.path,
                d.title,
                b.id,
                b.plain_text,
                l.link_type,
                l.target_raw
            FROM links l
            INNER JOIN blocks b ON b.id = l.source_block_id
            INNER JOIN documents d ON d.id = l.source_doc_id
            WHERE l.target_doc_id = ?1 AND l.source_doc_id != ?1
            ORDER BY d.updated_at DESC, b.sort_order ASC
            ",
        )?;

        let rows = stmt.query_map(params![doc_id], |r| {
            Ok(BacklinkItem {
                source_doc_id: r.get(0)?,
                source_doc_path: r.get(1)?,
                source_doc_title: r.get(2)?,
                source_block_id: r.get(3)?,
                source_plain_text: r.get(4)?,
                link_type: LinkType::from_db_str(&r.get::<_, String>(5)?),
                target_raw: r.get(6)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn get_tasks(&self, status_filter: Option<TaskStatus>) -> Result<Vec<TaskViewItem>> {
        let sql = if status_filter.is_some() {
            "
            SELECT
                b.id, b.doc_id, d.path, d.title, b.plain_text,
                t.status, t.priority, t.scheduled_at, t.deadline_at, t.recurrence,
                b.tags_json
            FROM tasks t
            INNER JOIN blocks b ON b.id = t.block_id
            INNER JOIN documents d ON d.id = b.doc_id
            WHERE t.status = ?1
            ORDER BY COALESCE(t.deadline_at, '9999-99-99') ASC, COALESCE(t.priority, 9) ASC
            "
        } else {
            "
            SELECT
                b.id, b.doc_id, d.path, d.title, b.plain_text,
                t.status, t.priority, t.scheduled_at, t.deadline_at, t.recurrence,
                b.tags_json
            FROM tasks t
            INNER JOIN blocks b ON b.id = t.block_id
            INNER JOIN documents d ON d.id = b.doc_id
            ORDER BY
                CASE t.status WHEN 'DOING' THEN 0 WHEN 'TODO' THEN 1 WHEN 'DONE' THEN 2 ELSE 3 END,
                COALESCE(t.deadline_at, '9999-99-99') ASC,
                COALESCE(t.priority, 9) ASC
            "
        };

        let mut stmt = self.conn.prepare(sql)?;
        let map_row = |r: &rusqlite::Row<'_>| -> rusqlite::Result<TaskViewItem> {
            let tags_str: String = r.get(10)?;
            Ok(TaskViewItem {
                block_id: r.get(0)?,
                doc_id: r.get(1)?,
                doc_path: r.get(2)?,
                doc_title: r.get(3)?,
                content: r.get(4)?,
                status: TaskStatus::from_db_str(&r.get::<_, String>(5)?),
                priority: r.get::<_, Option<i64>>(6)?.map(|v| v as u8),
                scheduled_at: r.get(7)?,
                deadline_at: r.get(8)?,
                recurrence: r.get(9)?,
                tags: serde_json::from_str(&tags_str).unwrap_or_default(),
            })
        };

        let mut list = Vec::new();
        if let Some(status) = status_filter {
            let rows = stmt.query_map(params![status.as_str()], map_row)?;
            for r in rows {
                list.push(r?);
            }
        } else {
            let rows = stmt.query_map([], map_row)?;
            for r in rows {
                list.push(r?);
            }
        }
        Ok(list)
    }

    /// Queries structured document & block properties (JSONB) filtered by tag and predicates.
    pub fn query_database(&self, query: &DatabaseQuery) -> Result<DatabaseQueryResult> {
        let start = Instant::now();
        let mut rows_out: Vec<DatabaseRow> = Vec::new();
        let mut column_set: BTreeSet<String> = BTreeSet::new();

        // 1. Query Documents (with frontmatter + merged block properties)
        let mut doc_stmt = self.conn.prepare(
            "SELECT id, path, title, json(frontmatter_jsonb), tags_json, updated_at FROM documents",
        )?;
        let doc_rows = doc_stmt.query_map([], |r| {
            let fm_str: String = r.get(3)?;
            let tags_str: String = r.get(4)?;
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                fm_str,
                tags_str,
                r.get::<_, i64>(5)?,
            ))
        })?;

        for row in doc_rows {
            let (doc_id, doc_path, title, fm_str, tags_str, updated_at) = row?;
            let fm: BTreeMap<String, Value> = serde_json::from_str(&fm_str).unwrap_or_default();
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();

            let mut props: BTreeMap<String, String> = BTreeMap::new();
            for (k, v) in fm {
                if k == "tags" || k == "id" || k == "title" {
                    continue;
                }
                let val_str = match v {
                    Value::String(s) => s,
                    Value::Array(arr) => arr
                        .into_iter()
                        .map(|x| x.to_string().trim_matches('"').to_string())
                        .collect::<Vec<_>>()
                        .join(", "),
                    other => other.to_string(),
                };
                props.insert(k, val_str);
            }

            // Merge block-level properties belonging to this document when not already set in frontmatter
            let mut blk_prop_stmt = self.conn.prepare_cached(
                "SELECT json(properties_jsonb) FROM blocks WHERE doc_id = ?1",
            )?;
            let blk_prop_rows = blk_prop_stmt.query_map(params![doc_id], |r| r.get::<_, String>(0))?;
            for bp_res in blk_prop_rows {
                let bp_str = bp_res?;
                let bp_map: BTreeMap<String, String> =
                    serde_json::from_str(&bp_str).unwrap_or_default();
                for (k, v) in bp_map {
                    props.entry(k).or_insert(v);
                }
            }

            if !matches_tag(&tags, query.tag.as_deref()) {
                continue;
            }
            if !matches_filters(&props, &query.filters) {
                continue;
            }

            for k in props.keys() {
                column_set.insert(k.clone());
            }

            let task_status = props
                .get("status")
                .map(|s| match s.to_uppercase().as_str() {
                    "DONE" | "COMPLETED" => TaskStatus::Done,
                    "DOING" | "ACTIVE" | "IN-PROGRESS" => TaskStatus::Doing,
                    "CANCELED" => TaskStatus::Canceled,
                    _ => TaskStatus::Todo,
                });

            rows_out.push(DatabaseRow {
                id: doc_id.clone(),
                item_kind: "document".to_string(),
                doc_id,
                doc_path,
                title,
                tags,
                properties: props,
                task_status,
                updated_at,
            });
        }

        if let Some(ref sort_col) = query.sort_by {
            rows_out.sort_by(|a, b| {
                let va = a.properties.get(sort_col).map(|s| s.as_str()).unwrap_or("");
                let vb = b.properties.get(sort_col).map(|s| s.as_str()).unwrap_or("");
                let ord = va.cmp(vb).then_with(|| a.title.cmp(&b.title));
                if query.sort_desc {
                    ord.reverse()
                } else {
                    ord
                }
            });
        } else {
            rows_out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        }

        Ok(DatabaseQueryResult {
            elapsed_us: start.elapsed().as_micros() as u64,
            columns: column_set.into_iter().collect(),
            rows: rows_out,
        })
    }

    pub fn get_graph_raw_data(
        &self,
    ) -> Result<(Vec<(String, String, String, Vec<String>)>, Vec<(String, Option<String>, String, LinkType)>)> {
        let mut doc_stmt = self.conn.prepare("SELECT id, title, path, tags_json FROM documents")?;
        let docs = doc_stmt
            .query_map([], |r| {
                let tags_str: String = r.get(3)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    tags,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut link_stmt = self
            .conn
            .prepare("SELECT source_doc_id, target_doc_id, target_raw, link_type FROM links")?;
        let links = link_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    LinkType::from_db_str(&r.get::<_, String>(3)?),
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok((docs, links))
    }

    pub fn sync_canvas_index(&mut self, canvas: &CanvasData) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM canvas_nodes WHERE canvas_path = ?1",
            params![canvas.path],
        )?;
        tx.execute(
            "DELETE FROM canvas_edges WHERE canvas_path = ?1",
            params![canvas.path],
        )?;

        {
            let mut n_stmt = tx.prepare_cached(
                "INSERT INTO canvas_nodes (id, canvas_path, ref_doc_path, ref_block_id, x, y, width, height, node_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            for n in &canvas.nodes {
                n_stmt.execute(params![
                    n.id,
                    canvas.path,
                    n.ref_doc_path,
                    n.ref_block_id,
                    n.x,
                    n.y,
                    n.width,
                    n.height,
                    n.node_type,
                ])?;
            }

            let mut e_stmt = tx.prepare_cached(
                "INSERT INTO canvas_edges (id, canvas_path, from_node_id, to_node_id, label)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for e in &canvas.edges {
                e_stmt.execute(params![e.id, canvas.path, e.from_node, e.to_node, e.label])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn delete_canvas_index(&mut self, canvas_path: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM canvas_nodes WHERE canvas_path = ?1",
            params![canvas_path],
        )?;
        tx.execute(
            "DELETE FROM canvas_edges WHERE canvas_path = ?1",
            params![canvas_path],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Records a versioned content snapshot for `doc_path`.
    /// Skips insertion when the most recent snapshot already has an identical `blake3_hash`,
    /// and prunes older snapshots so at most 30 are retained per document.
    pub fn record_snapshot(
        &mut self,
        doc_path: &str,
        blake3_hash: &str,
        content: &str,
        created_at: i64,
    ) -> Result<()> {
        let latest_hash: Option<String> = self
            .conn
            .query_row(
                "SELECT blake3_hash FROM doc_snapshots WHERE doc_path = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![doc_path],
                |r| r.get(0),
            )
            .optional()?;

        if latest_hash.as_deref() == Some(blake3_hash) {
            return Ok(());
        }

        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO doc_snapshots (doc_path, blake3_hash, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![doc_path, blake3_hash, content, created_at],
        )?;
        tx.execute(
            "DELETE FROM doc_snapshots
             WHERE doc_path = ?1 AND id NOT IN (
                 SELECT id FROM doc_snapshots
                 WHERE doc_path = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT 30
             )",
            params![doc_path],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_snapshots(&self, doc_path: &str) -> Result<Vec<DocumentSnapshot>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, doc_path, blake3_hash, content, created_at
             FROM doc_snapshots
             WHERE doc_path = ?1
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![doc_path], |r| {
            let content: String = r.get(3)?;
            let byte_len = content.len();
            Ok(DocumentSnapshot {
                id: r.get(0)?,
                doc_path: r.get(1)?,
                blake3_hash: r.get(2)?,
                content,
                created_at: r.get(4)?,
                byte_len,
            })
        })?;
        let mut list = Vec::new();
        for row in rows {
            list.push(row?);
        }
        Ok(list)
    }

    pub fn get_snapshot_by_id(&self, id: i64) -> Result<Option<DocumentSnapshot>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, doc_path, blake3_hash, content, created_at FROM doc_snapshots WHERE id = ?1",
                params![id],
                |r| {
                    let content: String = r.get(3)?;
                    let byte_len = content.len();
                    Ok(DocumentSnapshot {
                        id: r.get(0)?,
                        doc_path: r.get(1)?,
                        blake3_hash: r.get(2)?,
                        content,
                        created_at: r.get(4)?,
                        byte_len,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Finds blocks in other documents that mention the target document's title or aliases
    /// (length >= 3, case-insensitive word-boundary match) without already linking to `doc_id`
    /// or wrapping the mention inside `[[...]]`.
    pub fn get_unlinked_mentions(&self, doc_id: &str) -> Result<Vec<UnlinkedMention>> {
        let target_doc = self
            .conn
            .query_row(
                "SELECT id, path, title, blake3_hash, json(frontmatter_jsonb), tags_json, created_at, updated_at
                 FROM documents WHERE id = ?1",
                params![doc_id],
                Self::map_document_row,
            )
            .optional()?;

        let Some(target_doc) = target_doc else {
            return Ok(Vec::new());
        };

        let mut terms: Vec<String> = Vec::new();
        let mut seen_lower: HashSet<String> = HashSet::new();
        let mut push_term = |candidate: String| {
            let trimmed = candidate.trim().to_string();
            if trimmed.chars().count() >= 3 && seen_lower.insert(trimmed.to_lowercase()) {
                terms.push(trimmed);
            }
        };
        push_term(target_doc.title.clone());
        for alias in extract_frontmatter_aliases(&target_doc.frontmatter) {
            push_term(alias);
        }

        // Prefer longer terms first so more specific names match before shorter prefixes
        terms.sort_by(|a, b| b.chars().count().cmp(&a.chars().count()).then_with(|| a.cmp(b)));

        if terms.is_empty() {
            return Ok(Vec::new());
        }

        let mut linked_block_ids: HashSet<String> = HashSet::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT DISTINCT source_block_id FROM links WHERE target_doc_id = ?1")?;
            let rows = stmt.query_map(params![doc_id], |r| r.get::<_, String>(0))?;
            for row in rows {
                linked_block_ids.insert(row?);
            }
        }

        let mut stmt = self.conn.prepare(
            "
            SELECT b.id, b.doc_id, d.path, d.title, b.raw_content, b.plain_text
            FROM blocks b
            INNER JOIN documents d ON d.id = b.doc_id
            WHERE b.doc_id != ?1 AND b.block_type NOT IN ('code', 'divider')
            ORDER BY d.updated_at DESC, b.sort_order ASC
            ",
        )?;

        let rows = stmt.query_map(params![doc_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;

        let mut mentions = Vec::new();
        for row in rows {
            let (block_id, src_doc_id, src_doc_path, src_doc_title, raw_content, plain_text) = row?;
            if linked_block_ids.contains(&block_id) {
                continue;
            }
            for term in &terms {
                if let Some((start, end)) = find_unlinked_word_boundary_match(&raw_content, term) {
                    mentions.push(UnlinkedMention {
                        source_doc_id: src_doc_id,
                        source_doc_path: src_doc_path,
                        source_doc_title: src_doc_title,
                        source_block_id: block_id,
                        source_plain_text: plain_text,
                        matched_term: raw_content[start..end].to_string(),
                    });
                    break;
                }
            }
        }

        Ok(mentions)
    }

    /// Computes vault-wide statistics: word/char counts, reading time, orphan notes,
    /// broken wiki/embed links, top hubs, and largest documents.
    pub fn get_vault_analytics(&self, db_path: &Path) -> Result<VaultAnalytics> {
        let summaries = self.list_document_summaries()?;
        let total_documents = summaries.len();

        let mut total_blocks = 0usize;
        let mut total_words = 0usize;
        let mut total_chars = 0usize;
        let mut doc_word_counts: HashMap<String, usize> = HashMap::new();

        {
            let mut stmt = self.conn.prepare("SELECT doc_id, plain_text FROM blocks")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (doc_id, plain_text) = row?;
                total_blocks += 1;
                let words = plain_text.split_whitespace().count();
                let chars = plain_text.chars().count();
                total_words += words;
                total_chars += chars;
                *doc_word_counts.entry(doc_id).or_insert(0) += words;
            }
        }

        let estimated_reading_minutes = if total_words == 0 {
            0
        } else {
            (total_words / 200).max(1)
        };
        let db_size_bytes = fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);

        // Compute per-document doc-to-doc degree (distinct connected neighbor documents)
        // and collect unresolved wiki/embed links.
        let mut neighbors: HashMap<String, HashSet<String>> = HashMap::new();
        for doc in &summaries {
            neighbors.insert(doc.id.clone(), HashSet::new());
        }

        // key = target_raw lowercase -> (display target_raw, count, source_docs set)
        let mut broken_map: HashMap<String, (String, usize, BTreeSet<String>)> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "
                SELECT l.source_doc_id, l.target_doc_id, l.target_raw, l.link_type, d.path
                FROM links l
                INNER JOIN documents d ON d.id = l.source_doc_id
                ",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?;

            for row in rows {
                let (src_id, tgt_opt, target_raw, link_type, src_path) = row?;
                if link_type == "tag" {
                    continue;
                }
                if let Some(tgt_id) = tgt_opt {
                    if tgt_id != src_id && neighbors.contains_key(&tgt_id) {
                        if let Some(set) = neighbors.get_mut(&src_id) {
                            set.insert(tgt_id.clone());
                        }
                        if let Some(set) = neighbors.get_mut(&tgt_id) {
                            set.insert(src_id.clone());
                        }
                    }
                } else if (link_type == "wiki_link" || link_type == "embed")
                    && !target_raw.trim().is_empty()
                {
                    let key = target_raw.to_lowercase();
                    let entry = broken_map
                        .entry(key)
                        .or_insert_with(|| (target_raw.clone(), 0, BTreeSet::new()));
                    entry.1 += 1;
                    entry.2.insert(src_path);
                }
            }
        }

        let mut orphan_documents = Vec::new();
        let mut hub_entries: Vec<HubDocInfo> = Vec::with_capacity(summaries.len());
        for doc in summaries {
            let degree = neighbors.get(&doc.id).map(|s| s.len()).unwrap_or(0);
            let word_count = doc_word_counts.get(&doc.id).copied().unwrap_or(0);
            hub_entries.push(HubDocInfo {
                doc_id: doc.id.clone(),
                path: doc.path.clone(),
                title: doc.title.clone(),
                degree,
                word_count,
            });
            if degree == 0 {
                orphan_documents.push(doc);
            }
        }

        let mut broken_links: Vec<BrokenLinkInfo> = broken_map
            .into_values()
            .map(|(target_raw, reference_count, docs)| BrokenLinkInfo {
                target_raw,
                reference_count,
                source_docs: docs.into_iter().collect(),
            })
            .collect();
        broken_links.sort_by(|a, b| {
            b.reference_count
                .cmp(&a.reference_count)
                .then_with(|| a.target_raw.cmp(&b.target_raw))
        });

        let mut top_hubs = hub_entries.clone();
        top_hubs.sort_by(|a, b| {
            b.degree
                .cmp(&a.degree)
                .then_with(|| b.word_count.cmp(&a.word_count))
                .then_with(|| a.title.cmp(&b.title))
        });
        top_hubs.truncate(8);

        let mut largest_documents = hub_entries;
        largest_documents.sort_by(|a, b| {
            b.word_count
                .cmp(&a.word_count)
                .then_with(|| b.degree.cmp(&a.degree))
                .then_with(|| a.title.cmp(&b.title))
        });
        largest_documents.truncate(8);

        Ok(VaultAnalytics {
            total_documents,
            total_blocks,
            total_words,
            total_chars,
            estimated_reading_minutes,
            db_size_bytes,
            orphan_documents,
            broken_links,
            top_hubs,
            largest_documents,
        })
    }

    /// Runs FTS5 merge optimization and SQLite query-planner `PRAGMA optimize`.
    pub fn optimize_index(&self, db_path: &Path) -> Result<OptimizeReport> {
        let start = Instant::now();
        let db_size_before_bytes = fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);

        self.conn.execute_batch(
            "
            INSERT INTO blocks_fts(blocks_fts) VALUES('optimize');
            PRAGMA optimize;
            ",
        )?;

        let db_size_after_bytes = fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
        Ok(OptimizeReport {
            elapsed_us: start.elapsed().as_micros() as u64,
            db_size_before_bytes,
            db_size_after_bytes,
        })
    }
}

fn matches_tag(doc_tags: &[String], required_tag: Option<&str>) -> bool {
    let Some(req) = required_tag else {
        return true;
    };
    let clean = req.trim().trim_start_matches('#').to_lowercase();
    if clean.is_empty() {
        return true;
    }
    doc_tags
        .iter()
        .any(|t| t.to_lowercase() == clean || t.to_lowercase().starts_with(&format!("{}/", clean)))
}

fn matches_filters(props: &BTreeMap<String, String>, filters: &[crate::model::PropertyFilter]) -> bool {
    for f in filters {
        let actual = props.get(&f.key).map(|s| s.to_lowercase()).unwrap_or_default();
        let expected = f.value.to_lowercase();
        let ok = match f.operator.as_str() {
            "eq" => actual == expected,
            "neq" => actual != expected,
            "contains" => actual.contains(&expected),
            _ => true,
        };
        if !ok {
            return false;
        }
    }
    true
}

#[derive(Debug, Default)]
struct ParsedSearchQuery {
    tags: Vec<String>,
    paths: Vec<String>,
    statuses: Vec<String>,
    phrases: Vec<String>,
    excluded: Vec<String>,
    terms: Vec<String>,
}

fn parse_search_query(raw: &str) -> ParsedSearchQuery {
    let mut parsed = ParsedSearchQuery::default();
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0usize;

    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }

        // Negated quoted phrase: -"exact phrase"
        if chars[i] == '-' && i + 1 < chars.len() && chars[i + 1] == '"' {
            i += 2;
            let mut phrase = String::new();
            while i < chars.len() && chars[i] != '"' {
                phrase.push(chars[i]);
                i += 1;
            }
            if i < chars.len() && chars[i] == '"' {
                i += 1;
            }
            let clean = phrase.trim().to_lowercase();
            if !clean.is_empty() {
                parsed.excluded.push(clean);
            }
            continue;
        }

        // Quoted exact phrase: "exact phrase"
        if chars[i] == '"' {
            i += 1;
            let mut phrase = String::new();
            while i < chars.len() && chars[i] != '"' {
                phrase.push(chars[i]);
                i += 1;
            }
            if i < chars.len() && chars[i] == '"' {
                i += 1;
            }
            let clean = phrase.trim().replace('"', "");
            if !clean.is_empty() {
                parsed.phrases.push(clean);
            }
            continue;
        }

        // Unquoted token
        let mut token = String::new();
        while i < chars.len() && !chars[i].is_whitespace() {
            token.push(chars[i]);
            i += 1;
        }

        let lower = token.to_lowercase();
        if let Some(rest) = lower.strip_prefix("tag:") {
            let clean = rest.trim().trim_start_matches('#').to_string();
            if !clean.is_empty() {
                parsed.tags.push(clean);
            }
        } else if let Some(rest) = lower.strip_prefix("path:") {
            let clean = rest.trim().replace('\\', "/");
            if !clean.is_empty() {
                parsed.paths.push(clean);
            }
        } else if let Some(rest) = lower.strip_prefix("status:") {
            for part in rest.split(['|', ',']) {
                let s = part.trim().to_uppercase();
                if !s.is_empty() {
                    parsed.statuses.push(s);
                }
            }
        } else if let Some(rest) = token.strip_prefix('-') {
            let clean = rest.trim().to_lowercase();
            if !clean.is_empty() {
                parsed.excluded.push(clean);
            }
        } else {
            let cleaned: String = token
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !cleaned.is_empty() {
                parsed.terms.push(cleaned);
            }
        }
    }

    parsed
}

fn build_fts5_expr(parsed: &ParsedSearchQuery) -> String {
    let mut parts: Vec<String> = Vec::new();
    for phrase in &parsed.phrases {
        let escaped = phrase.replace('"', "");
        if !escaped.is_empty() {
            parts.push(format!("\"{}\"", escaped));
        }
    }
    for term in &parsed.terms {
        parts.push(format!("\"{}\"*", term));
    }
    parts.join(" ")
}

fn truncate_snippet(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let collected: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}…", collected.trim_end())
    } else {
        collected
    }
}

/// Extracts document frontmatter aliases from `aliases` or `alias` (array of strings or single string).
pub fn extract_frontmatter_aliases(fm: &BTreeMap<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    for key in ["aliases", "alias"] {
        if let Some(val) = fm.get(key) {
            match val {
                Value::String(s) => {
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
                Value::Array(arr) => {
                    for item in arr {
                        if let Value::String(s) = item {
                            let trimmed = s.trim();
                            if !trimmed.is_empty() {
                                out.push(trimmed.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

fn collect_wikilink_spans(raw: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let bytes = raw.as_bytes();
    let mut pos = 0usize;
    while pos + 1 < bytes.len() {
        if bytes[pos] == b'[' && bytes[pos + 1] == b'[' {
            let span_start = if pos > 0 && bytes[pos - 1] == b'!' {
                pos - 1
            } else {
                pos
            };
            if let Some(end_rel) = raw[pos + 2..].find("]]") {
                let span_end = pos + 2 + end_rel + 2;
                spans.push((span_start, span_end));
                pos = span_end;
                continue;
            }
        }
        pos += 1;
    }
    spans
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Finds the first case-insensitive word-boundary match of `term` inside `raw` that does NOT
/// lie inside any `[[...]]` or `![[...]]` wiki-link span. Returns `(byte_start, byte_end)`.
pub fn find_unlinked_word_boundary_match(raw: &str, term: &str) -> Option<(usize, usize)> {
    let term_trimmed = term.trim();
    if term_trimmed.is_empty() {
        return None;
    }
    let term_chars: Vec<char> = term_trimmed.chars().collect();
    let link_spans = collect_wikilink_spans(raw);
    let raw_chars: Vec<(usize, char)> = raw.char_indices().collect();

    for idx in 0..raw_chars.len() {
        if idx + term_chars.len() > raw_chars.len() {
            break;
        }
        // Check left word boundary
        if idx > 0 && is_word_char(raw_chars[idx - 1].1) {
            continue;
        }
        let mut matched = true;
        for (offset, expected) in term_chars.iter().enumerate() {
            let actual = raw_chars[idx + offset].1;
            if !actual.to_lowercase().eq(expected.to_lowercase()) {
                matched = false;
                break;
            }
        }
        if !matched {
            continue;
        }
        // Check right word boundary
        let after_idx = idx + term_chars.len();
        if after_idx < raw_chars.len() && is_word_char(raw_chars[after_idx].1) {
            continue;
        }

        let byte_start = raw_chars[idx].0;
        let byte_end = if after_idx < raw_chars.len() {
            raw_chars[after_idx].0
        } else {
            raw.len()
        };

        let inside_link = link_spans
            .iter()
            .any(|&(ls, le)| byte_start < le && byte_end > ls);
        if !inside_link {
            return Some((byte_start, byte_end));
        }
    }

    None
}

pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn incremental_sync_and_fts5_search_work() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let db_path = dir.path().join("index.sqlite");
        fs::create_dir_all(&vault_dir).unwrap();

        fs::write(
            vault_dir.join("Alpha.md"),
            "# Alpha Projekt\n\nDieses Dokument beschreibt [[Beta]] und eine schnelle Suche.\n\n- [ ] Task erledigen priority:: 1\n",
        )
        .unwrap();
        fs::write(
            vault_dir.join("Beta.md"),
            "# Beta\n\nZurück zu [[Alpha]] mit #architektur.\n",
        )
        .unwrap();

        let mut db = Database::open(&db_path).unwrap();
        let stats1 = db.sync_vault(&vault_dir).unwrap();
        assert_eq!(stats1.files_scanned, 2);
        assert_eq!(stats1.files_reindexed, 2);
        assert_eq!(stats1.total_tasks, 1);

        // Second sync without modifications skips all files via BLAKE3
        let stats2 = db.sync_vault(&vault_dir).unwrap();
        assert_eq!(stats2.files_reindexed, 0);
        assert_eq!(stats2.files_skipped_unchanged, 2);

        // FTS5 search
        let search = db.search_fts("schnelle Suche", 10).unwrap();
        assert_eq!(search.total_hits, 1);
        assert_eq!(search.results[0].doc_title, "Alpha Projekt");
        assert!(search.results[0].snippet.contains("<mark>"));

        // Backlinks to Beta
        let beta = db.get_document_by_path("Beta.md").unwrap().unwrap();
        let backlinks = db.get_backlinks(&beta.0.id).unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_doc_title, "Alpha Projekt");
    }

    #[test]
    fn snapshots_deduplicate_and_prune_to_30() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("index.sqlite");
        let mut db = Database::open(&db_path).unwrap();

        // Identical consecutive hash is deduplicated
        db.record_snapshot("Note.md", "hash-1", "v1", 100).unwrap();
        db.record_snapshot("Note.md", "hash-1", "v1", 101).unwrap();
        assert_eq!(db.list_snapshots("Note.md").unwrap().len(), 1);

        // Insert 35 distinct versions -> pruned to 30 newest
        for i in 2..=35 {
            let h = format!("hash-{}", i);
            let content = format!("content version {}", i);
            db.record_snapshot("Note.md", &h, &content, 100 + i).unwrap();
        }
        let snaps = db.list_snapshots("Note.md").unwrap();
        assert_eq!(snaps.len(), 30);
        assert_eq!(snaps[0].content, "content version 35");
        assert_eq!(snaps[0].byte_len, "content version 35".len());
        assert_eq!(snaps.last().unwrap().content, "content version 6");

        let loaded = db.get_snapshot_by_id(snaps[0].id).unwrap().unwrap();
        assert_eq!(loaded.blake3_hash, "hash-35");
    }

    #[test]
    fn search_fts_supports_operators_phrases_exclusions_and_filter_only_queries() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let db_path = dir.path().join("index.sqlite");
        fs::create_dir_all(vault_dir.join("daily")).unwrap();

        fs::write(
            vault_dir.join("daily/2026-11-23.md"),
            "---\ntags: [daily, rust/core]\n---\n\n# Daily\n\n- [ ] Build fast search engine now\n- [x] Legacy slow module cleanup\n",
        )
        .unwrap();
        fs::write(
            vault_dir.join("Architecture.md"),
            "---\ntags: [architecture]\n---\n\n# Architecture\n\nThis exact phrase fast search engine lives in Rust.\n",
        )
        .unwrap();

        let mut db = Database::open(&db_path).unwrap();
        db.sync_vault(&vault_dir).unwrap();

        // Tag-only filter (with # prefix and nested tag matching)
        let by_tag = db.search_fts("tag:#rust", 20).unwrap();
        assert!(!by_tag.results.is_empty());
        assert!(by_tag.results.iter().all(|r| r.doc_path == "daily/2026-11-23.md"));

        // Path-only filter
        let by_path = db.search_fts("path:daily/", 20).unwrap();
        assert!(!by_path.results.is_empty());
        assert!(by_path.results.iter().all(|r| r.doc_path.starts_with("daily/")));

        // Status-only filter
        let by_status = db.search_fts("status:DONE", 20).unwrap();
        assert_eq!(by_status.total_hits, 1);
        assert!(by_status.results[0].plain_text.contains("Legacy"));

        // Exact phrase + exclusion
        let phrase = db.search_fts("\"fast search engine\" -Legacy", 20).unwrap();
        assert_eq!(phrase.total_hits, 2);

        // Combined structured + keyword + exclusion
        let combined = db
            .search_fts("tag:rust path:daily/ status:TODO search -Legacy", 20)
            .unwrap();
        assert_eq!(combined.total_hits, 1);
        assert!(combined.results[0].plain_text.contains("Build fast search engine"));
    }

    #[test]
    fn aliases_resolve_links_and_lookup_and_unlinked_mentions() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let db_path = dir.path().join("index.sqlite");
        fs::create_dir_all(&vault_dir).unwrap();

        fs::write(
            vault_dir.join("OxideVault.md"),
            "---\naliases: [Oxide Core, OVEngine]\n---\n\n# OxideVault\n\nMain note.\n",
        )
        .unwrap();
        fs::write(
            vault_dir.join("SingleAlias.md"),
            "---\nalias: QuickAlias\n---\n\n# SingleAlias\n\nBody.\n",
        )
        .unwrap();
        fs::write(
            vault_dir.join("Notes.md"),
            "# Notes\n\nLinked via [[ovengine]] and [[quickalias]].\n\nUnlinked mention of Oxide Core here.\n\nAlready wrapped [[Oxide Core]] does not trigger.\n\nSubstring OxideVaulting should not match word boundary.\n",
        )
        .unwrap();

        let mut db = Database::open(&db_path).unwrap();
        db.sync_vault(&vault_dir).unwrap();

        // Lookup by alias (array & single string) case-insensitively
        let (doc1, _) = db.get_document_by_id_or_title("ovengine").unwrap().unwrap();
        assert_eq!(doc1.path, "OxideVault.md");
        let (doc2, _) = db.get_document_by_id_or_title("quickalias").unwrap().unwrap();
        assert_eq!(doc2.path, "SingleAlias.md");

        // Backlinks resolved via both aliases (`ovengine` and `Oxide Core`)
        let bl1 = db.get_backlinks(&doc1.id).unwrap();
        assert_eq!(bl1.len(), 2);
        let bl2 = db.get_backlinks(&doc2.id).unwrap();
        assert_eq!(bl2.len(), 1);

        // Unlinked mentions finds ONLY the unlinked block ("Unlinked mention of Oxide Core here.")
        let mentions = db.get_unlinked_mentions(&doc1.id).unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_term, "Oxide Core");
        assert!(mentions[0].source_plain_text.contains("Unlinked mention"));
    }

    #[test]
    fn vault_analytics_and_optimize_index_report_accurate_metrics() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let db_path = dir.path().join("index.sqlite");
        fs::create_dir_all(&vault_dir).unwrap();

        fs::write(
            vault_dir.join("Hub.md"),
            "# Hub\n\nLinks to [[LeafA]] and [[LeafB]] and [[MissingTarget]].\n",
        )
        .unwrap();
        fs::write(vault_dir.join("LeafA.md"), "# LeafA\n\nBack to [[Hub]] and [[MissingTarget]].\n").unwrap();
        fs::write(vault_dir.join("LeafB.md"), "# LeafB\n\nSome extra words for size ranking here one two three four five six.\n").unwrap();
        fs::write(vault_dir.join("Orphan.md"), "# Orphan\n\nStandalone note with #tag only.\n").unwrap();

        let mut db = Database::open(&db_path).unwrap();
        db.sync_vault(&vault_dir).unwrap();

        let analytics = db.get_vault_analytics(&db_path).unwrap();
        assert_eq!(analytics.total_documents, 4);
        assert!(analytics.total_words > 0);
        assert!(analytics.total_chars > 0);
        assert!(analytics.estimated_reading_minutes >= 1);
        assert!(analytics.db_size_bytes > 0);
        assert_eq!(analytics.orphan_documents.len(), 1);
        assert_eq!(analytics.orphan_documents[0].path, "Orphan.md");
        assert_eq!(analytics.broken_links.len(), 1);
        assert_eq!(analytics.broken_links[0].target_raw, "MissingTarget");
        assert_eq!(analytics.broken_links[0].reference_count, 2);
        assert_eq!(analytics.broken_links[0].source_docs.len(), 2);
        assert_eq!(analytics.top_hubs[0].path, "Hub.md");
        assert_eq!(analytics.top_hubs[0].degree, 2);
        assert!(!analytics.largest_documents.is_empty());

        let opt = db.optimize_index(&db_path).unwrap();
        assert!(opt.db_size_before_bytes > 0);
        assert!(opt.db_size_after_bytes > 0);
    }
}
