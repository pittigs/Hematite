pub mod canvas;
pub mod db;
pub mod demo;
pub mod fs_utils;
pub mod graph;
pub mod model;
pub mod parser;
pub mod sync;
pub mod watcher;

use crate::canvas::{
    create_canvas as create_canvas_file, delete_canvas as delete_canvas_file, list_canvas_files,
    load_canvas, save_canvas,
};
use crate::db::{find_unlinked_word_boundary_match, now_unix, Database};
use crate::demo::seed_demo_vault;
use crate::fs_utils::{atomic_write, normalize_safe_md_path};
use crate::graph::{build_graph_snapshot, find_shortest_path};
use crate::model::{
    BacklinkItem, BenchmarkReport, Block, BlockLookup, CanvasData, DatabaseQuery,
    DatabaseQueryResult, Document, DocumentSnapshot, DocumentSummary, DocumentWithBlocks,
    GraphPathResult, GraphSnapshot, IndexStats, OptimizeReport, SearchResponse, SyncApplyReport,
    SyncCompactReport, SyncMergeReport, SyncOperationKind, SyncStatus, TaskStatus, TaskViewItem,
    TrashItem, UnlinkedMention, VaultAnalytics, VaultOverview,
};
use crate::parser::{parse_markdown_document, serialize_document_to_markdown};
use crate::sync::CrdtSyncEngine;
use anyhow::{anyhow, Context, Result};
use chrono::{Days, Local, Months, NaiveDate};
use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tempfile::tempdir;
use uuid::Uuid;
use walkdir::WalkDir;

/// High-level facade coordinating the Cloud-safe Vault files, the local SQLite turbo-index,
/// the multi-threaded graph engine, and the append-only CRDT sync log.
pub struct VaultEngine {
    vault_path: PathBuf,
    db_path: PathBuf,
    db: Database,
    sync: CrdtSyncEngine,
    revision: u64,
}

impl VaultEngine {
    /// Opens a vault using an explicit local SQLite cache path (kept outside cloud-synced folders).
    pub fn open(vault_path: impl AsRef<Path>, cache_db_path: Option<PathBuf>) -> Result<Self> {
        let vault_path = vault_path.as_ref().to_path_buf();
        fs::create_dir_all(&vault_path)?;

        let db_path = cache_db_path.unwrap_or_else(|| default_cache_db_path(&vault_path));
        let mut db = Database::open(&db_path)?;
        db.sync_vault(&vault_path)?;

        let device_id = format!(
            "node-{}",
            &blake3::hash(vault_path.to_string_lossy().as_bytes()).to_hex()[..8]
        );
        let sync = CrdtSyncEngine::open_for_vault(device_id, &vault_path)?;
        sync.ensure_sync_dir(&vault_path)?;

        // Index any existing canvas files into SQLite
        for canvas_rel in list_canvas_files(&vault_path)? {
            if let Ok(c) = load_canvas(&vault_path, &canvas_rel) {
                let _ = db.sync_canvas_index(&c);
            }
        }

        Ok(Self {
            vault_path,
            db_path,
            db,
            sync,
            revision: 1,
        })
    }

    pub fn vault_path(&self) -> &Path {
        &self.vault_path
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn bump_revision(&mut self) -> u64 {
        self.revision = self.revision.saturating_add(1);
        self.revision
    }

    pub fn seed_demo(&mut self) -> Result<IndexStats> {
        seed_demo_vault(&self.vault_path)?;
        self.reindex_vault()
    }

    pub fn reindex_vault(&mut self) -> Result<IndexStats> {
        let stats = self.db.sync_vault(&self.vault_path)?;
        for canvas_rel in list_canvas_files(&self.vault_path)? {
            if let Ok(c) = load_canvas(&self.vault_path, &canvas_rel) {
                let _ = self.db.sync_canvas_index(&c);
            }
        }
        if stats.files_reindexed > 0 || stats.files_deleted > 0 {
            self.bump_revision();
        }
        Ok(stats)
    }

    pub fn get_overview(&self) -> Result<VaultOverview> {
        let (total_documents, total_blocks, total_links, total_tasks, open_tasks) =
            self.db.get_vault_counts()?;
        let db_size_bytes = fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0);
        let canvas_files = list_canvas_files(&self.vault_path)?;
        let sync_status = self.sync.inspect_status(&self.vault_path)?;
        let trash_count = self.list_trash()?.len();

        Ok(VaultOverview {
            vault_path: self.vault_path.to_string_lossy().to_string(),
            db_path: self.db_path.to_string_lossy().to_string(),
            total_documents,
            total_blocks,
            total_links,
            total_tasks,
            open_tasks,
            db_size_bytes,
            canvas_files,
            sync_status,
            revision: self.revision,
            trash_count,
        })
    }

    pub fn list_documents(&self) -> Result<Vec<DocumentSummary>> {
        self.db.list_document_summaries()
    }

    pub fn get_document(&self, path_or_title: &str) -> Result<Option<DocumentWithBlocks>> {
        let found = if path_or_title.ends_with(".md") {
            self.db
                .get_document_by_path(path_or_title)?
                .or(self.db.get_document_by_id_or_title(path_or_title)?)
        } else {
            self.db.get_document_by_id_or_title(path_or_title)?
        };

        let Some((document, blocks)) = found else {
            return Ok(None);
        };

        let abs = self.vault_path.join(&document.path);
        let raw_markdown = fs::read_to_string(&abs)
            .unwrap_or_else(|_| serialize_document_to_markdown(&document, &blocks));

        Ok(Some(DocumentWithBlocks {
            document,
            blocks,
            raw_markdown,
        }))
    }

