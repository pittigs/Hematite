use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Supported block node types in the hybrid Obsidian/Logseq model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockType {
    Paragraph,
    Heading,
    ListItem,
    TaskItem,
    CodeBlock,
    Quote,
    Callout,
    Divider,
}

impl BlockType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Paragraph => "paragraph",
            Self::Heading => "heading",
            Self::ListItem => "list_item",
            Self::TaskItem => "task_item",
            Self::CodeBlock => "code",
            Self::Quote => "quote",
            Self::Callout => "callout",
            Self::Divider => "divider",
        }
    }

    pub fn from_db_str(s: &str) -> Self {
        match s {
            "heading" => Self::Heading,
            "list_item" => Self::ListItem,
            "task_item" => Self::TaskItem,
            "code" => Self::CodeBlock,
            "quote" => Self::Quote,
            "callout" => Self::Callout,
            "divider" => Self::Divider,
            _ => Self::Paragraph,
        }
    }
}

/// Task lifecycle states compatible with Markdown checkboxes and Logseq keywords.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    #[serde(rename = "TODO")]
    Todo,
    #[serde(rename = "DOING")]
    Doing,
    #[serde(rename = "DONE")]
    Done,
    #[serde(rename = "CANCELED")]
    Canceled,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Todo => "TODO",
            Self::Doing => "DOING",
            Self::Done => "DONE",
            Self::Canceled => "CANCELED",
        }
    }

    pub fn from_db_str(s: &str) -> Self {
        match s {
            "DOING" => Self::Doing,
            "DONE" => Self::Done,
            "CANCELED" => Self::Canceled,
            _ => Self::Todo,
        }
    }

    pub fn to_checkbox_marker(&self) -> &'static str {
        match self {
            Self::Todo => "[ ]",
            Self::Doing => "[/]",
            Self::Done => "[x]",
            Self::Canceled => "[-]",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetadata {
    pub status: TaskStatus,
    pub priority: Option<u8>,
    pub scheduled_at: Option<String>,
    pub deadline_at: Option<String>,
    pub recurrence: Option<String>,
}

/// A single addressable block inside a Markdown document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: String,
    pub doc_id: String,
    pub parent_block_id: Option<String>,
    pub depth: u32,
    pub sort_order: f64,
    pub block_type: BlockType,
    pub heading_level: Option<u8>,
    pub code_lang: Option<String>,
    /// True if `^block-id` is persisted in the Markdown file (lazy ID materialization).
    pub has_explicit_id: bool,
    pub raw_content: String,
    pub plain_text: String,
    pub properties: BTreeMap<String, String>,
    pub tags: Vec<String>,
    pub collapsed: bool,
    pub task: Option<TaskMetadata>,
    pub updated_at: i64,
}

