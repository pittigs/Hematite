# OxideVault

![Version](https://img.shields.io/badge/version-v0.1.0--alpha.1-amber?style=flat-square)
![Status](https://img.shields.io/badge/release-alpha%20pre--release-orange?style=flat-square)
![Stack](https://img.shields.io/badge/stack-Rust%20%2B%20Tauri%20v2%20%2B%20React%2019-indigo?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-emerald?style=flat-square)

**OxideVault** ist eine Local-First-Wissensdatenbank und Hybrid-Notiz-App auf Basis eines nativen **Rust-Cores** (`vault-core`), **SQLite WAL + FTS5 + JSONB**, **Tauri v2** und **React 19 + TypeScript**. Sie verbindet freie Markdown-Langformdokumente (wie Obsidian) mit adressierbaren Blöcken, Block-Transklusionen `((id))` und Outliner-Bedienung (wie Logseq) – bei strikter Trennung zwischen Cloud-sicherem Vault und lokalem SSD-Cache.

> [!WARNING]
> **Alpha Pre-Release (`v0.1.0-alpha.1`):** Dies ist eine frühe Alpha-Version zum Ausprobieren und Testen. Dateiformate, Sync-Logs und APIs können sich bis `v1.0` noch ändern. Lege bei produktiven Notizen bitte regelmäßige Backups deines Vault-Ordners an.

---

## Kernfunktionen

- **Dual-Layer Storage & Live File-Watcher:** Lesbare `.md`-Dateien + `.canvas`-Whiteboards + Append-Only `.sync/*.oplog`-Dateien im Vault-Ordner; ephemerer Hochgeschwindigkeits-Index (`index.sqlite` mit WAL, 256 MB `mmap`, FTS5 & JSONB) außerhalb der Cloud auf der lokalen SSD. Externe Änderungen werden über `notify` live erkannt und per `BLAKE3` inkrementell reindexiert.
- **Hybrid-Editor & Rich Preview:** Outliner mit Drag & Drop, Block-Zoom (Hoisting), `Tab`/`Shift+Tab`-Hierarchie, Undo/Redo (`Ctrl+Z`/`Ctrl+Shift+Z`), `/` Slash-Menü, `[[` Wiki-Link- & `((` Block-Ref-Autocomplete, Hover-Vorschau, In-Dokument-Suchen & Ersetzen (`Ctrl+F`), **Bild-Paste/Drag & Drop** (`![[assets/...]]`), Snapshot-Historie (max. 30 Versionen/Notiz), Inhaltsverzeichnis (Outline), **Split-View** (Notiz + Zweitnotiz oder Wissensgraph) und Export als sauberes `.md` oder `.html`.
- **Blitzsuche & Backlinks:** SQLite-FTS5-Volltextsuche mit BM25-Ranking und Operatoren (`tag:#...`, `path:...`, `status:TODO`, `"Phrase"`, `-Ausschluss`), eingehende Backlinks, Frontmatter-Aliase und 1-Klick-Verlinkung **unverlinkter Erwähnungen**.
- **Wissensgraph & Infinite Canvas:** Multi-threaded Graph-Layout (`petgraph` + `rayon`), PageRank-Hubs, Kürzeste-Pfad-Suche, Lokal-Graph (`1-Hop` / `2-Hops`), Render-on-Demand & PNG-Export sowie ein Infinite Whiteboard (`.canvas`) mit Undo/Redo, Snap-to-Grid, Minimap, Notiz-/Block-Einbettung, Karte→Notiz-Konvertierung und SVG-Export.
- **Aufgaben, Kalender & Datenbank-Views:** Globale Task-Aggregation als **Liste**, **Kanban** (Drag & Drop) und **Monatskalender**, **wiederkehrende Aufgaben** (`daily`, `weekly`, `monthly`, `every Nd/Nw/Nm`), Pomodoro-Fokus-Timer sowie strukturierte **Datenbank-Ansichten** (Tabelle mit Inline-Editing, Kanban, Galerie, Saved Views, CSV/JSON-Export).
- **Multi-Vault, Papierkorb, Analytics & Themes:** Vault-Switcher für mehrere Ordner, Soft-Delete-Papierkorb (`.trash/`), Vault-Health-Analyse (Orphans, Ghost-Links, Hubs), Quick Capture (`Ctrl+Shift+N`), Zen-Modus (`Ctrl+Shift+F`) sowie **Dark / Light / High-Contrast Themes**.

---

## Schnellstart

### Voraussetzungen
- **Rust** (stable, inkl. `cargo`)
- **Node.js** >= 22 (empfohlen: Node 24) & `npm`
- Für Desktop-Builds unter Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`

### 1. Desktop-App (Tauri v2) starten
```bash
npm install
npm run desktop
```

### 2. Alternativ: Web-UI + Rust HTTP-Server (`vault-cli`)
Terminal 1 (Rust Core API auf Port `3456`, optional mit `--token <SECRET>`):
```bash
cargo run -p vault-cli -- serve --vault ./demo-vault --port 3456
```
Terminal 2 (Vite Dev-Server):
```bash
npm run dev
```

### 3. CLI-Werkzeuge & 100.000-Blöcke-Benchmark
```bash
cargo run --release -p vault-cli -- bench-100k
cargo run -p vault-cli -- search ./demo-vault "tag:#architektur SQLite"
cargo run -p vault-cli -- tasks ./demo-vault
cargo run -p vault-cli -- graph ./demo-vault
```

---

## Wichtige Tastenkürzel

| Kürzel | Aktion |
| :--- | :--- |
| `Ctrl+K` / `Cmd+K` | Command Palette (`>` für Befehle, FTS5-Volltextsuche) |
| `Ctrl+S` / `Cmd+S` | Aktuelle Notiz sofort speichern |
| `Ctrl+F` | Im Dokument suchen & ersetzen |
| `Ctrl+Shift+N` | Quick Capture in die heutige Daily Note |
| `Ctrl+Shift+F` | Zen-Modus umschalten |
| `Alt+←` / `Alt+→` | In der Notiz-Historie vor/zurück navigieren |
| `Ctrl+/` | Tastenkürzel-Übersicht öffnen |
| `Tab` / `Shift+Tab` | Block im Outliner ein-/ausrücken |

---

## Tests & Weiterführendes
```bash
cargo test --workspace
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
npm test
```

- [Architektur-Spezifikation (ARCHITECTURE.md)](ARCHITECTURE.md)
- [Änderungsprotokoll (CHANGELOG.md)](CHANGELOG.md)
- [Lizenz (MIT)](LICENSE)