    pub fn save_markdown_document(
        &mut self,
        rel_path: &str,
        markdown: &str,
    ) -> Result<DocumentWithBlocks> {
        let (clean_rel, abs) = normalize_safe_md_path(&self.vault_path, rel_path)?;
        atomic_write(&abs, markdown)?;

        let now = now_unix();
        let parsed = parse_markdown_document(&clean_rel, markdown, now, now);
        self.db.upsert_single_document(&parsed)?;
        self.db
            .record_snapshot(&clean_rel, &parsed.document.blake3_hash, markdown, now)?;

        self.sync.append_op(
            &self.vault_path,
            &clean_rel,
            parsed
                .blocks
                .first()
                .map(|b| b.block.id.as_str())
                .unwrap_or("doc"),
            SyncOperationKind::UpsertBlock,
            serde_json::json!({
                "blake3": parsed.document.blake3_hash,
                "blockCount": parsed.blocks.len(),
            }),
        )?;

        self.bump_revision();

        self.get_document(&clean_rel)?
            .ok_or_else(|| anyhow!("Saved document could not be reloaded"))
    }

    pub fn save_document_blocks(
        &mut self,
        rel_path: &str,
        document: Document,
        blocks: Vec<Block>,
    ) -> Result<DocumentWithBlocks> {
        let markdown = serialize_document_to_markdown(&document, &blocks);
        self.save_markdown_document(rel_path, &markdown)
    }

    pub fn create_document(
        &mut self,
        rel_path: &str,
        title: Option<&str>,
    ) -> Result<DocumentWithBlocks> {
        let (clean_rel, abs) = normalize_safe_md_path(&self.vault_path, rel_path)?;
        if abs.exists() {
            if let Some(existing) = self.get_document(&clean_rel)? {
                return Ok(existing);
            }
        }
        let doc_title = title.map(|s| s.to_string()).unwrap_or_else(|| {
            Path::new(&clean_rel)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Neue Notiz")
                .to_string()
        });
        let template = format!("# {}\n\nSchreibe hier deine Gedanken oder tippe `/` für Blöcke, `[[` für Wiki-Links oder `((` für Block-Referenzen.\n", doc_title);
        self.save_markdown_document(&clean_rel, &template)
    }

    /// Soft-deletes a Markdown document by moving it into `.trash/<trash_id>.md`
    /// and recording metadata in `.trash/index.json` so it can be restored later.
    pub fn delete_document(&mut self, rel_path: &str) -> Result<()> {
        let (clean_rel, abs) = normalize_safe_md_path(&self.vault_path, rel_path)?;
        let title = self
            .db
            .get_document_by_path(&clean_rel)?
            .map(|(doc, _)| doc.title)
            .unwrap_or_else(|| path_stem_str(&clean_rel));

        if abs.exists() {
            let content = fs::read(&abs)
                .with_context(|| format!("Konnte {} nicht für Papierkorb lesen", abs.display()))?;
            let size_bytes = content.len() as u64;
            let deleted_at = now_unix();
            let trash_id = format!("trash-{}-{}", deleted_at, &Uuid::new_v4().to_string()[..8]);
            let trash_dir = self.vault_path.join(".trash");
            let trash_file = trash_dir.join(format!("{}.md", trash_id));
            atomic_write(&trash_file, &content)?;
            fs::remove_file(&abs)?;

            let mut items = self.read_trash_index()?;
            items.push(TrashItem {
                trash_id,
                original_path: clean_rel.clone(),
                title,
                deleted_at,
                size_bytes,
            });
            items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
            self.write_trash_index(&items)?;
        }

        self.db.delete_document_by_path(&clean_rel)?;
        self.sync.append_op(
            &self.vault_path,
            &clean_rel,
            "doc",
            SyncOperationKind::DeleteBlock,
            serde_json::json!({ "deleted": true }),
        )?;
        self.bump_revision();
        Ok(())
    }

