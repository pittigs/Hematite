# Graph Report - Notes  (2026-11-23)

## Corpus Check
- 58 files · ~86,038 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 1, .oplog 1, .canvas 1)

## Summary
- 811 nodes · 1708 edges · 45 communities (35 shown, 10 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Tauri IPC Command Shell
- CLI HTTP API & Auth
- Hybrid Editor & Preview
- Vault Engine & Recurrence
- CRDT Oplog & Sync
- Safe Paths & Rename
- Markdown Block Parser
- Canvas Storage & Security
- Frontend Tooling Config
- API Bridge & Graph UI
- Live File Watcher
- SQLite FTS5 Search Engine
- Core Data Models
- App Shell & Navigation
- Knowledge Graph Layout
- SQLite Schema & Snapshots
- Tasks Kanban & Calendar
- Tauri App Configuration
- TypeScript Compiler Setup
- React Runtime Dependencies
- History & Trash Modals
- Database Table & Board
- Infinite Canvas Whiteboard
- Graph & Link Models
- Vault Architecture & Notes
- Block Type Enum Mapping
- Database & Task Statuses
- Sync & Benchmark Modal
- Aliases & Unlinked Mentions
- Vault Analytics Modal
- Analytics & Index Metrics
- Analytics Report Models
- Quick Capture Modal
- Database Property Queries
- Tauri Capabilities Schema
- Vault Overview & Cache
- Hybrid Block Design
- Native Desktop Architecture
- Task Metadata Models
- Workspace Crate Manifests

## God Nodes (most connected - your core abstractions)
1. `VaultEngine` - 55 edges
2. `AppState` - 42 edges
3. `Database` - 36 edges
4. `parse_markdown_document()` - 24 edges
5. `App()` - 20 edges
6. `react` - 18 edges
7. `lucide-react` - 17 edges
8. `HybridEditor()` - 17 edges
9. `compilerOptions` - 16 edges
10. `CrdtSyncEngine` - 14 edges

## Surprising Connections (you probably didn't know these)
- `CRDT Google Drive Sync Note` --conceptually_related_to--> `Append-Only CRDT Oplog Sync`  [INFERRED]
  demo-vault/CRDT Google Drive Sync.md → ARCHITECTURE.md
- `AppState` --references--> `VaultEngine`  [EXTRACTED]
  src-tauri/src/lib.rs → crates/vault-core/src/lib.rs
- `AppState` --references--> `VaultWatcher`  [EXTRACTED]
  src-tauri/src/lib.rs → crates/vault-core/src/watcher.rs
- `Architektur & Storage Engine Note` --conceptually_related_to--> `Dual-Layer Storage Architecture`  [INFERRED]
  demo-vault/Architektur & Storage Engine.md → ARCHITECTURE.md
- `Lazy Block IDs (^id)` --conceptually_related_to--> `Hybrid Obsidian + Logseq Block Model`  [INFERRED]
  demo-vault/Willkommen in OxideVault.md → ARCHITECTURE.md

## Import Cycles
- 2-file cycle: `crates/vault-core/src/graph.rs -> crates/vault-core/src/lib.rs -> crates/vault-core/src/graph.rs`

## Hyperedges (group relationships)
- **Dual-Layer Sync & Storage Pillars** — architecture_dual_layer_storage, architecture_sqlite_embedded_decision, architecture_blake3_delta_hashing, architecture_crdt_append_only_oplog [EXTRACTED 1.00]

## Communities (45 total, 10 thin omitted)

### Community 0 - "Tauri IPC Command Shell"
Cohesion: 0.07
Nodes (43): apply_remote_sync(), AppState, compact_sync_oplogs(), create_canvas(), create_document(), delete_canvas(), delete_document(), empty_trash() (+35 more)

### Community 1 - "CLI HTTP API & Auth"
Cohesion: 0.06
Nodes (32): add_cors_headers(), bearer_token_auth_validates_exact_secret(), cors_origin_validation_restricts_to_localhost(), CreateDocReq, DailyReq, DEFAULT_CORS_ORIGIN, dispatch_route(), dispatches_all_new_api_routes_end_to_end() (+24 more)

### Community 2 - "Hybrid Editor & Preview"
Cohesion: 0.10
Nodes (40): BacklinksPanel(), AutocompleteMenu, autoResizeTextarea(), BlockRefCandidate, CALLOUT_STYLES, CalloutIcon(), cloneBlocks(), CodeBlockPreview() (+32 more)

### Community 3 - "Vault Engine & Recurrence"
Cohesion: 0.07
Nodes (8): build_next_recurring_task_block(), compute_next_recurrence_date(), format_frontmatter_scalar(), full_engine_lifecycle_demo_tasks_and_lazy_id(), recurring_tasks_spawn_next_todo_occurrence_on_completion(), replace_date_property(), rewrite_wiki_links_in_markdown(), upsert_frontmatter_property()

### Community 4 - "CRDT Oplog & Sync"
Cohesion: 0.10
Nodes (18): now_unix(), SyncOperationKind, DeleteBlock, PatchBlockText, SetProperty, UpsertBlock, SyncOplogEntry, concurrent_two_device_merge_preserves_both_edits_without_conflicts() (+10 more)

### Community 5 - "Safe Paths & Rename"
Cohesion: 0.16
Nodes (6): normalize_safe_md_path(), path_stem_str(), rename_document_moves_file_and_rewrites_wiki_links(), trash_lifecycle_snapshots_and_revision_tracking(), unlinked_mentions_linking_and_frontmatter_property_update_preserve_body(), VaultEngine

### Community 6 - "Markdown Block Parser"
Cohesion: 0.14
Nodes (27): ExtractedLink, build_task_metadata(), collect_frontmatter_tags(), count_leading_spaces(), derive_title(), deterministic_block_id(), deterministic_doc_id(), extract_emoji_date() (+19 more)

### Community 7 - "Canvas Storage & Security"
Cohesion: 0.13
Nodes (15): canvas_roundtrip_and_path_traversal_protection(), CanvasFilePayload, create_and_delete_canvas_enforce_extension_and_safety(), create_canvas(), delete_canvas(), load_canvas(), normalize_safe_canvas_path(), save_canvas() (+7 more)

### Community 8 - "Frontend Tooling Config"
Cohesion: 0.09
Nodes (28): devDependencies, tailwindcss@^4.0.0, @tailwindcss/vite@^4.0.0, @tauri-apps/cli@^2.12.5, @types/react@^19.0.0, @types/react-dom@^19.0.0, typescript@^5.7.2, vite@^6.0.5 (+20 more)

### Community 9 - "API Bridge & Graph UI"
Cohesion: 0.11
Nodes (26): authHeaders(), httpGet(), httpPost(), BacklinksPanelProps, CLUSTER_COLORS, GraphViewProps, LocalGraphMode, BacklinkItem (+18 more)

### Community 10 - "Live File Watcher"
Cohesion: 0.11
Nodes (6): DEBOUNCE_WINDOW, ignores_internal_directories_and_temp_files(), is_ignored_path(), should_notify_event(), VaultWatcher, watcher_debounces_burst_and_stops_cleanly_on_drop()

### Community 11 - "SQLite FTS5 Search Engine"
Cohesion: 0.10
Nodes (8): build_fts5_expr(), collect_wikilink_spans(), find_unlinked_word_boundary_match(), is_word_char(), parse_search_query(), ParsedSearchQuery, search_fts_supports_operators_phrases_exclusions_and_filter_only_queries(), truncate_snippet()

### Community 12 - "Core Data Models"
Cohesion: 0.11
Nodes (20): BenchmarkReport, CanvasData, CanvasEdge, CanvasNode, DatabaseQuery, DeviceInfo, DocumentSnapshot, GraphPathResult (+12 more)

### Community 13 - "App Shell & Navigation"
Cohesion: 0.14
Nodes (20): isTauriRuntime(), ActiveView, App(), buildFolderTree(), FolderTreeNode, FolderTreeView(), loadStoredList(), loadStoredTheme() (+12 more)

### Community 14 - "Knowledge Graph Layout"
Cohesion: 0.12
Nodes (6): build_graph_snapshot(), canonical_edge_key(), compute_clusters(), compute_force_directed_layout(), compute_pagerank(), find_shortest_path()

### Community 16 - "Tasks Kanban & Calendar"
Cohesion: 0.17
Nodes (17): buildMonthGrid(), CalendarCell, formatLocalDate(), formatTimer(), getDueState(), KANBAN_COLUMNS, normalizeDatePrefix(), PomodoroMode (+9 more)

### Community 17 - "Tauri App Configuration"
Cohesion: 0.11
Nodes (17): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+9 more)

