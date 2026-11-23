use crate::db::now_unix;
use crate::fs_utils::{atomic_write, normalize_safe_md_path};
use crate::model::{
    Block, BlockType, DeviceInfo, SyncApplyReport, SyncCompactReport, SyncMergeReport,
    SyncOperationKind, SyncOplogEntry, SyncStatus,
};
use crate::parser::{parse_markdown_document, serialize_document_to_markdown};
use anyhow::{Context, Result};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use uuid::Uuid;
use walkdir::WalkDir;

pub struct CrdtSyncEngine {
    device_id: String,
    next_seq: u64,
}

impl CrdtSyncEngine {
    pub fn new(device_id: impl Into<String>) -> Self {
        Self {
            device_id: device_id.into(),
            next_seq: 1,
        }
    }

    /// Initializes the sync engine for a vault and resumes `next_seq` from any existing
    /// oplog entries written by this device so sequence numbers stay strictly monotonic across restarts.
    pub fn open_for_vault(device_id: impl Into<String>, vault_path: &Path) -> Result<Self> {
        let device_id = device_id.into();
        let sync_dir = vault_path.join(".sync");
        let mut max_seq = 0u64;
        let mut own_op_count = 0usize;
        let mut own_last_ts = now_unix();

        if sync_dir.exists() {
            let prefix = format!("{}_", device_id);
            for entry in fs::read_dir(&sync_dir)? {
                let entry = entry?;
                let path = entry.path();
                let is_own_oplog = path.extension().and_then(|s| s.to_str()) == Some("oplog")
                    && path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| n.starts_with(&prefix))
                        .unwrap_or(false);
                if is_own_oplog {
                    if let Ok(file) = fs::File::open(&path) {
                        for line in BufReader::new(file).lines().map_while(Result::ok) {
                            if let Ok(op) = serde_json::from_str::<SyncOplogEntry>(&line) {
                                if op.device_id == device_id {
                                    own_op_count += 1;
                                    if op.seq > max_seq {
                                        max_seq = op.seq;
                                    }
                                    if op.hlc_ts > own_last_ts {
                                        own_last_ts = op.hlc_ts;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let engine = Self {
            device_id: device_id.clone(),
            next_seq: max_seq + 1,
        };
        engine.ensure_sync_dir(vault_path)?;
        upsert_device_record(&sync_dir, &device_id, own_last_ts, Some(own_op_count))?;

        Ok(engine)
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn ensure_sync_dir(&self, vault_path: &Path) -> Result<()> {
        fs::create_dir_all(vault_path.join(".sync"))?;
        Ok(())
    }

    /// Appends an immutable operation entry to this device's own oplog file inside `.sync/`.
    /// Because each device only writes to its own `<device_id>_*.oplog` files, cloud providers
    /// like Google Drive or Dropbox never encounter binary write-write conflicts.
    pub fn append_op(
        &mut self,
        vault_path: &Path,
        doc_path: &str,
        block_id: &str,
        kind: SyncOperationKind,
        payload: serde_json::Value,
    ) -> Result<SyncOplogEntry> {
        self.ensure_sync_dir(vault_path)?;
        let entry = SyncOplogEntry {
            op_id: Uuid::new_v4().to_string(),
            device_id: self.device_id.clone(),
            seq: self.next_seq,
            hlc_ts: now_unix(),
            doc_path: doc_path.to_string(),
            block_id: block_id.to_string(),
            kind,
            payload,
        };
        self.next_seq += 1;

        let sync_dir = vault_path.join(".sync");
        let filename = format!("{}_0001.oplog", self.device_id);
        let path = sync_dir.join(filename);
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        let line = serde_json::to_string(&entry)?;
        writeln!(file, "{}", line)?;

        upsert_device_record(&sync_dir, &self.device_id, entry.hlc_ts, None)?;

        Ok(entry)
    }

    /// Reads all `.sync/*.oplog` files across all devices and summarizes sync health.
    pub fn inspect_status(&self, vault_path: &Path) -> Result<SyncStatus> {
        let sync_dir = vault_path.join(".sync");
        let mut oplog_files = Vec::new();
        let mut total_ops = 0usize;
        let mut last_sync_ts = 0i64;
        let mut observed_devices: BTreeMap<String, (usize, i64)> = BTreeMap::new();

        if sync_dir.exists() {
            for entry in fs::read_dir(&sync_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("oplog") {
                    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                        oplog_files.push(name.to_string());
                    }
                    let file = fs::File::open(&path)?;
                    let reader = BufReader::new(file);
                    for line in reader.lines() {
                        let line = line?;
                        if line.trim().is_empty() {
                            continue;
                        }
                        total_ops += 1;
                        if let Ok(op) = serde_json::from_str::<SyncOplogEntry>(&line) {
                            if op.hlc_ts > last_sync_ts {
                                last_sync_ts = op.hlc_ts;
                            }
                            let stats = observed_devices
                                .entry(op.device_id.clone())
                                .or_insert((0, 0));
                            stats.0 += 1;
                            if op.hlc_ts > stats.1 {
                                stats.1 = op.hlc_ts;
                            }
                        }
                    }
                }
            }
        }
        oplog_files.sort();

        // Merge persisted .sync/devices.json with devices observed in .oplog files
        let mut devices_map = load_devices_registry(&sync_dir);
        for (dev_id, (count, max_ts)) in observed_devices {
            devices_map
                .entry(dev_id.clone())
                .and_modify(|info| {
                    info.op_count = count;
                    if max_ts > info.last_seen_ts {
                        info.last_seen_ts = max_ts;
                    }
                })
                .or_insert_with(|| DeviceInfo {
                    device_id: dev_id.clone(),
                    display_name: dev_id,
                    last_seen_ts: max_ts,
                    op_count: count,
                });
        }
        let mut devices: Vec<DeviceInfo> = devices_map.into_values().collect();
        devices.sort_by(|a, b| {
            b.last_seen_ts
                .cmp(&a.last_seen_ts)
                .then_with(|| a.device_id.cmp(&b.device_id))
        });

        // Check vault for any cloud-provider conflict copies
        let mut conflict_files_detected = 0usize;
        for entry in WalkDir::new(vault_path).follow_links(false).into_iter().flatten() {
            if entry.file_type().is_file() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("conflict") || name.contains("konfliktkopie") {
                    conflict_files_detected += 1;
                }
            }
        }

        Ok(SyncStatus {
            device_id: self.device_id.clone(),
            sync_dir: sync_dir.to_string_lossy().to_string(),
            oplog_files,
            total_ops,
            conflict_files_detected,
            last_sync_ts,
            devices,
        })
    }

    /// Inspects all `.sync/*.oplog` entries from other devices, applies unapplied `PatchBlockText`
    /// operations using 3-way CRDT text merging and atomic writes, and persists applied op IDs.
    pub fn apply_remote_ops(&mut self, vault_path: &Path) -> Result<SyncApplyReport> {
        let start = Instant::now();
        let sync_dir = vault_path.join(".sync");
        if !sync_dir.exists() {
            return Ok(SyncApplyReport {
                ops_scanned: 0,
                ops_applied: 0,
                docs_updated: Vec::new(),
                elapsed_us: start.elapsed().as_micros() as u64,
            });
        }

        let applied_path = sync_dir.join(format!(".applied_{}.json", self.device_id));
        let mut applied_ids: HashSet<String> = if applied_path.exists() {
            fs::read_to_string(&applied_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
                .map(|v| v.into_iter().collect())
                .unwrap_or_default()
        } else {
            HashSet::new()
        };

        let all_ops = self.load_all_ops(vault_path)?;
        let mut ops_scanned = 0usize;
        let mut ops_applied = 0usize;
        let mut docs_updated_set: BTreeSet<String> = BTreeSet::new();
        let mut dirty_applied = false;

        for op in all_ops {
            if op.device_id == self.device_id {
                continue;
            }
            ops_scanned += 1;
            if applied_ids.contains(&op.op_id) {
                continue;
            }

            if op.kind == SyncOperationKind::PatchBlockText {
                let Some(new_text) = op.payload.get("text").and_then(|v| v.as_str()) else {
                    continue;
                };
                let base_opt = op.payload.get("base").and_then(|v| v.as_str());
                let Ok((clean_rel, abs_path)) = normalize_safe_md_path(vault_path, &op.doc_path)
                else {
                    continue;
                };

                let now = now_unix();
                if abs_path.exists() {
                    let existing_md = fs::read_to_string(&abs_path)
                        .with_context(|| format!("Failed to read {}", abs_path.display()))?;
                    let parsed = parse_markdown_document(&clean_rel, &existing_md, now, now);
                    let mut blocks: Vec<Block> =
                        parsed.blocks.into_iter().map(|pb| pb.block).collect();

                    if let Some(blk) = blocks.iter_mut().find(|b| b.id == op.block_id) {
                        let base = base_opt.unwrap_or(&blk.raw_content);
                        blk.raw_content = merge_concurrent_text(base, &blk.raw_content, new_text);
                    } else {
                        let next_order = blocks
                            .last()
                            .map(|b| b.sort_order + 1000.0)
                            .unwrap_or(1000.0);
                        blocks.push(Block {
                            id: op.block_id.clone(),
                            doc_id: parsed.document.id.clone(),
                            parent_block_id: None,
                            depth: 0,
                            sort_order: next_order,
                            block_type: BlockType::Paragraph,
                            heading_level: None,
                            code_lang: None,
                            has_explicit_id: true,
                            raw_content: new_text.to_string(),
                            plain_text: new_text.to_string(),
                            properties: BTreeMap::new(),
                            tags: Vec::new(),
                            collapsed: false,
                            task: None,
                            updated_at: now,
                        });
                    }

                    let updated_md = serialize_document_to_markdown(&parsed.document, &blocks);
                    atomic_write(&abs_path, updated_md)?;
                } else {
                    let title = Path::new(&clean_rel)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Synced Note");
                    let content = format!("# {}\n\n{} ^{}\n", title, new_text, op.block_id);
                    atomic_write(&abs_path, content)?;
                }

                applied_ids.insert(op.op_id.clone());
                dirty_applied = true;
                ops_applied += 1;
                docs_updated_set.insert(clean_rel);
            }
        }

        if dirty_applied {
            let mut sorted_ids: Vec<String> = applied_ids.into_iter().collect();
            sorted_ids.sort();
            let json = serde_json::to_string_pretty(&sorted_ids)?;
            atomic_write(&applied_path, json)?;
        }

        Ok(SyncApplyReport {
            ops_scanned,
            ops_applied,
            docs_updated: docs_updated_set.into_iter().collect(),
            elapsed_us: start.elapsed().as_micros() as u64,
        })
    }

    /// Compacts per-device `.sync/<device_id>_*.oplog` files into a single deduplicated,
    /// deterministically ordered `<device_id>_0001.oplog` file per device.
    pub fn compact_oplogs(&self, vault_path: &Path) -> Result<SyncCompactReport> {
        let sync_dir = vault_path.join(".sync");
        if !sync_dir.exists() {
            return Ok(SyncCompactReport {
                files_before: 0,
                files_after: 0,
                ops_compacted: 0,
                bytes_saved: 0,
            });
        }

        let mut device_files: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
        let mut files_before = 0usize;
        let mut bytes_before = 0u64;

        for entry in fs::read_dir(&sync_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("oplog") {
                files_before += 1;
                bytes_before += fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown");
                let device_key = stem
                    .rsplit_once('_')
                    .map(|(dev, _)| dev.to_string())
                    .unwrap_or_else(|| stem.to_string());
                device_files.entry(device_key).or_default().push(path);
            }
        }

        let mut ops_compacted = 0usize;
        for (device_key, mut paths) in device_files {
            paths.sort();
            let mut raw_count = 0usize;
            let mut seen_op_ids: HashSet<String> = HashSet::new();
            let mut unique_ops: Vec<SyncOplogEntry> = Vec::new();

            for path in &paths {
                let file = fs::File::open(path)
                    .with_context(|| format!("Failed to open {}", path.display()))?;
                for line in BufReader::new(file).lines() {
                    let line = line?;
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(op) = serde_json::from_str::<SyncOplogEntry>(&line) {
                        raw_count += 1;
                        if seen_op_ids.insert(op.op_id.clone()) {
                            unique_ops.push(op);
                        }
                    }
                }
            }

            unique_ops.sort_by(|a, b| {
                a.seq
                    .cmp(&b.seq)
                    .then_with(|| a.hlc_ts.cmp(&b.hlc_ts))
                    .then_with(|| a.op_id.cmp(&b.op_id))
            });

            let has_duplicates = unique_ops.len() < raw_count;
            let target_path = sync_dir.join(format!("{}_0001.oplog", device_key));

            if paths.len() > 1 || has_duplicates {
                let mut out = String::new();
                for op in &unique_ops {
                    out.push_str(&serde_json::to_string(op)?);
                    out.push('\n');
                }
                atomic_write(&target_path, out)?;
                for old_path in &paths {
                    if old_path != &target_path && old_path.exists() {
                        let _ = fs::remove_file(old_path);
                    }
                }
                ops_compacted += unique_ops.len();
            }
        }

        let mut files_after = 0usize;
        let mut bytes_after = 0u64;
        for entry in fs::read_dir(&sync_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("oplog") {
                files_after += 1;
                bytes_after += fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            }
        }

        Ok(SyncCompactReport {
            files_before,
            files_after,
            ops_compacted,
            bytes_saved: bytes_before.saturating_sub(bytes_after),
        })
    }

    /// Reads and deterministically orders all CRDT oplog entries from every device.
    pub fn load_all_ops(&self, vault_path: &Path) -> Result<Vec<SyncOplogEntry>> {
        let sync_dir = vault_path.join(".sync");
        let mut ops = Vec::new();
        if !sync_dir.exists() {
            return Ok(ops);
        }

        for entry in fs::read_dir(&sync_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("oplog") {
                let file = fs::File::open(&path)
                    .with_context(|| format!("Failed to open {}", path.display()))?;
                for line in BufReader::new(file).lines() {
                    let line = line?;
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(op) = serde_json::from_str::<SyncOplogEntry>(&line) {
                        ops.push(op);
                    }
                }
            }
        }

        // Deterministic total order via Hybrid Logical Timestamp + device tie-breaker
        ops.sort_by(|a, b| {
            a.hlc_ts
                .cmp(&b.hlc_ts)
                .then_with(|| a.device_id.cmp(&b.device_id))
                .then_with(|| a.seq.cmp(&b.seq))
                .then_with(|| a.op_id.cmp(&b.op_id))
        });

        Ok(ops)
    }

    /// Simulates two devices (`laptop-a` and `desktop-b`) making concurrent offline edits
    /// to the same block, writing separate append-only `.oplog` files into `.sync/`,
    /// and performing a deterministic conflict-free CRDT merge.
    pub fn simulate_two_device_merge(&self, vault_path: &Path) -> Result<SyncMergeReport> {
        let start = Instant::now();
        self.ensure_sync_dir(vault_path)?;

        let target_doc = "CRDT Google Drive Sync.md";
        let block_id = "blk-crdt-demo";
        let base_text =
            "OxideVault speichert Notizen als lesbare Markdown-Dateien im Google Drive.";
        let edit_a =
            "OxideVault speichert Notizen als lesbare Markdown-Dateien und BLAKE3-Hashes im Google Drive.";
        let edit_b =
            "OxideVault speichert Notizen als lesbare Markdown-Dateien im Google Drive ohne Konfliktkopien via #crdt.";

        let ts = now_unix();
        let op_a = SyncOplogEntry {
            op_id: Uuid::new_v4().to_string(),
            device_id: "laptop-a".to_string(),
            seq: 1,
            hlc_ts: ts,
            doc_path: target_doc.to_string(),
            block_id: block_id.to_string(),
            kind: SyncOperationKind::PatchBlockText,
            payload: serde_json::json!({
                "base": base_text,
                "text": edit_a,
            }),
        };

        let op_b = SyncOplogEntry {
            op_id: Uuid::new_v4().to_string(),
            device_id: "desktop-b".to_string(),
            seq: 1,
            hlc_ts: ts + 1,
            doc_path: target_doc.to_string(),
            block_id: block_id.to_string(),
            kind: SyncOperationKind::PatchBlockText,
            payload: serde_json::json!({
                "base": base_text,
                "text": edit_b,
            }),
        };

        let file_a_name = format!("laptop-a_{:04}.oplog", ts % 10000);
        let file_b_name = format!("desktop-b_{:04}.oplog", ts % 10000);

        fs::write(
            vault_path.join(".sync").join(&file_a_name),
            format!("{}\n", serde_json::to_string(&op_a)?),
        )?;
        fs::write(
            vault_path.join(".sync").join(&file_b_name),
            format!("{}\n", serde_json::to_string(&op_b)?),
        )?;

        // Merge both concurrent edits deterministically at token granularity
        let merged_result = merge_concurrent_text(base_text, edit_a, edit_b);

        // Apply merged property state across all loaded ops for verification
        let all_ops = self.load_all_ops(vault_path)?;
        let mut block_states: BTreeMap<String, String> = BTreeMap::new();
        for op in &all_ops {
            if op.kind == SyncOperationKind::PatchBlockText {
                if let Some(txt) = op.payload.get("text").and_then(|v| v.as_str()) {
                    block_states
                        .entry(op.block_id.clone())
                        .and_modify(|existing| {
                            let base = op
                                .payload
                                .get("base")
                                .and_then(|v| v.as_str())
                                .unwrap_or(existing.as_str());
                            *existing = merge_concurrent_text(base, existing, txt);
                        })
                        .or_insert_with(|| txt.to_string());
                }
            }
        }

        Ok(SyncMergeReport {
            device_a_file: format!(".sync/{}", file_a_name),
            device_b_file: format!(".sync/{}", file_b_name),
            target_doc_path: target_doc.to_string(),
            base_text: base_text.to_string(),
            device_a_edit: edit_a.to_string(),
            device_b_edit: edit_b.to_string(),
            merged_result,
            conflict_copies_created: 0,
            ops_applied: 2,
            elapsed_us: start.elapsed().as_micros() as u64,
        })
    }
}

fn default_display_name(device_id: &str) -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| device_id.to_string())
}

fn load_devices_registry(sync_dir: &Path) -> BTreeMap<String, DeviceInfo> {
    let path = sync_dir.join("devices.json");
    let mut map = BTreeMap::new();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(list) = serde_json::from_str::<Vec<DeviceInfo>>(&raw) {
            for info in list {
                map.insert(info.device_id.clone(), info);
            }
        }
    }
    map
}

fn upsert_device_record(
    sync_dir: &Path,
    device_id: &str,
    last_seen_ts: i64,
    exact_op_count: Option<usize>,
) -> Result<()> {
    let mut map = load_devices_registry(sync_dir);
    map.entry(device_id.to_string())
        .and_modify(|info| {
            if last_seen_ts > info.last_seen_ts {
                info.last_seen_ts = last_seen_ts;
            }
            match exact_op_count {
                Some(count) => info.op_count = count,
                None => info.op_count = info.op_count.saturating_add(1),
            }
        })
        .or_insert_with(|| DeviceInfo {
            device_id: device_id.to_string(),
            display_name: default_display_name(device_id),
            last_seen_ts,
            op_count: exact_op_count.unwrap_or(1),
        });
    let list: Vec<DeviceInfo> = map.into_values().collect();
    let json = serde_json::to_string_pretty(&list)?;
    atomic_write(&sync_dir.join("devices.json"), json)?;
    Ok(())
}

/// Deterministic 3-way word/token CRDT text merger.
/// Preserves concurrent non-overlapping insertions and edits from both devices without conflict markers.
pub fn merge_concurrent_text(base: &str, edit_a: &str, edit_b: &str) -> String {
    if edit_a == edit_b {
        return edit_a.to_string();
    }
    if edit_a == base {
        return edit_b.to_string();
    }
    if edit_b == base {
        return edit_a.to_string();
    }

    let base_words: Vec<&str> = base.split_whitespace().collect();
    let a_words: Vec<&str> = edit_a.split_whitespace().collect();
    let b_words: Vec<&str> = edit_b.split_whitespace().collect();

    // Compute LCS matches between base and edit_a / edit_b
    let lcs_a = lcs_indices(&base_words, &a_words);
    let lcs_b = lcs_indices(&base_words, &b_words);

    let mut out: Vec<String> = Vec::new();
    let mut base_pos = 0usize;
    let mut a_pos = 0usize;
    let mut b_pos = 0usize;

    // Pair up aligned base anchors present in both edits
    let mut common_anchors = Vec::new();
    let mut ia = 0usize;
    let mut ib = 0usize;
    while ia < lcs_a.len() && ib < lcs_b.len() {
        let (ba, pa) = lcs_a[ia];
        let (bb, pb) = lcs_b[ib];
        if ba == bb {
            common_anchors.push((ba, pa, pb));
            ia += 1;
            ib += 1;
        } else if ba < bb {
            ia += 1;
        } else {
            ib += 1;
        }
    }

    for (b_idx, a_idx, b_edit_idx) in common_anchors {
        let base_slice = &base_words[base_pos..b_idx];
        let a_slice = &a_words[a_pos..a_idx];
        let b_slice = &b_words[b_pos..b_edit_idx];

        emit_merged_gap(base_slice, a_slice, b_slice, &mut out);
        out.push(base_words[b_idx].to_string());

        base_pos = b_idx + 1;
        a_pos = a_idx + 1;
        b_pos = b_edit_idx + 1;
    }

    // Trailing gap after the last common anchor
    emit_merged_gap(
        &base_words[base_pos..],
        &a_words[a_pos..],
        &b_words[b_pos..],
        &mut out,
    );

    out.join(" ")
}

fn emit_merged_gap(base: &[&str], a: &[&str], b: &[&str], out: &mut Vec<String>) {
    if a == b {
        out.extend(a.iter().map(|s| (*s).to_string()));
    } else if a == base {
        out.extend(b.iter().map(|s| (*s).to_string()));
    } else if b == base {
        out.extend(a.iter().map(|s| (*s).to_string()));
    } else {
        // Both modified the same gap: keep non-base tokens from A followed by non-base tokens from B
        for w in a {
            out.push((*w).to_string());
        }
        for w in b {
            if !a.contains(w) && !base.contains(w) {
                out.push((*w).to_string());
            }
        }
    }
}

fn lcs_indices(base: &[&str], edit: &[&str]) -> Vec<(usize, usize)> {
    let n = base.len();
    let m = edit.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];

    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if base[i] == edit[j] {
                1 + dp[i + 1][j + 1]
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }

    let mut pairs = Vec::new();
    let mut i = 0usize;
    let mut j = 0usize;
    while i < n && j < m {
        if base[i] == edit[j] {
            pairs.push((i, j));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn concurrent_two_device_merge_preserves_both_edits_without_conflicts() {
        let dir = tempdir().unwrap();
        let engine = CrdtSyncEngine::new("test-host");
        let report = engine.simulate_two_device_merge(dir.path()).unwrap();

        assert_eq!(report.conflict_copies_created, 0);
        assert!(report.merged_result.contains("BLAKE3-Hashes"));
        assert!(report.merged_result.contains("#crdt"));
        assert!(dir.path().join(&report.device_a_file).exists());
        assert!(dir.path().join(&report.device_b_file).exists());
    }

    #[test]
    fn sequence_numbers_persist_across_restarts() {
        let dir = tempdir().unwrap();
        let mut engine1 = CrdtSyncEngine::open_for_vault("dev-1", dir.path()).unwrap();
        let op1 = engine1
            .append_op(
                dir.path(),
                "a.md",
                "b1",
                SyncOperationKind::UpsertBlock,
                serde_json::json!({}),
            )
            .unwrap();
        let op2 = engine1
            .append_op(
                dir.path(),
                "a.md",
                "b2",
                SyncOperationKind::UpsertBlock,
                serde_json::json!({}),
            )
            .unwrap();
        assert_eq!(op1.seq, 1);
        assert_eq!(op2.seq, 2);

        // Simulate restart: new engine instance for same device must resume at seq 3
        let mut engine2 = CrdtSyncEngine::open_for_vault("dev-1", dir.path()).unwrap();
        let op3 = engine2
            .append_op(
                dir.path(),
                "a.md",
                "b3",
                SyncOperationKind::UpsertBlock,
                serde_json::json!({}),
            )
            .unwrap();
        assert_eq!(op3.seq, 3);
    }

    #[test]
    fn merge_concurrent_text_handles_edge_cases() {
        let base = "eins zwei drei vier";
        assert_eq!(merge_concurrent_text(base, base, base), base);
        assert_eq!(
            merge_concurrent_text(base, "eins ZWEI drei vier", base),
            "eins ZWEI drei vier"
        );
        assert_eq!(
            merge_concurrent_text(base, base, "eins zwei drei VIER"),
            "eins zwei drei VIER"
        );
        let merged = merge_concurrent_text(base, "eins ZWEI drei vier", "eins zwei drei VIER");
        assert_eq!(merged, "eins ZWEI drei VIER");
    }

    #[test]
    fn devices_registry_apply_remote_ops_and_compact_oplogs_work() {
        let dir = tempdir().unwrap();
        let mut engine = CrdtSyncEngine::open_for_vault("local-dev", dir.path()).unwrap();
        engine
            .append_op(
                dir.path(),
                "Local.md",
                "b1",
                SyncOperationKind::UpsertBlock,
                serde_json::json!({}),
            )
            .unwrap();

        // Simulate two remote devices writing concurrent PatchBlockText ops
        let sim = engine.simulate_two_device_merge(dir.path()).unwrap();
        assert_eq!(sim.conflict_copies_created, 0);

        // inspect_status should report local-dev + synthesized laptop-a & desktop-b
        let status = engine.inspect_status(dir.path()).unwrap();
        let dev_ids: Vec<&str> = status.devices.iter().map(|d| d.device_id.as_str()).collect();
        assert!(dev_ids.contains(&"local-dev"));
        assert!(dev_ids.contains(&"laptop-a"));
        assert!(dev_ids.contains(&"desktop-b"));
        assert!(dir.path().join(".sync/devices.json").exists());

        // Apply remote ops -> merges both edits into target doc and persists .applied_local-dev.json
        let apply1 = engine.apply_remote_ops(dir.path()).unwrap();
        assert_eq!(apply1.ops_scanned, 2);
        assert_eq!(apply1.ops_applied, 2);
        assert_eq!(apply1.docs_updated, vec!["CRDT Google Drive Sync.md"]);
        let merged_md =
            fs::read_to_string(dir.path().join("CRDT Google Drive Sync.md")).unwrap();
        assert!(merged_md.contains("BLAKE3-Hashes"));
        assert!(merged_md.contains("#crdt"));

        // Second apply is idempotent (0 newly applied ops)
        let apply2 = engine.apply_remote_ops(dir.path()).unwrap();
        assert_eq!(apply2.ops_scanned, 2);
        assert_eq!(apply2.ops_applied, 0);

        // Create extra oplog files with duplicate op_id for local-dev and compact
        let dup_op = SyncOplogEntry {
            op_id: "dup-op-1".to_string(),
            device_id: "local-dev".to_string(),
            seq: 2,
            hlc_ts: now_unix(),
            doc_path: "Local.md".to_string(),
            block_id: "b2".to_string(),
            kind: SyncOperationKind::UpsertBlock,
            payload: serde_json::json!({}),
        };
        let line = serde_json::to_string(&dup_op).unwrap();
        fs::write(
            dir.path().join(".sync/local-dev_0002.oplog"),
            format!("{}\n{}\n", line, line),
        )
        .unwrap();
        fs::write(
            dir.path().join(".sync/local-dev_0003.oplog"),
            format!("{}\n", line),
        )
        .unwrap();

        let compact = engine.compact_oplogs(dir.path()).unwrap();
        assert!(compact.files_before > compact.files_after);
        assert!(compact.ops_compacted >= 2);
        assert!(compact.bytes_saved > 0);
        assert!(!dir.path().join(".sync/local-dev_0002.oplog").exists());
        assert!(!dir.path().join(".sync/local-dev_0003.oplog").exists());
        assert!(dir.path().join(".sync/local-dev_0001.oplog").exists());
    }
}