    fn read_trash_index(&self) -> Result<Vec<TrashItem>> {
        let index_path = self.vault_path.join(".trash").join("index.json");
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&index_path)?;
        let items: Vec<TrashItem> = serde_json::from_str(&raw).unwrap_or_default();
        Ok(items)
    }

    fn write_trash_index(&self, items: &[TrashItem]) -> Result<()> {
        let index_path = self.vault_path.join(".trash").join("index.json");
        let json = serde_json::to_string_pretty(items)?;
        atomic_write(&index_path, json)?;
        Ok(())
    }

    pub fn list_trash(&self) -> Result<Vec<TrashItem>> {
        let trash_dir = self.vault_path.join(".trash");
        let mut items: Vec<TrashItem> = self
            .read_trash_index()?
            .into_iter()
            .filter(|item| trash_dir.join(format!("{}.md", item.trash_id)).exists())
            .collect();
        items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
        Ok(items)
    }

    pub fn restore_trash_item(&mut self, trash_id: &str) -> Result<DocumentWithBlocks> {
        let clean_id = trash_id.trim();
        if clean_id.is_empty()
            || clean_id.contains('/')
            || clean_id.contains('\\')
            || clean_id.contains("..")
        {
            return Err(anyhow!("Ungültige Papierkorb-ID: {}", trash_id));
        }

        let mut items = self.read_trash_index()?;
        let pos = items
            .iter()
            .position(|item| item.trash_id == clean_id)
            .ok_or_else(|| anyhow!("Papierkorb-Eintrag nicht gefunden: {}", clean_id))?;
        let item = items[pos].clone();

        let trash_file = self.vault_path.join(".trash").join(format!("{}.md", clean_id));
        if !trash_file.exists() {
            return Err(anyhow!(
                "Papierkorb-Datei fehlt für Eintrag: {}",
                clean_id
            ));
        }
        let content = fs::read_to_string(&trash_file)?;

        let (orig_rel, orig_abs) = normalize_safe_md_path(&self.vault_path, &item.original_path)?;
        let dest_rel = if !orig_abs.exists() {
            orig_rel
        } else {
            let parent = Path::new(&orig_rel)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .filter(|s| !s.is_empty());
            let stem = path_stem_str(&orig_rel);
            let mut n = 1usize;
            loop {
                let candidate_name = format!("{} (restored {}).md", stem, n);
                let candidate_rel = match &parent {
                    Some(dir) => format!("{}/{}", dir, candidate_name),
                    None => candidate_name,
                };
                if !self.vault_path.join(&candidate_rel).exists() {
                    break candidate_rel;
                }
                n += 1;
            }
        };

        let restored = self.save_markdown_document(&dest_rel, &content)?;
        let _ = fs::remove_file(&trash_file);
        items.remove(pos);
        self.write_trash_index(&items)?;

        Ok(restored)
    }

    pub fn empty_trash(&mut self) -> Result<usize> {
        let trash_dir = self.vault_path.join(".trash");
        if !trash_dir.exists() {
            return Ok(0);
        }
        let mut removed = 0usize;
        for entry in fs::read_dir(&trash_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
                fs::remove_file(&path)?;
                removed += 1;
            }
        }
        self.write_trash_index(&[])?;
        if removed > 0 {
            self.bump_revision();
        }
        Ok(removed)
    }

    pub fn list_snapshots(&self, rel_path: &str) -> Result<Vec<DocumentSnapshot>> {
        let (clean_rel, _) = normalize_safe_md_path(&self.vault_path, rel_path)?;
        self.db.list_snapshots(&clean_rel)
    }

    pub fn restore_snapshot(&mut self, snapshot_id: i64) -> Result<DocumentWithBlocks> {
        let snap = self
            .db
            .get_snapshot_by_id(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot nicht gefunden: {}", snapshot_id))?;
        self.save_markdown_document(&snap.doc_path, &snap.content)
    }

    /// Safely renames/moves a Markdown document inside the vault and automatically updates
    /// matching `[[Wiki-Links]]` across all other notes.
    pub fn rename_document(
        &mut self,
        old_rel_path: &str,
        new_rel_path: &str,
    ) -> Result<DocumentWithBlocks> {
        let (old_clean, old_abs) = normalize_safe_md_path(&self.vault_path, old_rel_path)?;
        let (new_clean, new_abs) = normalize_safe_md_path(&self.vault_path, new_rel_path)?;

        if old_clean == new_clean {
            return self
                .get_document(&old_clean)?
                .ok_or_else(|| anyhow!("Dokument nicht gefunden: {}", old_clean));
        }
        if !old_abs.exists() {
            return Err(anyhow!("Quelldokument existiert nicht: {}", old_clean));
        }
        if new_abs.exists() {
            return Err(anyhow!("Zieldokument existiert bereits: {}", new_clean));
        }

        let old_doc = self.get_document(&old_clean)?;
        let old_title = old_doc
            .as_ref()
            .map(|d| d.document.title.clone())
            .unwrap_or_else(|| path_stem_str(&old_clean));
        let old_stem = path_stem_str(&old_clean);
        let old_no_ext = old_clean.trim_end_matches(".md").to_string();
        let new_stem = path_stem_str(&new_clean);

        if let Some(parent) = new_abs.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&old_abs, &new_abs).with_context(|| {
            format!(
                "Konnte {} nicht nach {} umbenennen",
                old_abs.display(),
                new_abs.display()
            )
        })?;

        // Update [[Wiki-Links]] in all vault markdown files referencing the old note
        let mut old_targets = vec![old_title, old_stem, old_no_ext];
        old_targets.sort();
        old_targets.dedup();

        for entry in WalkDir::new(&self.vault_path)
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
            .flatten()
        {
            if entry.file_type().is_file()
                && entry.path().extension().and_then(|s| s.to_str()) == Some("md")
            {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    let updated =
                        rewrite_wiki_links_in_markdown(&content, &old_targets, &new_stem);
                    if updated != content {
                        atomic_write(entry.path(), &updated)?;
                    }
                }
            }
        }

        self.db.delete_document_by_path(&old_clean)?;
        self.db.sync_vault(&self.vault_path)?;

        self.sync.append_op(
            &self.vault_path,
            &new_clean,
            "doc",
            SyncOperationKind::UpsertBlock,
            serde_json::json!({
                "renamedFrom": old_clean,
                "renamedTo": new_clean,
            }),
        )?;

        self.bump_revision();

        self.get_document(&new_clean)?
            .ok_or_else(|| anyhow!("Umbenanntes Dokument konnte nicht geladen werden"))
    }

    /// Materializes a lazy block ID (`^id`) into the Markdown file on disk when a user references it.
    pub fn materialize_block_id(&mut self, rel_path: &str, block_id: &str) -> Result<String> {
        let Some(mut doc_with_blocks) = self.get_document(rel_path)? else {
            return Err(anyhow!("Document not found: {}", rel_path));
        };

        let mut target_id = block_id.to_string();
        let mut found = false;
        for blk in &mut doc_with_blocks.blocks {
            if blk.id == block_id {
                blk.has_explicit_id = true;
                target_id = blk.id.clone();
                found = true;
                break;
            }
        }
        if !found {
            return Err(anyhow!("Block not found: {}", block_id));
        }

        self.save_document_blocks(rel_path, doc_with_blocks.document, doc_with_blocks.blocks)?;
        Ok(target_id)
    }

    pub fn get_block_by_id(&self, block_id: &str) -> Result<Option<BlockLookup>> {
        self.db.get_block_by_id(block_id)
    }

    pub fn search_fts(&self, query: &str, limit: usize) -> Result<SearchResponse> {
        self.db.search_fts(query, limit)
    }

    pub fn get_backlinks(&self, doc_id: &str) -> Result<Vec<BacklinkItem>> {
        self.db.get_backlinks(doc_id)
    }

    pub fn get_tasks(&self, status_filter: Option<TaskStatus>) -> Result<Vec<TaskViewItem>> {
        self.db.get_tasks(status_filter)
    }

    pub fn toggle_task_status(
        &mut self,
        block_id: &str,
        next_status: TaskStatus,
    ) -> Result<TaskViewItem> {
        let lookup = self
            .db
            .get_block_by_id(block_id)?
            .ok_or_else(|| anyhow!("Task block not found: {}", block_id))?;

        let mut doc_bundle = self
            .get_document(&lookup.doc_path)?
            .ok_or_else(|| anyhow!("Document not found: {}", lookup.doc_path))?;

        let mut spawned_recurrence: Option<(usize, Block)> = None;
        for (idx, blk) in doc_bundle.blocks.iter_mut().enumerate() {
            if blk.id == block_id {
                let rec_to_spawn = if let Some(ref mut task) = blk.task {
                    let was_done = task.status == TaskStatus::Done;
                    task.status = next_status;
                    if next_status == TaskStatus::Done && !was_done {
                        task.recurrence.clone()
                    } else {
                        None
                    }
                } else {
                    None
                };

                if let Some(rec) = rec_to_spawn {
                    if let Some(next_blk) = build_next_recurring_task_block(blk, &rec) {
                        spawned_recurrence = Some((idx + 1, next_blk));
                    }
                }
                break;
            }
        }

        if let Some((insert_at, next_blk)) = spawned_recurrence {
            doc_bundle.blocks.insert(insert_at, next_blk);
        }

        self.save_document_blocks(&lookup.doc_path, doc_bundle.document, doc_bundle.blocks)?;

        self.db
            .get_tasks(None)?
            .into_iter()
            .find(|t| t.block_id == block_id)
            .ok_or_else(|| anyhow!("Updated task not found after save"))
    }

    pub fn open_or_create_daily_note(&mut self, date_opt: Option<&str>) -> Result<DocumentWithBlocks> {
        let date = date_opt
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
        if !date
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(anyhow!("Ungültiges Daily-Note-Datum: {}", date));
        }
        let rel_path = format!("daily/{}.md", date);
        if let Some(existing) = self.get_document(&rel_path)? {
            return Ok(existing);
        }

        let template = format!(
            r#"---
tags: [daily]
date: {date}
---

# Daily Note – {date}

## Tagesfokus

- [ ] Wichtigste Aufgabe für heute festlegen
  priority:: 1
  scheduled:: {date}

## Notizen & Ideen

- 
"#,
            date = date
        );
        self.save_markdown_document(&rel_path, &template)
    }

    pub fn query_database(&self, query: &DatabaseQuery) -> Result<DatabaseQueryResult> {
        self.db.query_database(query)
    }

    pub fn get_graph_snapshot(&self, include_tags: bool) -> Result<GraphSnapshot> {
        build_graph_snapshot(&self.db, include_tags)
    }

    pub fn find_graph_path(&self, from_doc_id: &str, to_doc_id: &str) -> Result<GraphPathResult> {
        find_shortest_path(&self.db, from_doc_id, to_doc_id)
    }

    pub fn get_canvas(&self, rel_path: &str) -> Result<CanvasData> {
        load_canvas(&self.vault_path, rel_path)
    }

    pub fn save_canvas_data(&mut self, canvas: &CanvasData) -> Result<()> {
        save_canvas(&self.vault_path, canvas)?;
        self.db.sync_canvas_index(canvas)?;
        self.bump_revision();
        Ok(())
    }

    pub fn create_canvas(&mut self, rel_path: &str) -> Result<CanvasData> {
        let canvas = create_canvas_file(&self.vault_path, rel_path)?;
        self.db.sync_canvas_index(&canvas)?;
        self.bump_revision();
        Ok(canvas)
    }

    pub fn delete_canvas(&mut self, rel_path: &str) -> Result<()> {
        let clean_rel = delete_canvas_file(&self.vault_path, rel_path)?;
        self.db.delete_canvas_index(&clean_rel)?;
        self.bump_revision();
        Ok(())
    }

    pub fn get_sync_status(&self) -> Result<SyncStatus> {
        self.sync.inspect_status(&self.vault_path)
    }

    pub fn simulate_crdt_sync(&mut self) -> Result<SyncMergeReport> {
        self.sync.simulate_two_device_merge(&self.vault_path)
    }

    pub fn apply_remote_sync(&mut self) -> Result<SyncApplyReport> {
        let report = self.sync.apply_remote_ops(&self.vault_path)?;
        if report.ops_applied > 0 {
            let prev_rev = self.revision;
            self.reindex_vault()?;
            if self.revision == prev_rev {
                self.bump_revision();
            }
        }
        Ok(report)
    }

    pub fn compact_sync_oplogs(&self) -> Result<SyncCompactReport> {
        self.sync.compact_oplogs(&self.vault_path)
    }

    pub fn get_unlinked_mentions(&self, doc_id: &str) -> Result<Vec<UnlinkedMention>> {
        self.db.get_unlinked_mentions(doc_id)
    }

    pub fn link_unlinked_mention(
        &mut self,
        source_doc_path: &str,
        block_id: &str,
        mention_text: &str,
        target_title: &str,
    ) -> Result<()> {
        let mut doc_bundle = self
            .get_document(source_doc_path)?
            .ok_or_else(|| anyhow!("Document not found: {}", source_doc_path))?;

        let blk = doc_bundle
            .blocks
            .iter_mut()
            .find(|b| b.id == block_id)
            .ok_or_else(|| anyhow!("Block not found: {}", block_id))?;

        let (start, end) = find_unlinked_word_boundary_match(&blk.raw_content, mention_text)
            .ok_or_else(|| {
                anyhow!(
                    "Unverlinkte Erwähnung '{}' im Block '{}' nicht gefunden",
                    mention_text,
                    block_id
                )
            })?;

        let matched = &blk.raw_content[start..end];
        let replacement = if matched == target_title {
            format!("[[{}]]", target_title)
        } else {
            format!("[[{}|{}]]", target_title, matched)
        };
        let mut updated_raw = String::with_capacity(blk.raw_content.len() + replacement.len());
        updated_raw.push_str(&blk.raw_content[..start]);
        updated_raw.push_str(&replacement);
        updated_raw.push_str(&blk.raw_content[end..]);
        blk.raw_content = updated_raw;

        let doc_path = doc_bundle.document.path.clone();
        self.save_document_blocks(&doc_path, doc_bundle.document, doc_bundle.blocks)?;
        Ok(())
    }

    pub fn get_vault_analytics(&self) -> Result<VaultAnalytics> {
        self.db.get_vault_analytics(&self.db_path)
    }

    pub fn optimize_index(&self) -> Result<OptimizeReport> {
        self.db.optimize_index(&self.db_path)
    }

    /// Updates (or inserts) a YAML frontmatter key in the raw Markdown file while preserving
    /// the document body verbatim, then reindexes cleanly.
    pub fn update_document_property(
        &mut self,
        rel_path: &str,
        key: &str,
        value: &str,
    ) -> Result<DocumentWithBlocks> {
        let (clean_rel, abs) = normalize_safe_md_path(&self.vault_path, rel_path)?;
        if !abs.exists() {
            return Err(anyhow!("Dokument nicht gefunden: {}", clean_rel));
        }
        let clean_key = key.trim();
        if clean_key.is_empty()
            || clean_key.contains('\n')
            || clean_key.contains('\r')
            || clean_key.contains(':')
        {
            return Err(anyhow!("Ungültiger Property-Schlüssel: {}", key));
        }

        let raw_md = fs::read_to_string(&abs)
            .with_context(|| format!("Konnte {} nicht lesen", abs.display()))?;
        let updated_md = upsert_frontmatter_property(&raw_md, clean_key, value.trim());
        self.save_markdown_document(&clean_rel, &updated_md)
    }

    /// Runs an isolated 100,000-block benchmark (5,000 Markdown files x 20 blocks)
    /// to verify cold indexing speed, BLAKE3 delta-skip performance, FTS5 search latency,
    /// and multi-threaded graph construction.
    pub fn run_100k_benchmark() -> Result<BenchmarkReport> {
        let dir = tempdir().context("Failed to create temp dir for benchmark")?;
        let vault_dir = dir.path().join("bench-vault");
        let db_path = dir.path().join("bench-index.sqlite");
        fs::create_dir_all(&vault_dir)?;

        let file_count = 5_000usize;

        let gen_start = Instant::now();
        (0..file_count).into_par_iter().try_for_each(|i| -> Result<()> {
            let next_i = (i + 1) % file_count;
            let alt_i = (i + 17) % file_count;
            let mut content = format!(
                "---\ntags: [bench, cluster-{}]\nstatus: active\n---\n\n# Note {:04}\n\n",
                i % 12,
                i
            );
            for b in 0..15 {
                content.push_str(&format!(
                    "Block {} in Note {:04}: Verknüpfung zu [[Note {:04}]] und Thema Wissenstransfer.\n\n",
                    b, i, next_i
                ));
            }
            for t in 0..4 {
                content.push_str(&format!(
                    "- [ ] Aufgabe {} für [[Note {:04}]] priority:: {} #bench/task\n",
                    t,
                    alt_i,
                    (t % 3) + 1
                ));
            }
            let file_path = vault_dir.join(format!("note_{:04}.md", i));
            fs::write(file_path, content)?;
            Ok(())
        })?;
        let generation_ms = gen_start.elapsed().as_secs_f64() * 1000.0;

        let mut db = Database::open(&db_path)?;
        let cold_stats = db.sync_vault(&vault_dir)?;
        let cold_index_ms = cold_stats.elapsed_ms;
        let blocks_per_sec = if cold_index_ms > 0.0 {
            (cold_stats.total_blocks as f64) / (cold_index_ms / 1000.0)
        } else {
            0.0
        };

        // Modify a single file out of 5,000 and verify BLAKE3 skips the remaining 4,999
        fs::write(
            vault_dir.join("note_0042.md"),
            "# Note 0042\n\nAktualisierter Absatz für Delta Benchmark mit Suchwort Quantenbeschleuniger.\n\n- [ ] Delta Task priority:: 1\n",
        )?;
        let delta_stats = db.sync_vault(&vault_dir)?;

        let search_res = db.search_fts("Quantenbeschleuniger", 20)?;
        let graph_snap = build_graph_snapshot(&db, false)?;
        let db_size_mb =
            (fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0) as f64) / (1024.0 * 1024.0);

        Ok(BenchmarkReport {
            file_count,
            block_count: cold_stats.total_blocks,
            link_count: cold_stats.total_links,
            task_count: cold_stats.total_tasks,
            generation_ms,
            cold_index_ms,
            blocks_per_sec,
            delta_sync_1_file_ms: delta_stats.elapsed_ms,
            delta_files_skipped: delta_stats.files_skipped_unchanged,
            fts_search_us: search_res.elapsed_us,
            fts_hits: search_res.total_hits,
            graph_build_layout_ms: (graph_snap.computed_in_us as f64) / 1000.0,
            db_size_mb,
        })
    }
}

