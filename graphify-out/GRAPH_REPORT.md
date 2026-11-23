# Graph Report - Notes  (2026-11-23)

## Corpus Check
- 67 files · ~93,960 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 1, .oplog 1, .canvas 1)

## Summary
- 922 nodes · 2061 edges · 54 communities (41 shown, 13 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 86 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Hybrid Editor Modules
- Tauri IPC Command Shell
- Assets, Canvas & Trash Storage
- CRDT Oplog & Sync
- NPM Dependencies & Tooling
- Markdown Block Parser
- CLI HTTP Auth & Models
- API Bridge & Sync Modal
- App Shell, Lazy Views & Split
- SQLite FTS5 & Database Queries
- Vault Engine Core & Tests
- Live File Watcher
- Core Data Models
- Knowledge Graph Layout
- Vault Engine Operations
- Tasks Kanban & Calendar
- Safe Paths, Rename & Trash
- Tauri App Configuration
- TypeScript Compiler Setup
- SQLite Schema & Indexing
- Recurring Tasks Engine
- History & Trash Modals
- Database Table, Board & Gallery
- Graph & Link Models
- Theme-Aware Graph Renderer
- Infinite Canvas Whiteboard
- Vault Architecture & Notes
- Block Type Enum Mapping
- Database & Task Statuses
- CLI HTTP Router & Watcher
- Multi-Vault Switch & Cache
- Command Palette & Shortcuts
- Aliases & Unlinked Mentions
- Frontmatter & Link Rewriting
- Analytics & Index Queries
- Analytics Report Models
- Quick Capture Modal
- Vault Analytics Modal
- Vault Switcher Modal
- Tauri Capabilities Schema
- HTTP CORS & Body Limits
- Document Snapshot Store
- CLI Query String Parser
- Hybrid Block Design
- Native Desktop Architecture
- Task Metadata Models
- Workspace Crate Manifests

## God Nodes (most connected - your core abstractions)
1. `VaultEngine` - 57 edges
2. `AppState` - 45 edges
3. `HybridEditor()` - 41 edges
4. `Database` - 36 edges
5. `parse_markdown_document()` - 24 edges
6. `App()` - 23 edges
7. `atomic_write()` - 21 edges
8. `lucide-react` - 21 edges
9. `react` - 21 edges
10. `vaultApi` - 16 edges

## Surprising Connections (you probably didn't know these)
- `CRDT Google Drive Sync Note` --conceptually_related_to--> `Append-Only CRDT Oplog Sync`  [INFERRED]
  demo-vault/CRDT Google Drive Sync.md → ARCHITECTURE.md
- `AppState` --references--> `VaultEngine`  [EXTRACTED]
  src-tauri/src/lib.rs → crates/vault-core/src/lib.rs
- `spawn_vault_watcher()` --references--> `VaultEngine`  [EXTRACTED]
  src-tauri/src/lib.rs → crates/vault-core/src/lib.rs
- `AppState` --references--> `VaultWatcher`  [EXTRACTED]
  src-tauri/src/lib.rs → crates/vault-core/src/watcher.rs
- `spawn_vault_watcher()` --references--> `VaultWatcher`  [EXTRACTED]
  src-tauri/src/lib.rs → crates/vault-core/src/watcher.rs

## Import Cycles
- 1-file cycle: `crates/vault-core/src/graph.rs -> crates/vault-core/src/graph.rs`

## Hyperedges (group relationships)
- **Dual-Layer Sync & Storage Pillars** — architecture_dual_layer_storage, architecture_sqlite_embedded_decision, architecture_blake3_delta_hashing, architecture_crdt_append_only_oplog [EXTRACTED 1.00]

## Communities (54 total, 13 thin omitted)

### Community 0 - "Hybrid Editor Modules"
Cohesion: 0.06
Nodes (79): lucide-react, react, BacklinksPanel(), AutocompleteMenu(), AutocompleteMenuProps, applyInlineInsertion(), AutocompleteMenuState, autoResizeTextarea() (+71 more)

### Community 1 - "Tauri IPC Command Shell"
Cohesion: 0.06
Nodes (47): apply_remote_sync(), AppState, compact_sync_oplogs(), create_canvas(), create_document(), delete_canvas(), delete_document(), empty_trash() (+39 more)

### Community 2 - "Assets, Canvas & Trash Storage"
Cohesion: 0.09
Nodes (40): base64_roundtrips_all_padding_cases_and_whitespace(), BASE64_TABLE, decode_base64(), decode_base64_char(), detect_mime_type(), encode_base64(), enforces_filename_validation_path_safety_and_size_limit(), MAX_ASSET_BYTES (+32 more)

### Community 3 - "CRDT Oplog & Sync"
Cohesion: 0.10
Nodes (18): now_unix(), SyncOperationKind, DeleteBlock, PatchBlockText, SetProperty, UpsertBlock, SyncOplogEntry, concurrent_two_device_merge_preserves_both_edits_without_conflicts() (+10 more)

### Community 4 - "NPM Dependencies & Tooling"
Cohesion: 0.08
Nodes (33): dependencies, lucide-react@^0.468.0, react@^19.0.0, react-dom@^19.0.0, devDependencies, tailwindcss@^4.0.0, @tailwindcss/vite@^4.0.0, @tauri-apps/cli@^2.12.5 (+25 more)

### Community 5 - "Markdown Block Parser"
Cohesion: 0.14
Nodes (27): ExtractedLink, build_task_metadata(), collect_frontmatter_tags(), count_leading_spaces(), derive_title(), deterministic_block_id(), deterministic_doc_id(), extract_emoji_date() (+19 more)

### Community 6 - "CLI HTTP Auth & Models"
Cohesion: 0.07
Nodes (21): bearer_token_auth_validates_exact_secret(), cors_origin_validation_restricts_to_localhost(), CreateDocReq, DailyReq, DEFAULT_CORS_ORIGIN, is_allowed_localhost_origin(), is_authorized(), LinkMentionReq (+13 more)

### Community 7 - "API Bridge & Sync Modal"
Cohesion: 0.12
Nodes (28): authHeaders(), httpGet(), httpPost(), BacklinksPanelProps, formatBytes(), formatTimestamp(), MetricCard(), SyncBenchmarkModal() (+20 more)

### Community 8 - "App Shell, Lazy Views & Split"
Cohesion: 0.11
Nodes (27): @tauri-apps/api@^2.1.0, @tauri-apps/api, isTauriRuntime(), ActiveView, AnalyticsModal, App(), buildFolderTree(), DatabaseView (+19 more)

### Community 9 - "SQLite FTS5 & Database Queries"
Cohesion: 0.09
Nodes (10): build_fts5_expr(), collect_wikilink_spans(), find_unlinked_word_boundary_match(), is_word_char(), matches_filters(), matches_tag(), parse_search_query(), ParsedSearchQuery (+2 more)

### Community 11 - "Live File Watcher"
Cohesion: 0.11
Nodes (6): DEBOUNCE_WINDOW, ignores_internal_directories_and_temp_files(), is_ignored_path(), should_notify_event(), VaultWatcher, watcher_debounces_burst_and_stops_cleanly_on_drop()

### Community 12 - "Core Data Models"
Cohesion: 0.11
Nodes (20): BenchmarkReport, CanvasData, CanvasEdge, CanvasNode, DatabaseQuery, DeviceInfo, DocumentSnapshot, GraphPathResult (+12 more)

### Community 13 - "Knowledge Graph Layout"
Cohesion: 0.13
Nodes (7): build_graph_snapshot(), canonical_edge_key(), compute_clusters(), compute_force_directed_layout(), compute_pagerank(), find_shortest_path(), graph_snapshot_and_shortest_path_handle_connected_and_disconnected_nodes()

### Community 15 - "Tasks Kanban & Calendar"
Cohesion: 0.15
Nodes (19): buildMonthGrid(), CalendarCell, formatLocalDate(), formatTimer(), getDueState(), KANBAN_COLUMNS, normalizeDatePrefix(), PomodoroMode (+11 more)

### Community 16 - "Safe Paths, Rename & Trash"
Cohesion: 0.24
Nodes (4): normalize_safe_md_path(), rename_document_moves_file_and_rewrites_wiki_links(), trash_lifecycle_snapshots_and_revision_tracking(), unlinked_mentions_linking_and_frontmatter_property_update_preserve_body()

### Community 17 - "Tauri App Configuration"
Cohesion: 0.11
Nodes (17): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+9 more)

