# Changelog

Alle relevanten Änderungen an **OxideVault** werden in dieser Datei im Format von [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) dokumentiert.

## [0.1.0-alpha.1] - 2026-11-23

> **Hinweis:** Erster öffentlicher **Alpha Pre-Release** von OxideVault.

### Hinzugefügt
- **Dual-Layer Rust Core (`vault-core`):**
  - Paralleles `BLAKE3`-Delta-Hashing (`rayon`) und lokaler `SQLite`-Turbo-Index (`WAL`, `mmap`, `FTS5`, `JSONB`) außerhalb des Cloud-Vault-Ordners.
  - Live File-Watcher (`notify`) mit 300 ms Debouncing und automatischer Reindexierung (Tauri `"vault-changed"`-Event & Revisions-Polling).
  - Multi-Vault-Unterstützung (`switch_vault`) mit separatem lokalem SQLite-Cache pro Vault und `VaultSwitcherModal`.
  - Soft-Delete-Papierkorb (`.trash/`) inkl. Wiederherstellung (`TrashModal`) sowie automatische Dokument-Snapshots (`doc_snapshots`, max. 30 Versionen/Notiz, `HistoryModal`).
  - Erweiterte FTS5-Suchoperatoren (`tag:#...`, `path:...`, `status:...`, `"Phrase"`, `-Ausschluss`), Frontmatter-Aliase und 1-Klick-Verlinkung unverlinkter Erwähnungen (`UnlinkedMention`).
  - Asset-Speicher (`assets.rs`) für Bilder per Paste, Drag & Drop oder Upload (`![[assets/...]]`) inkl. MIME-Erkennung und Base64-Transport.
  - Wiederkehrende Aufgaben (`daily`, `weekly`, `monthly`, `yearly`, `every Nd/Nw/Nm/Ny`) beim Abschließen von Tasks.
  - Vault-Health-Analyse (`AnalyticsModal`: Orphans, Ghost-Links, Top Hubs, Lesedauer) und Index-Optimierung (`optimize_index`).
  - Append-Only CRDT-Oplogs (`.sync/*.oplog`), Geräte-Registry (`.sync/devices.json`), `apply_remote_sync` (3-Way-Merge) und `compact_sync_oplogs`.
- **Frontend & UI (`Tauri v2` + `React 19` + `Tailwind CSS v4`):**
  - Modularisierter **Hybrid-Editor** (`src/components/editor/*`) mit Undo/Redo, Block-Drag-and-Drop, Block-Zoom (Hoisting), Keyboard-Autocomplete (`/`, `[[`, `((`), Suchen & Ersetzen, Hover-Previews, Outline-Panel und Clean-Markdown-/HTML-Export.
  - **Split-View** (`doc` / `graph`) direkt neben dem Haupteditor.
  - **Theme-Aware Wissensgraph** mit Render-on-Demand, Lokal-Graph (`1-Hop` / `2-Hops`), Knotensuche, Filter-Toggles, Top-Hubs-Panel und PNG-Export.
  - **Infinite Whiteboard (`.canvas`)** mit Undo/Redo, Snap-to-Grid, Karten-Farben, editierbaren Kanten, Minimap, Text-Karte→Notiz-Konvertierung und SVG-Export.
  - **Aufgaben & Datenbank:** Task-Liste, Kanban (Drag & Drop), Monatskalender und Pomodoro-Timer; Datenbank-Tabelle (Inline-Property-Editing), Kanban, Galerie, Saved Views und CSV/JSON-Export.
  - **Command Palette & Modals:** `>`-Befehlsmodus, Quick Capture (`Ctrl+Shift+N`), Shortcuts-Übersicht (`Ctrl+/`) sowie **Dark / Light / High-Contrast Themes** und Zen-Modus (`Ctrl+Shift+F`).
- **CI/CD & Release:** GitHub Actions Workflows für Tests (`ci.yml`) und Tag-basierte Pre-Releases (`release.yml`), MIT-Lizenz, Issue-Templates.

### Geändert & Verbessert
- **Sicherheit & Stabilität:** Path-Traversal-Schutz (`fs_utils.rs`), atomares Schreiben via `NamedTempFile` + `sync_all` + `persist`, Bearer-Token-Auth (`--token` / `OXIDEVAULT_API_TOKEN`), localhost-beschränktes CORS und 24 MiB Request-Limit im `vault-cli`-Server.
- **Architektur & Performance:** `vault-core` in fokussierte Module (`trash.rs`, `recurrence.rs`, `frontmatter.rs`, `assets.rs`) aufgeteilt, 2-Datei-Importzyklus (`graph.rs <-> lib.rs`) entfernt und Vite-Bundle via `React.lazy`/`Suspense` unter 400 kB (Main-Chunk) optimiert.

### Bekannte Alpha-Einschränkungen
- Der CRDT-Merger nutzt aktuell noch einen deterministischen 3-Way-Wort-Merger; die vollständige `loro`-CRDT-Integration sowie automatisches Anwenden eingehender Remote-Oplogs direkt beim Watcher-Event folgen in einem späteren Release.
- Der Multi-Vault-Switcher arbeitet aktuell mit direkter Pfadangabe (ein nativer OS-Ordnerauswahldialog über `tauri-plugin-dialog` ist noch nicht eingebunden).
- Ende-zu-Ende-Verschlüsselung (`private/`-Ordner) und Live-Query-Codeblöcke (` ```query``` `) sind noch nicht enthalten.