fn path_stem_str(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(rel_path)
        .to_string()
}

/// Computes the next occurrence date for a recurring task rule such as
/// `daily`, `weekly`, `monthly`, `yearly`, `every 3d`, `every 2w`, `every 1m`.
pub fn compute_next_recurrence_date(base_date: NaiveDate, recurrence: &str) -> Option<NaiveDate> {
    let normalized = recurrence.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    match normalized.as_str() {
        "daily" | "every day" | "1d" => return base_date.checked_add_days(Days::new(1)),
        "weekly" | "every week" | "1w" => return base_date.checked_add_days(Days::new(7)),
        "monthly" | "every month" | "1m" => return base_date.checked_add_months(Months::new(1)),
        "yearly" | "every year" | "1y" => return base_date.checked_add_months(Months::new(12)),
        _ => {}
    }

    let rest = normalized
        .strip_prefix("every ")
        .unwrap_or(&normalized)
        .trim();
    let digits_len = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digits_len == 0 {
        return None;
    }
    let count: u64 = rest[..digits_len].parse().ok()?;
    if count == 0 {
        return None;
    }
    let unit = rest[digits_len..].trim();
    match unit {
        "d" | "day" | "days" => base_date.checked_add_days(Days::new(count)),
        "w" | "week" | "weeks" => base_date.checked_add_days(Days::new(count.saturating_mul(7))),
        "m" | "month" | "months" => u32::try_from(count)
            .ok()
            .and_then(|m| base_date.checked_add_months(Months::new(m))),
        "y" | "year" | "years" => u32::try_from(count.saturating_mul(12))
            .ok()
            .and_then(|m| base_date.checked_add_months(Months::new(m))),
        _ => None,
    }
}