### Community 18 - "TypeScript Compiler Setup"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+9 more)

### Community 20 - "Recurring Tasks Engine"
Cohesion: 0.25
Nodes (8): build_next_recurring_task_block(), builds_next_recurring_block_with_shifted_dates_and_todo_status(), builds_next_recurring_block_without_existing_dates_appends_scheduled(), compute_next_recurrence_date(), computes_next_recurrence_date_across_rules(), replace_date_property(), replaces_multiline_and_inline_date_properties(), sample_task_block()

### Community 21 - "History & Trash Modals"
Cohesion: 0.20
Nodes (13): countLines(), formatBytes(), formatSnapshotDate(), HistoryModal(), HistoryModalProps, HybridEditorProps, formatDeletedAt(), formatKb() (+5 more)

### Community 22 - "Database Table, Board & Gallery"
Cohesion: 0.21
Nodes (13): DatabaseView(), DatabaseViewMode, DatabaseViewProps, downloadBlob(), escapeCsvCell(), groupRowsForKanban(), loadSavedViews(), persistSavedViews() (+5 more)

### Community 23 - "Graph & Link Models"
Cohesion: 0.17
Nodes (10): BacklinkItem, GraphEdge, GraphNode, GraphSnapshot, LinkType, BlockRef, Embed, PropertyRel (+2 more)

