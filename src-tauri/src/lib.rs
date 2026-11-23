use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use vault_core::model::{
    BacklinkItem, BenchmarkReport, Block, BlockLookup, CanvasData, DatabaseQuery,
    DatabaseQueryResult, Document, DocumentSnapshot, DocumentSummary, DocumentWithBlocks,
    GraphPathResult, GraphSnapshot, IndexStats, OptimizeReport, SearchResponse, SyncApplyReport,
    SyncCompactReport, SyncMergeReport, SyncStatus, TaskStatus, TaskViewItem, TrashItem,
    UnlinkedMention, VaultAnalytics, VaultOverview,
};
use vault_core::watcher::VaultWatcher;
use vault_core::VaultEngine;

struct AppState {
    engine: Arc<Mutex<VaultEngine>>,
    _watcher: Option<VaultWatcher>,
}

fn map_err<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[tauri::command]
fn get_vault_overview(state: State<'_, AppState>) -> Result<VaultOverview, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_overview().map_err(map_err)
}

#[tauri::command]
fn reindex_vault(state: State<'_, AppState>) -> Result<IndexStats, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.reindex_vault().map_err(map_err)
}

#[tauri::command]
fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentSummary>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.list_documents().map_err(map_err)
}

#[tauri::command]
fn get_document(
    state: State<'_, AppState>,
    target: String,
) -> Result<Option<DocumentWithBlocks>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_document(&target).map_err(map_err)
}

#[tauri::command]
fn save_document(
    state: State<'_, AppState>,
    rel_path: String,
    markdown: String,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .save_markdown_document(&rel_path, &markdown)
        .map_err(map_err)
}

#[tauri::command]
fn save_document_blocks(
    state: State<'_, AppState>,
    rel_path: String,
    document: Document,
    blocks: Vec<Block>,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .save_document_blocks(&rel_path, document, blocks)
        .map_err(map_err)
}

#[tauri::command]
fn create_document(
    state: State<'_, AppState>,
    rel_path: String,
    title: Option<String>,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .create_document(&rel_path, title.as_deref())
        .map_err(map_err)
}

#[tauri::command]
fn delete_document(state: State<'_, AppState>, rel_path: String) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.delete_document(&rel_path).map_err(map_err)
}

#[tauri::command]
fn rename_document(
    state: State<'_, AppState>,
    old_rel_path: String,
    new_rel_path: String,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .rename_document(&old_rel_path, &new_rel_path)
        .map_err(map_err)
}

#[tauri::command]
fn materialize_block_id(
    state: State<'_, AppState>,
    rel_path: String,
    block_id: String,
) -> Result<String, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .materialize_block_id(&rel_path, &block_id)
        .map_err(map_err)
}

#[tauri::command]
fn get_block_by_id(
    state: State<'_, AppState>,
    block_id: String,
) -> Result<Option<BlockLookup>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_block_by_id(&block_id).map_err(map_err)
}

#[tauri::command]
fn search_vault(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<SearchResponse, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.search_fts(&query, limit.unwrap_or(25)).map_err(map_err)
}

#[tauri::command]
fn get_backlinks(
    state: State<'_, AppState>,
    doc_id: String,
) -> Result<Vec<BacklinkItem>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_backlinks(&doc_id).map_err(map_err)
}

#[tauri::command]
fn get_tasks(
    state: State<'_, AppState>,
    status_filter: Option<TaskStatus>,
) -> Result<Vec<TaskViewItem>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_tasks(status_filter).map_err(map_err)
}

#[tauri::command]
fn toggle_task_status(
    state: State<'_, AppState>,
    block_id: String,
    next_status: TaskStatus,
) -> Result<TaskViewItem, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .toggle_task_status(&block_id, next_status)
        .map_err(map_err)
}

#[tauri::command]
fn open_daily_note(
    state: State<'_, AppState>,
    date: Option<String>,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .open_or_create_daily_note(date.as_deref())
        .map_err(map_err)
}

#[tauri::command]
fn query_database(
    state: State<'_, AppState>,
    query: DatabaseQuery,
) -> Result<DatabaseQueryResult, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.query_database(&query).map_err(map_err)
}

#[tauri::command]
fn get_graph_snapshot(
    state: State<'_, AppState>,
    include_tags: bool,
) -> Result<GraphSnapshot, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_graph_snapshot(include_tags).map_err(map_err)
}

#[tauri::command]
fn find_graph_path(
    state: State<'_, AppState>,
    from_doc_id: String,
    to_doc_id: String,
) -> Result<GraphPathResult, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine
        .find_graph_path(&from_doc_id, &to_doc_id)
        .map_err(map_err)
}

#[tauri::command]
fn get_canvas(state: State<'_, AppState>, rel_path: String) -> Result<CanvasData, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_canvas(&rel_path).map_err(map_err)
}

#[tauri::command]
fn save_canvas(state: State<'_, AppState>, canvas: CanvasData) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.save_canvas_data(&canvas).map_err(map_err)
}

#[tauri::command]
fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_sync_status().map_err(map_err)
}

#[tauri::command]
fn simulate_crdt_sync(state: State<'_, AppState>) -> Result<SyncMergeReport, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.simulate_crdt_sync().map_err(map_err)
}