fn build_next_recurring_task_block(completed: &Block, recurrence: &str) -> Option<Block> {
    let task = completed.task.as_ref()?;
    let today = Local::now().date_naive();

    let parsed_sched = task
        .scheduled_at
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok());
    let parsed_dead = task
        .deadline_at
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok());

    let primary_base = parsed_sched.or(parsed_dead).unwrap_or(today);
    let next_primary = compute_next_recurrence_date(primary_base, recurrence)?;

    let mut next_block = completed.clone();
    next_block.has_explicit_id = false;
    let mut raw = completed.raw_content.clone();

    let next_sched = parsed_sched.and_then(|d| compute_next_recurrence_date(d, recurrence));
    let next_dead = parsed_dead.and_then(|d| compute_next_recurrence_date(d, recurrence));

    if let (Some(old_str), Some(new_d)) = (task.scheduled_at.as_deref(), next_sched) {
        let new_str = new_d.format("%Y-%m-%d").to_string();
        raw = replace_date_property(&raw, &["scheduled", "scheduled_at"], old_str, &new_str);
        if let Some(ref mut t) = next_block.task {
            t.scheduled_at = Some(new_str);
        }
    }

    if let (Some(old_str), Some(new_d)) = (task.deadline_at.as_deref(), next_dead) {
        let new_str = new_d.format("%Y-%m-%d").to_string();
        raw = replace_date_property(&raw, &["deadline", "due"], old_str, &new_str);
        if let Some(ref mut t) = next_block.task {
            t.deadline_at = Some(new_str);
        }
    }

    if parsed_sched.is_none() && parsed_dead.is_none() {
        let next_str = next_primary.format("%Y-%m-%d").to_string();
        if !raw.ends_with('\n') && !raw.is_empty() {
            raw.push('\n');
        }
        raw.push_str(&format!("scheduled:: {}", next_str));
        if let Some(ref mut t) = next_block.task {
            t.scheduled_at = Some(next_str);
        }
    }

    next_block.raw_content = raw;
    if let Some(ref mut t) = next_block.task {
        t.status = TaskStatus::Todo;
    }
    Some(next_block)
}