### Community 24 - "Theme-Aware Graph Renderer"
Cohesion: 0.18
Nodes (11): CLUSTER_COLORS, GRAPH_THEME_PALETTES, GraphThemePalette, GraphView(), GraphViewProps, LocalGraphMode, readThemeMode(), ThemeMode (+3 more)

### Community 25 - "Infinite Canvas Whiteboard"
Cohesion: 0.21
Nodes (11): CardColorKey, cloneCanvas(), COLOR_DOT_STYLES, COLOR_KEYS, escapeXml(), InfiniteCanvas(), NODE_COLORS, SVG_THEME (+3 more)

### Community 26 - "Vault Architecture & Notes"
Cohesion: 0.29
Nodes (9): BLAKE3 Parallel Delta Hashing, Append-Only CRDT Oplog Sync, Architektur & Storage Engine Note, Buchnotizen - Data-Oriented Programming, Buchnotizen - Rust in Action, CRDT Google Drive Sync Note, Daily Note 2026-11-17, Roadmap & Meilensteine Note (+1 more)

### Community 27 - "Block Type Enum Mapping"
Cohesion: 0.18
Nodes (9): BlockType, Callout, CodeBlock, Divider, Heading, ListItem, Paragraph, Quote (+1 more)

### Community 28 - "Database & Task Statuses"
Cohesion: 0.18
Nodes (8): DatabaseQueryResult, DatabaseRow, TaskStatus, Canceled, Doing, Done, Todo, TaskViewItem

### Community 29 - "CLI HTTP Router & Watcher"
Cohesion: 0.31
Nodes (7): dispatch_route(), dispatches_all_new_api_routes_end_to_end(), get_header_value(), handle_request(), main(), serve_http(), spawn_cli_watcher()

### Community 30 - "Multi-Vault Switch & Cache"
Cohesion: 0.24
Nodes (4): list_canvas_files(), default_cache_db_path(), expand_tilde_path(), switch_vault_creates_target_preserves_monotonic_revision_and_isolates_assets()

### Community 32 - "Command Palette & Shortcuts"
Cohesion: 0.25
Nodes (8): FolderTreeNode, CommandPaletteAction, CommandPaletteProps, OPERATOR_CHIPS, OperatorChip, InfiniteCanvasProps, DocumentSummary, SearchResponse

### Community 33 - "Aliases & Unlinked Mentions"
Cohesion: 0.25
Nodes (3): aliases_resolve_links_and_lookup_and_unlinked_mentions(), extract_frontmatter_aliases(), incremental_sync_and_fts5_search_work()