#[tauri::command]
fn run_100k_benchmark() -> Result<BenchmarkReport, String> {
    VaultEngine::run_100k_benchmark().map_err(map_err)
}

#[tauri::command]
fn get_vault_revision(state: State<'_, AppState>) -> Result<u64, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    Ok(engine.revision())
}

#[tauri::command]
fn list_trash(state: State<'_, AppState>) -> Result<Vec<TrashItem>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.list_trash().map_err(map_err)
}

#[tauri::command]
fn restore_trash_item(
    state: State<'_, AppState>,
    trash_id: String,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.restore_trash_item(&trash_id).map_err(map_err)
}

#[tauri::command]
fn empty_trash(state: State<'_, AppState>) -> Result<usize, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.empty_trash().map_err(map_err)
}

#[tauri::command]
fn list_snapshots(
    state: State<'_, AppState>,
    rel_path: String,
) -> Result<Vec<DocumentSnapshot>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.list_snapshots(&rel_path).map_err(map_err)
}

#[tauri::command]
fn restore_snapshot(
    state: State<'_, AppState>,
    snapshot_id: i64,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.restore_snapshot(snapshot_id).map_err(map_err)
}

#[tauri::command]
fn get_unlinked_mentions(
    state: State<'_, AppState>,
    doc_id: String,
) -> Result<Vec<UnlinkedMention>, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_unlinked_mentions(&doc_id).map_err(map_err)
}

#[tauri::command]
fn link_unlinked_mention(
    state: State<'_, AppState>,
    source_doc_path: String,
    block_id: String,
    mention_text: String,
    target_title: String,
) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .link_unlinked_mention(&source_doc_path, &block_id, &mention_text, &target_title)
        .map_err(map_err)
}

#[tauri::command]
fn get_vault_analytics(state: State<'_, AppState>) -> Result<VaultAnalytics, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.get_vault_analytics().map_err(map_err)
}

#[tauri::command]
fn optimize_index(state: State<'_, AppState>) -> Result<OptimizeReport, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.optimize_index().map_err(map_err)
}

#[tauri::command]
fn apply_remote_sync(state: State<'_, AppState>) -> Result<SyncApplyReport, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.apply_remote_sync().map_err(map_err)
}

#[tauri::command]
fn compact_sync_oplogs(state: State<'_, AppState>) -> Result<SyncCompactReport, String> {
    let engine = state.engine.lock().map_err(map_err)?;
    engine.compact_sync_oplogs().map_err(map_err)
}

#[tauri::command]
fn update_document_property(
    state: State<'_, AppState>,
    rel_path: String,
    key: String,
    value: String,
) -> Result<DocumentWithBlocks, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine
        .update_document_property(&rel_path, &key, &value)
        .map_err(map_err)
}

#[tauri::command]
fn create_canvas(state: State<'_, AppState>, rel_path: String) -> Result<CanvasData, String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.create_canvas(&rel_path).map_err(map_err)
}

#[tauri::command]
fn delete_canvas(state: State<'_, AppState>, rel_path: String) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(map_err)?;
    engine.delete_canvas(&rel_path).map_err(map_err)
}

fn resolve_default_vault_path(app: &tauri::App) -> PathBuf {
    if let Ok(env_dir) = std::env::var("OXIDEVAULT_DIR") {
        return PathBuf::from(env_dir);
    }
    for candidate in ["./demo-vault", "../demo-vault"] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return std::fs::canonicalize(&p).unwrap_or(p);
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("vault")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let vault_dir = resolve_default_vault_path(app);
            let mut engine = VaultEngine::open(&vault_dir, None)?;
            if engine.list_documents()?.is_empty() {
                engine.seed_demo()?;
            }
            let engine_arc = Arc::new(Mutex::new(engine));
            let watcher_engine = Arc::clone(&engine_arc);
            let app_handle = app.handle().clone();
            let watcher = VaultWatcher::start(&vault_dir, move || {
                if let Ok(mut eng) = watcher_engine.lock() {
                    if let Ok(stats) = eng.reindex_vault() {
                        if stats.files_reindexed > 0 || stats.files_deleted > 0 {
                            let rev = eng.revision();
                            let _ = app_handle.emit("vault-changed", rev);
                        }
                    }
                }
            })
            .ok();

            app.manage(AppState {
                engine: engine_arc,
                _watcher: watcher,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault_overview,
            reindex_vault,
            list_documents,
            get_document,
            save_document,
            save_document_blocks,
            create_document,
            delete_document,
            rename_document,
            materialize_block_id,
            get_block_by_id,
            search_vault,
            get_backlinks,
            get_tasks,
            toggle_task_status,
            open_daily_note,
            query_database,
            get_graph_snapshot,
            find_graph_path,
            get_canvas,
            save_canvas,
            get_sync_status,
            simulate_crdt_sync,
            run_100k_benchmark,
            get_vault_revision,
            list_trash,
            restore_trash_item,
            empty_trash,
            list_snapshots,
            restore_snapshot,
            get_unlinked_mentions,
            link_unlinked_mention,
            get_vault_analytics,
            optimize_index,
            apply_remote_sync,
            compact_sync_oplogs,
            update_document_property,
            create_canvas,
            delete_canvas,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OxideVault Tauri application");
}