fn replace_date_property(raw: &str, keys: &[&str], old_date: &str, new_date: &str) -> String {
    let mut updated_lines = Vec::new();
    let mut replaced = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        let mut new_line = line.to_string();
        for key in keys {
            let prefix = format!("{}::", key);
            if trimmed.to_lowercase().starts_with(&prefix) && line.contains(old_date) {
                new_line = line.replacen(old_date, new_date, 1);
                replaced = true;
                break;
            }
        }
        if !replaced {
            // Also support inline bracketed `[scheduled:: 2026-11-23]` or emoji dates
            for key in keys {
                let marker = format!("{}:: {}", key, old_date);
                if new_line.contains(&marker) {
                    new_line = new_line.replacen(&marker, &format!("{}:: {}", key, new_date), 1);
                    replaced = true;
                    break;
                }
            }
        }
        updated_lines.push(new_line);
    }
    if replaced {
        updated_lines.join("\n")
    } else {
        raw.replacen(old_date, new_date, 1)
    }
}

fn format_frontmatter_scalar(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "\"\"".to_string();
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed.to_string();
    }
    if trimmed.contains(':')
        || trimmed.contains('#')
        || trimmed.starts_with('[')
        || trimmed.starts_with('{')
        || trimmed.starts_with('"')
    {
        format!("\"{}\"", trimmed.replace('"', "\\\""))
    } else {
        trimmed.to_string()
    }
}

fn upsert_frontmatter_property(raw_md: &str, key: &str, value: &str) -> String {
    let formatted = format_frontmatter_scalar(value);
    let new_entry = format!("{}: {}", key, formatted);

    let open_prefix = if raw_md.starts_with("---\r\n") {
        Some(("---\r\n", "\r\n"))
    } else if raw_md.starts_with("---\n") {
        Some(("---\n", "\n"))
    } else {
        None
    };

    if let Some((open_delim, nl)) = open_prefix {
        let after_open = &raw_md[open_delim.len()..];
        let mut fm_lines: Vec<&str> = Vec::new();
        let mut offset = 0usize;
        let mut found_close = false;

        for line in after_open.split_inclusive('\n') {
            let trimmed = line.trim();
            offset += line.len();
            if trimmed == "---" || trimmed == "..." {
                found_close = true;
                break;
            }
            fm_lines.push(line.trim_end_matches(['\r', '\n']));
        }

        if found_close {
            let body = &after_open[offset..];
            let mut out_lines: Vec<String> = Vec::with_capacity(fm_lines.len() + 1);
            let mut updated = false;
            let mut skip_list_items = false;

            for line in fm_lines {
                let trimmed = line.trim();
                if skip_list_items {
                    if trimmed.starts_with("- ") {
                        continue;
                    }
                    skip_list_items = false;
                }
                if !updated {
                    if let Some((k, rest)) = trimmed.split_once(':') {
                        if k.trim() == key {
                            out_lines.push(new_entry.clone());
                            updated = true;
                            if rest.trim().is_empty() {
                                skip_list_items = true;
                            }
                            continue;
                        }
                    }
                }
                out_lines.push(line.to_string());
            }

            if !updated {
                out_lines.push(new_entry);
            }

            let mut result = String::with_capacity(raw_md.len() + 64);
            result.push_str("---");
            result.push_str(nl);
            for line in out_lines {
                result.push_str(&line);
                result.push_str(nl);
            }
            result.push_str("---");
            result.push_str(nl);
            result.push_str(body);
            return result;
        }
    }

    format!("---\n{}\n---\n\n{}", new_entry, raw_md)
}