### Community 18 - "TypeScript Compiler Setup"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+9 more)

### Community 19 - "React Runtime Dependencies"
Cohesion: 0.14
Nodes (13): dependencies, lucide-react@^0.468.0, react@^19.0.0, react-dom@^19.0.0, @tauri-apps/api@^2.1.0, lucide-react, react, react-dom (+5 more)

### Community 20 - "History & Trash Modals"
Cohesion: 0.20
Nodes (13): countLines(), formatBytes(), formatSnapshotDate(), HistoryModal(), HistoryModalProps, HybridEditorProps, formatDeletedAt(), formatKb() (+5 more)

### Community 21 - "Database Table & Board"
Cohesion: 0.21
Nodes (13): DatabaseView(), DatabaseViewMode, DatabaseViewProps, downloadBlob(), escapeCsvCell(), groupRowsForKanban(), loadSavedViews(), persistSavedViews() (+5 more)

### Community 22 - "Infinite Canvas Whiteboard"
Cohesion: 0.19
Nodes (12): CardColorKey, cloneCanvas(), COLOR_DOT_STYLES, COLOR_KEYS, escapeXml(), InfiniteCanvas(), NODE_COLORS, SVG_THEME (+4 more)

### Community 23 - "Graph & Link Models"
Cohesion: 0.17
Nodes (10): BacklinkItem, GraphEdge, GraphNode, GraphSnapshot, LinkType, BlockRef, Embed, PropertyRel (+2 more)