/// A Markdown document in the vault.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub path: String,
    pub title: String,
    pub blake3_hash: String,
    pub frontmatter: BTreeMap<String, serde_json::Value>,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub blake3_hash: String,
    pub frontmatter: BTreeMap<String, serde_json::Value>,
    pub tags: Vec<String>,
    pub block_count: usize,
    pub task_count: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWithBlocks {
    pub document: Document,
    pub blocks: Vec<Block>,
    pub raw_markdown: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkType {
    WikiLink,
    BlockRef,
    Embed,
    Tag,
    PropertyRel,
}

impl LinkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::WikiLink => "wiki_link",
            Self::BlockRef => "block_ref",
            Self::Embed => "embed",
            Self::Tag => "tag",
            Self::PropertyRel => "property_rel",
        }
    }

    pub fn from_db_str(s: &str) -> Self {
        match s {
            "block_ref" => Self::BlockRef,
            "embed" => Self::Embed,
            "tag" => Self::Tag,
            "property_rel" => Self::PropertyRel,
            _ => Self::WikiLink,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedLink {
    pub target_raw: String,
    pub link_type: LinkType,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkItem {
    pub source_doc_id: String,
    pub source_doc_path: String,
    pub source_doc_title: String,
    pub source_block_id: String,
    pub source_plain_text: String,
    pub link_type: LinkType,
    pub target_raw: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockLookup {
    pub block: Block,
    pub doc_path: String,
    pub doc_title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub block_id: String,
    pub doc_id: String,
    pub doc_path: String,
    pub doc_title: String,
    pub snippet: String,
    pub plain_text: String,
    pub bm25_score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub elapsed_us: u64,
    pub total_hits: usize,
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskViewItem {
    pub block_id: String,
    pub doc_id: String,
    pub doc_path: String,
    pub doc_title: String,
    pub content: String,
    pub status: TaskStatus,
    pub priority: Option<u8>,
    pub scheduled_at: Option<String>,
    pub deadline_at: Option<String>,
    pub recurrence: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub path: Option<String>,
    pub node_kind: String, // "document" | "tag" | "unresolved"
    pub x: f64,
    pub y: f64,
    pub degree: usize,
    pub centrality: f64,
    pub cluster_id: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub link_type: LinkType,
    pub weight: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSnapshot {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub computed_in_us: u64,
    pub cluster_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPathResult {
    pub found: bool,
    pub path_node_ids: Vec<String>,
    pub path_labels: Vec<String>,
    pub hops: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    pub node_type: String, // "text" | "doc_embed" | "block_embed" | "group"
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub title: Option<String>,
    pub text: Option<String>,
    pub ref_doc_path: Option<String>,
    pub ref_block_id: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub from_side: Option<String>,
    pub to_side: Option<String>,
    pub label: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasData {
    pub path: String,
    pub nodes: Vec<CanvasNode>,
    pub edges: Vec<CanvasEdge>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyFilter {
    pub key: String,
    pub operator: String, // "eq" | "neq" | "contains"
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQuery {
    pub tag: Option<String>,
    pub filters: Vec<PropertyFilter>,
    pub sort_by: Option<String>,
    pub sort_desc: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRow {
    pub id: String,
    pub item_kind: String, // "document" | "block"
    pub doc_id: String,
    pub doc_path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub properties: BTreeMap<String, String>,
    pub task_status: Option<TaskStatus>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryResult {
    pub elapsed_us: u64,
    pub columns: Vec<String>,
    pub rows: Vec<DatabaseRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncOperationKind {
    UpsertBlock,
    DeleteBlock,
    SetProperty,
    PatchBlockText,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOplogEntry {
    pub op_id: String,
    pub device_id: String,
    pub seq: u64,
    pub hlc_ts: i64,
    pub doc_path: String,
    pub block_id: String,
    pub kind: SyncOperationKind,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub display_name: String,
    pub last_seen_ts: i64,
    pub op_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub device_id: String,
    pub sync_dir: String,
    pub oplog_files: Vec<String>,
    pub total_ops: usize,
    pub conflict_files_detected: usize,
    pub last_sync_ts: i64,
    #[serde(default)]
    pub devices: Vec<DeviceInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMergeReport {
    pub device_a_file: String,
    pub device_b_file: String,
    pub target_doc_path: String,
    pub base_text: String,
    pub device_a_edit: String,
    pub device_b_edit: String,
    pub merged_result: String,
    pub conflict_copies_created: usize,
    pub ops_applied: usize,
    pub elapsed_us: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files_scanned: usize,
    pub files_reindexed: usize,
    pub files_skipped_unchanged: usize,
    pub files_deleted: usize,
    pub total_documents: usize,
    pub total_blocks: usize,
    pub total_links: usize,
    pub total_tasks: usize,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultOverview {
    pub vault_path: String,
    pub db_path: String,
    pub total_documents: usize,
    pub total_blocks: usize,
    pub total_links: usize,
    pub total_tasks: usize,
    pub open_tasks: usize,
    pub db_size_bytes: u64,
    pub canvas_files: Vec<String>,
    pub sync_status: SyncStatus,
    pub revision: u64,
    pub trash_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub trash_id: String,
    pub original_path: String,
    pub title: String,
    pub deleted_at: i64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub id: i64,
    pub doc_path: String,
    pub blake3_hash: String,
    pub content: String,
    pub created_at: i64,
    pub byte_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMention {
    pub source_doc_id: String,
    pub source_doc_path: String,
    pub source_doc_title: String,
    pub source_block_id: String,
    pub source_plain_text: String,
    pub matched_term: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLinkInfo {
    pub target_raw: String,
    pub reference_count: usize,
    pub source_docs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubDocInfo {
    pub doc_id: String,
    pub path: String,
    pub title: String,
    pub degree: usize,
    pub word_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAnalytics {
    pub total_documents: usize,
    pub total_blocks: usize,
    pub total_words: usize,
    pub total_chars: usize,
    pub estimated_reading_minutes: usize,
    pub db_size_bytes: u64,
    pub orphan_documents: Vec<DocumentSummary>,
    pub broken_links: Vec<BrokenLinkInfo>,
    pub top_hubs: Vec<HubDocInfo>,
    pub largest_documents: Vec<HubDocInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeReport {
    pub elapsed_us: u64,
    pub db_size_before_bytes: u64,
    pub db_size_after_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplyReport {
    pub ops_scanned: usize,
    pub ops_applied: usize,
    pub docs_updated: Vec<String>,
    pub elapsed_us: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCompactReport {
    pub files_before: usize,
    pub files_after: usize,
    pub ops_compacted: usize,
    pub bytes_saved: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkReport {
    pub file_count: usize,
    pub block_count: usize,
    pub link_count: usize,
    pub task_count: usize,
    pub generation_ms: f64,
    pub cold_index_ms: f64,
    pub blocks_per_sec: f64,
    pub delta_sync_1_file_ms: f64,
    pub delta_files_skipped: usize,
    pub fts_search_us: u64,
    pub fts_hits: usize,
    pub graph_build_layout_ms: f64,
    pub db_size_mb: f64,
}