/// Rewrites `[[Target]]`, `[[Target|Alias]]`, and `[[Target#Heading]]` wiki-links in Markdown
/// when a note is renamed, matching case-insensitively against any of `old_targets`.
pub fn rewrite_wiki_links_in_markdown(
    markdown: &str,
    old_targets: &[String],
    new_target: &str,
) -> String {
    let lower_targets: Vec<String> = old_targets
        .iter()
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    if lower_targets.is_empty() {
        return markdown.to_string();
    }

    let mut out = String::with_capacity(markdown.len());
    let mut rest = markdown;

    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let Some(end) = after_open.find("]]") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let inner = &after_open[..end];
        let (target_and_anchor, alias_part) = match inner.split_once('|') {
            Some((lhs, rhs)) => (lhs, Some(rhs)),
            None => (inner, None),
        };
        let (target_part, anchor_part) = match target_and_anchor.split_once('#') {
            Some((lhs, rhs)) => (lhs, Some(rhs)),
            None => (target_and_anchor, None),
        };

        let normalized_target = target_part.trim().trim_end_matches(".md").to_lowercase();
        if lower_targets.iter().any(|old| old == &normalized_target) {
            out.push_str("[[");
            out.push_str(new_target);
            if let Some(anchor) = anchor_part {
                out.push('#');
                out.push_str(anchor);
            }
            if let Some(alias) = alias_part {
                out.push('|');
                out.push_str(alias);
            }
            out.push_str("]]");
        } else {
            out.push_str("[[");
            out.push_str(inner);
            out.push_str("]]");
        }
        rest = &after_open[end + 2..];
    }

    out.push_str(rest);
    out
}