### Community 34 - "Frontmatter & Link Rewriting"
Cohesion: 0.39
Nodes (6): format_frontmatter_scalar(), formats_frontmatter_scalars_safely(), rewrite_wiki_links_in_markdown(), rewrites_wiki_links_preserving_aliases_anchors_and_other_links(), upsert_frontmatter_property(), upserts_updates_and_prepends_frontmatter_preserving_body()

### Community 36 - "Analytics Report Models"
Cohesion: 0.29
Nodes (6): BrokenLinkInfo, Document, DocumentSummary, DocumentWithBlocks, HubDocInfo, VaultAnalytics

### Community 37 - "Quick Capture Modal"
Cohesion: 0.33
Nodes (6): vaultApi, CaptureMode, PriorityLevel, QuickCaptureModal(), QuickCaptureModalProps, todayLocalIso()

### Community 38 - "Vault Analytics Modal"
Cohesion: 0.38
Nodes (6): AnalyticsModal(), AnalyticsModalProps, formatBytes(), KpiCard(), KpiCardProps, VaultAnalytics

### Community 39 - "Vault Switcher Modal"
Cohesion: 0.57
Nodes (6): loadRecentVaults(), normalizeVaultList(), persistRecentVaults(), VaultSwitcherModal(), VaultSwitcherModalProps, VaultOverview

### Community 40 - "Tauri Capabilities Schema"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 41 - "HTTP CORS & Body Limits"
Cohesion: 0.40
Nodes (3): add_cors_headers(), read_capped_body(), read_capped_body_enforces_limit()

### Community 43 - "CLI Query String Parser"
Cohesion: 0.50
Nodes (4): parse_query_params(), parses_query_params_and_percent_encoding(), percent_decode(), percent_decode_handles_utf8_and_invalid_sequences()

### Community 45 - "Native Desktop Architecture"
Cohesion: 0.67
Nodes (3): Multi-Threaded Graph Engine (petgraph + rayon), Rust Core + Tauri v2 Shell, Webview HTML Entry (index.html)

### Community 46 - "Task Metadata Models"
Cohesion: 0.67
Nodes (3): Block, BlockLookup, TaskMetadata

### Community 47 - "Workspace Crate Manifests"
Cohesion: 0.67
Nodes (3): oxidevault-desktop, vault-cli, vault-core

## Knowledge Gaps
- **28 isolated node(s):** `vault-cli`, `Paragraph`, `Heading`, `ListItem`, `TaskItem` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 220 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VaultEngine` connect `Vault Engine Operations` to `Tauri IPC Command Shell`, `CRDT Oplog & Sync`, `CLI HTTP Auth & Models`, `Vault Engine Core & Tests`, `Safe Paths, Rename & Trash`, `Backlinks Lookup API`, `Trash Listing API`, `SQLite Schema & Indexing`, `Unlinked Mentions API`, `Index Optimization API`, `CLI HTTP Router & Watcher`, `Multi-Vault Switch & Cache`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **What connects `vault-cli`, `Paragraph`, `Heading` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Hybrid Editor Modules` be split into smaller, more focused modules?**
  _Cohesion score 0.06191222570532915 - nodes in this community are weakly interconnected._
- **Why does `Database` connect `SQLite Schema & Indexing` to `Aliases & Unlinked Mentions`, `Analytics & Index Queries`, `SQLite FTS5 & Database Queries`, `Document Snapshot Store`, `Vault Engine Core & Tests`, `Knowledge Graph Layout`, `Vault Engine Operations`, `Block & Document Lookups`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Should `Tauri IPC Command Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.06388888888888888 - nodes in this community are weakly interconnected._
- **Why does `SyncOperationKind` connect `CRDT Oplog & Sync` to `Assets, Canvas & Trash Storage`, `Vault Engine Core & Tests`, `Core Data Models`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Assets, Canvas & Trash Storage` be split into smaller, more focused modules?**
  _Cohesion score 0.08531073446327683 - nodes in this community are weakly interconnected._