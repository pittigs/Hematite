> [!WARNING]
> **Alpha Pre-Release (`v0.1.0-alpha.1`):** Frühe Testversion zur Evaluierung. Bitte lege vor dem Testen mit wichtigen Notizen ein Backup deines Vault-Ordners an.

## Highlights in `v0.1.0-alpha.1`

- **Nativer Rust-Core + lokaler SQLite-Turbo-Index:** Paralleles `BLAKE3`-Delta-Hashing (`rayon`), `WAL` + `256 MB mmap` + `FTS5` (BM25) + `JSONB`, Live File-Watcher (`notify`) und 100.000-Blöcke-Benchmark (`vault-cli bench-100k`).
- **Hybrid-Editor & Split-View:** Freie Markdown-Dokumente mit adressierbaren Blöcken, Lazy Block-IDs (`^id`) & Transklusionen (`((id))`), Block-Zoom, Drag & Drop, `/` & `[[` Autocomplete, Bild-Paste/Drag & Drop (`![[assets/...]]`), Snapshot-Historie, Outline und Split-View (`doc` / `graph`).
- **Wissensgraph & Infinite Canvas:** Multi-threaded `petgraph`-Layout, 1-/2-Hop-Lokalgraph, Kürzeste-Pfad-Suche, Theme-aware Render-on-Demand & PNG-Export sowie `.canvas`-Whiteboard mit Minimap und SVG-Export.
- **Aufgaben, Kalender & Datenbank-Views:** Task-Liste, Drag & Drop Kanban, Monatskalender, wiederkehrende Aufgaben, Pomodoro-Timer; Datenbank-Tabelle mit Inline-Editing, Kanban, Galerie, Saved Views und CSV/JSON-Export.
- **Cloud-sicherer Sync & Multi-Vault:** Append-Only `.sync/*.oplog`-Dateien + 3-Way-Merge + Compaction, Multi-Vault-Switcher, Papierkorb (`.trash/`), Dark/Light/High-Contrast Themes.

## Enthaltene Artefakte (via Release Workflow)
- **OxideVault Desktop** (Tauri v2 Installer/AppImage/DMG/MSI für Linux, macOS, Windows)
- **`vault-cli`** (Standalone CLI & lokaler HTTP-API-Server inkl. `bench-100k`, `search`, `tasks`, `graph`, `serve`) mit SHA256-Prüfsummen

## Bekannte Alpha-Einschränkungen
- CRDT nutzt aktuell noch einen 3-Way-Wort-Merger (volle `loro`-Integration folgt).
- Vault-Auswahl erfolgt per Pfadangabe statt nativem System-Ordnerdialog.
- Noch keine E2EE-Verschlüsselung für private Unterordner.

Alle Details stehen im [CHANGELOG.md](../CHANGELOG.md) und in der [README.md](../README.md). Feedback und Bug-Reports sind über GitHub Issues herzlich willkommen!