/// Computes a local SSD cache path outside the vault directory so cloud-sync folders never hold SQLite files.
pub fn default_cache_db_path(vault_path: &Path) -> PathBuf {
    let abs = fs::canonicalize(vault_path).unwrap_or_else(|_| vault_path.to_path_buf());
    let hash = blake3::hash(abs.to_string_lossy().as_bytes()).to_hex();
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("oxidevault")
        .join("cache")
        .join(&hash[..16])
        .join("index.sqlite")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_engine_lifecycle_demo_tasks_and_lazy_id() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let cache_db = dir.path().join("local-cache").join("index.sqlite");

        let mut engine = VaultEngine::open(&vault_dir, Some(cache_db.clone())).unwrap();
        let stats = engine.seed_demo().unwrap();
        assert!(stats.total_documents >= 7);
        assert!(stats.total_blocks >= 40);
        assert!(cache_db.exists());
        // Ensure SQLite file is NOT inside the cloud vault directory
        assert!(!vault_dir.join("index.sqlite").exists());

        // Search via FTS5
        let res = engine.search_fts("MariaDB", 10).unwrap();
        assert!(!res.results.is_empty());

        // Shortest path in graph
        let docs = engine.list_documents().unwrap();
        let welcome = docs.iter().find(|d| d.path == "Willkommen in OxideVault.md").unwrap();
        let roadmap = docs.iter().find(|d| d.path == "Roadmap & Meilensteine.md").unwrap();
        let path = engine.find_graph_path(&welcome.id, &roadmap.id).unwrap();
        assert!(path.found);
        assert!(path.hops >= 1);

        // Database query for #buch
        let books = engine
            .query_database(&DatabaseQuery {
                tag: Some("buch".to_string()),
                filters: vec![],
                sort_by: Some("author".to_string()),
                sort_desc: false,
            })
            .unwrap();
        assert_eq!(books.rows.len(), 2);

        // Toggle task status and verify persistence
        let tasks = engine.get_tasks(Some(TaskStatus::Todo)).unwrap();
        assert!(!tasks.is_empty());
        let toggled = engine
            .toggle_task_status(&tasks[0].block_id, TaskStatus::Done)
            .unwrap();
        assert_eq!(toggled.status, TaskStatus::Done);
    }

    #[test]
    fn blocks_path_traversal_across_document_operations() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let cache_db = dir.path().join("cache.sqlite");
        let mut engine = VaultEngine::open(&vault_dir, Some(cache_db)).unwrap();

        assert!(engine.save_markdown_document("../outside.md", "nope").is_err());
        assert!(engine.create_document("/etc/evil.md", None).is_err());
        assert!(engine.delete_document("../../important.md").is_err());
        assert!(engine.open_or_create_daily_note(Some("../escape")).is_err());
        assert!(!dir.path().join("outside.md").exists());
    }

    #[test]
    fn rename_document_moves_file_and_rewrites_wiki_links() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let cache_db = dir.path().join("cache.sqlite");
        let mut engine = VaultEngine::open(&vault_dir, Some(cache_db)).unwrap();

        engine
            .save_markdown_document("Alt.md", "# Alt\n\nInhalt der alten Notiz.\n")
            .unwrap();
        engine
            .save_markdown_document(
                "Index.md",
                "# Index\n\nSiehe [[Alt]] und [[Alt|Mein Alias]] sowie [[Alt#Abschnitt]] und [[Andere]].\n",
            )
            .unwrap();

        let renamed = engine.rename_document("Alt.md", "archiv/Neu.md").unwrap();
        assert_eq!(renamed.document.path, "archiv/Neu.md");
        assert!(!vault_dir.join("Alt.md").exists());
        assert!(vault_dir.join("archiv/Neu.md").exists());

        let index_doc = engine.get_document("Index.md").unwrap().unwrap();
        assert!(index_doc.raw_markdown.contains("[[Neu]]"));
        assert!(index_doc.raw_markdown.contains("[[Neu|Mein Alias]]"));
        assert!(index_doc.raw_markdown.contains("[[Neu#Abschnitt]]"));
        assert!(index_doc.raw_markdown.contains("[[Andere]]"));
        assert!(!index_doc.raw_markdown.contains("[[Alt]]"));

        // Backlinks on renamed doc should still resolve cleanly
        let backlinks = engine.get_backlinks(&renamed.document.id).unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_doc_path, "Index.md");
    }

    #[test]
    fn trash_lifecycle_snapshots_and_revision_tracking() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let cache_db = dir.path().join("cache.sqlite");
        let mut engine = VaultEngine::open(&vault_dir, Some(cache_db)).unwrap();
        assert_eq!(engine.revision(), 1);

        engine
            .save_markdown_document("Memo.md", "# Memo\n\nVersion eins.\n")
            .unwrap();
        let rev_v1 = engine.revision();
        assert!(rev_v1 > 1);

        engine
            .save_markdown_document("Memo.md", "# Memo\n\nVersion zwei.\n")
            .unwrap();
        let snaps = engine.list_snapshots("Memo.md").unwrap();
        assert_eq!(snaps.len(), 2);

        // Restore older snapshot
        let restored_snap = engine.restore_snapshot(snaps[1].id).unwrap();
        assert!(restored_snap.raw_markdown.contains("Version eins."));

        // Soft-delete into .trash
        engine.delete_document("Memo.md").unwrap();
        assert!(!vault_dir.join("Memo.md").exists());
        let trash = engine.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].original_path, "Memo.md");
        assert_eq!(engine.get_overview().unwrap().trash_count, 1);

        // Create a conflicting Memo.md before restoring -> restores to unique fallback path
        engine
            .save_markdown_document("Memo.md", "# Neu\n\nNeuer Inhalt.\n")
            .unwrap();
        let restored = engine.restore_trash_item(&trash[0].trash_id).unwrap();
        assert_eq!(restored.document.path, "Memo (restored 1).md");
        assert!(restored.raw_markdown.contains("Version eins."));
        assert!(engine.list_trash().unwrap().is_empty());

        // Delete again and empty trash
        engine.delete_document("Memo (restored 1).md").unwrap();
        assert_eq!(engine.list_trash().unwrap().len(), 1);
        let removed = engine.empty_trash().unwrap();
        assert_eq!(removed, 1);
        assert!(engine.list_trash().unwrap().is_empty());
    }

    #[test]
    fn recurring_tasks_spawn_next_todo_occurrence_on_completion() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let cache_db = dir.path().join("cache.sqlite");
        let mut engine = VaultEngine::open(&vault_dir, Some(cache_db)).unwrap();

        engine
            .save_markdown_document(
                "Tasks.md",
                "# Tasks\n\n- [ ] Weekly review\n  scheduled:: 2026-11-23\n  deadline:: 2026-11-25\n  repeat:: weekly\n",
            )
            .unwrap();

        let open_tasks = engine.get_tasks(Some(TaskStatus::Todo)).unwrap();
        assert_eq!(open_tasks.len(), 1);
        assert_eq!(open_tasks[0].recurrence.as_deref(), Some("weekly"));

        let completed = engine
            .toggle_task_status(&open_tasks[0].block_id, TaskStatus::Done)
            .unwrap();
        assert_eq!(completed.status, TaskStatus::Done);

        // A fresh TODO block must have been spawned immediately after with +7 days
        let all_tasks = engine.get_tasks(None).unwrap();
        assert_eq!(all_tasks.len(), 2);
        let next_todo = all_tasks
            .iter()
            .find(|t| t.status == TaskStatus::Todo)
            .expect("spawned recurring task");
        assert_eq!(next_todo.scheduled_at.as_deref(), Some("2026-11-30"));
        assert_eq!(next_todo.deadline_at.as_deref(), Some("2026-12-02"));
        assert_eq!(next_todo.recurrence.as_deref(), Some("weekly"));

        // Verify compute_next_recurrence_date across formats
        let base = NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
        assert_eq!(
            compute_next_recurrence_date(base, "daily"),
            NaiveDate::from_ymd_opt(2026, 1, 16)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 3d"),
            NaiveDate::from_ymd_opt(2026, 1, 18)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 2w"),
            NaiveDate::from_ymd_opt(2026, 1, 29)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "monthly"),
            NaiveDate::from_ymd_opt(2026, 2, 15)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 2m"),
            NaiveDate::from_ymd_opt(2026, 3, 15)
        );
    }

    #[test]
    fn unlinked_mentions_linking_and_frontmatter_property_update_preserve_body() {
        let dir = tempdir().unwrap();
        let vault_dir = dir.path().join("vault");
        let cache_db = dir.path().join("cache.sqlite");
        let mut engine = VaultEngine::open(&vault_dir, Some(cache_db)).unwrap();

        let target = engine
            .save_markdown_document(
                "RustCore.md",
                "---\naliases: [Core Engine]\nstatus: draft\n---\n\n# RustCore\n\nBody stays intact.\n",
            )
            .unwrap();
        engine
            .save_markdown_document(
                "Journal.md",
                "# Journal\n\nToday we improved core engine latency.\n",
            )
            .unwrap();

        // Update existing frontmatter property while preserving body verbatim
        let updated = engine
            .update_document_property("RustCore.md", "status", "published")
            .unwrap();
        assert_eq!(
            updated
                .document
                .frontmatter
                .get("status")
                .and_then(|v| v.as_str()),
            Some("published")
        );
        assert!(updated.raw_markdown.contains("# RustCore\n\nBody stays intact.\n"));

        // Add frontmatter property to document without frontmatter
        let updated_journal = engine
            .update_document_property("Journal.md", "mood", "focused")
            .unwrap();
        assert_eq!(
            updated_journal
                .document
                .frontmatter
                .get("mood")
                .and_then(|v| v.as_str()),
            Some("focused")
        );
        assert!(updated_journal
            .raw_markdown
            .contains("Today we improved core engine latency."));

        // Find unlinked mention via alias and convert into [[RustCore|core engine]]
        let mentions = engine.get_unlinked_mentions(&target.document.id).unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_term, "core engine");
        engine
            .link_unlinked_mention(
                &mentions[0].source_doc_path,
                &mentions[0].source_block_id,
                &mentions[0].matched_term,
                &target.document.title,
            )
            .unwrap();

        let journal_after = engine.get_document("Journal.md").unwrap().unwrap();
        assert!(journal_after
            .raw_markdown
            .contains("[[RustCore|core engine]]"));
        assert!(engine
            .get_unlinked_mentions(&target.document.id)
            .unwrap()
            .is_empty());
        assert_eq!(engine.get_backlinks(&target.document.id).unwrap().len(), 1);
    }
}