### Community 24 - "Vault Architecture & Notes"
Cohesion: 0.29
Nodes (9): BLAKE3 Parallel Delta Hashing, Append-Only CRDT Oplog Sync, Architektur & Storage Engine Note, Buchnotizen - Data-Oriented Programming, Buchnotizen - Rust in Action, CRDT Google Drive Sync Note, Daily Note 2026-11-17, Roadmap & Meilensteine Note (+1 more)

### Community 26 - "Block Type Enum Mapping"
Cohesion: 0.18
Nodes (9): BlockType, Callout, CodeBlock, Divider, Heading, ListItem, Paragraph, Quote (+1 more)

### Community 27 - "Database & Task Statuses"
Cohesion: 0.18
Nodes (8): DatabaseQueryResult, DatabaseRow, TaskStatus, Canceled, Doing, Done, Todo, TaskViewItem

### Community 28 - "Sync & Benchmark Modal"
Cohesion: 0.25
Nodes (10): formatBytes(), formatTimestamp(), MetricCard(), SyncBenchmarkModal(), SyncBenchmarkModalProps, BenchmarkReport, SyncApplyReport, SyncCompactReport (+2 more)

### Community 30 - "Aliases & Unlinked Mentions"
Cohesion: 0.25
Nodes (3): aliases_resolve_links_and_lookup_and_unlinked_mentions(), extract_frontmatter_aliases(), incremental_sync_and_fts5_search_work()

### Community 31 - "Vault Analytics Modal"
Cohesion: 0.32
Nodes (7): AnalyticsModal(), AnalyticsModalProps, formatBytes(), KpiCard(), KpiCardProps, OptimizeReport, VaultAnalytics

### Community 33 - "Analytics Report Models"
Cohesion: 0.29
Nodes (6): BrokenLinkInfo, Document, DocumentSummary, DocumentWithBlocks, HubDocInfo, VaultAnalytics

### Community 34 - "Quick Capture Modal"
Cohesion: 0.33
Nodes (6): vaultApi, CaptureMode, PriorityLevel, QuickCaptureModal(), QuickCaptureModalProps, todayLocalIso()

### Community 36 - "Tauri Capabilities Schema"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 40 - "Native Desktop Architecture"
Cohesion: 0.67
Nodes (3): Multi-Threaded Graph Engine (petgraph + rayon), Rust Core + Tauri v2 Shell, Webview HTML Entry (index.html)

### Community 41 - "Task Metadata Models"
Cohesion: 0.67
Nodes (3): Block, BlockLookup, TaskMetadata

### Community 42 - "Workspace Crate Manifests"
Cohesion: 0.67
Nodes (3): oxidevault-desktop, vault-cli, vault-core

## Knowledge Gaps
- **28 isolated node(s):** `vault-cli`, `Paragraph`, `Heading`, `ListItem`, `TaskItem` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 212 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VaultEngine` connect `Safe Paths & Rename` to `Tauri IPC Command Shell`, `CLI HTTP API & Auth`, `Vault Engine & Recurrence`, `CRDT Oplog & Sync`, `Vault Overview & Cache`, `Benchmark & FTS Response`, `Knowledge Graph Layout`, `SQLite Schema & Snapshots`, `Engine Sync & Canvas API`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `parse_markdown_document()` (e.g. with `.sync_vault()` and `.save_markdown_document()`) actually correct?**
  _`parse_markdown_document()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `vault-cli`, `Paragraph`, `Heading` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Tauri IPC Command Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.06701754385964913 - nodes in this community are weakly interconnected._
- **Why does `Database` connect `SQLite Schema & Snapshots` to `Analytics & Index Metrics`, `Database Property Queries`, `Vault Engine & Recurrence`, `Safe Paths & Rename`, `SQLite FTS5 Search Engine`, `Knowledge Graph Layout`, `Block & Document Lookups`, `Aliases & Unlinked Mentions`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `CLI HTTP API & Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.06377551020408163 - nodes in this community are weakly interconnected._
- **Why does `SyncOperationKind` connect `CRDT Oplog & Sync` to `Vault Engine & Recurrence`, `Core Data Models`, `Canvas Storage & Security`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._