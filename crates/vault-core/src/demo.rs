use crate::canvas::save_canvas;
use crate::model::{CanvasData, CanvasEdge, CanvasNode, SyncOperationKind};
use crate::sync::CrdtSyncEngine;
use anyhow::Result;
use chrono::Local;
use std::fs;
use std::path::Path;

/// Populates a vault directory with interconnected notes, tasks, structured properties,
/// a daily note, an infinite canvas, and an initial `.sync/` CRDT oplog.
pub fn seed_demo_vault(vault_path: &Path) -> Result<()> {
    fs::create_dir_all(vault_path.join("daily"))?;
    fs::create_dir_all(vault_path.join("canvas"))?;
    fs::create_dir_all(vault_path.join(".sync"))?;

    let today = Local::now().format("%Y-%m-%d").to_string();

    let welcome = format!(
        r#"---
tags: [guide, oxidevault]
status: active
priority: 1
---

# Willkommen in OxideVault

OxideVault kombiniert die Freiheit von [[Architektur & Storage Engine|Markdown-Dokumenten]] (wie Obsidian) mit feingranularen, adressierbaren Blöcken (wie Logseq) – angetrieben durch einen nativen Rust-Kern. ^blk-welcome

> [!TIP] Hybrid-Editor & Lazy Block-IDs
> Jeder Absatz ist intern über einen deterministischen Hash adressierbar. Erst wenn du einen Block gezielt per `((id))` referenzierst, schreibt OxideVault dezent `^id` in die `.md`-Datei – normale Texte bleiben 100 % sauber.

## Live Block-Transklusionen in Aktion

Hier wird direkt ein Block aus [[Architektur & Storage Engine]] eingebettet:

((blk-sqlite-perf))

Und hier der zentrale Sync-Grundsatz aus [[CRDT Google Drive Sync]]:

((blk-crdt-core))

## Schnelleinstieg & Aufgaben

- [ ] Probiere `Ctrl+K` (oder `Cmd+K`) für die FTS5-Volltextsuche im Sub-Millisekundenbereich
  priority:: 1
  scheduled:: {today}
- [ ] Öffne [[daily/{today}|heutige Daily Note]] und verknüpfe neue Gedanken
  priority:: 2
- [x] Rust-Kern (`vault-core`) mit BLAKE3 & SQLite WAL initialisieren
  priority:: 1
"#,
        today = today
    );

    let arch = r#"---
tags: [projekt, rust, architektur]
status: active
priority: 1
owner: Core Engine
quarter: Q4-2026
---

# Architektur & Storage Engine

OxideVault trennt strikt zwischen dem portablen Cloud-Vault (`.md` + `.sync/*.oplog`) und dem lokalen Hochgeschwindigkeits-Index (`index.sqlite` außerhalb des Cloud-Ordners).

## Warum SQLite (In-Process) statt MariaDB?

SQLite läuft via `rusqlite` direkt im selben Arbeitsspeicher wie Rust (WAL-Modus, 256 MB `mmap`, FTS5-Volltextsuche und binäres `JSONB`). Dadurch entfallen Server-Daemons, TCP-Sockets und IPC-Latenzen komplett (~0,005 ms pro Lookup). ^blk-sqlite-perf

- Inkrementelles Delta-Hashing über `blake3` + `rayon` über alle CPU-Kerne
  - Überspringt unveränderte Dateien beim Start komplett
  - Aktualisiert geänderte Dokumente atomar in einer SQLite-Transaktion
- Graph-Engine auf Basis von `petgraph` + `rayon` berechnet Cluster & Force-Directed Layouts parallel im Backend
- Siehe auch [[CRDT Google Drive Sync]] für die konfliktfreie Cloud-Persistenz

## Offene Engine-Tasks

- [/] Force-Directed Layout und Shortest-Path-Suche im [[Willkommen in OxideVault|Graph]] feintunen
  priority:: 1
  deadline:: 2026-11-24
- [ ] Benchmarking mit 100.000 Blöcken in 5.000 Dateien automatisieren
  priority:: 2
  scheduled:: 2026-11-18
"#;

    let sync_doc = r#"---
tags: [projekt, sync, architektur]
status: active
priority: 1
owner: Sync Engine
---

# CRDT Google Drive Sync

> [!IMPORTANT] Nie wieder `Konfliktkopie.sqlite`
> Da jede SQLite-Datenbank strikt lokal auf der SSD liegt und im Google Drive nur lesbare `.md`-Dateien sowie unveränderliche `.sync/<device_id>_<seq>.oplog` Append-Only-Logs gespeichert werden, kann Google Drive niemals eine Datenbank korrumpieren. ^blk-crdt-core

## Wie der Merge bei Offline-Edits funktioniert

- Gerät A (`laptop-a`) schreibt seine Operationen ausschließlich in `.sync/laptop-a_*.oplog`
- Gerät B (`desktop-b`) schreibt seine Operationen ausschließlich in `.sync/desktop-b_*.oplog`
- Beim Sync führt Rust die Operationen deterministisch über Hybrid Logical Clocks (HLC) und einen wortweisen 3-Way-CRDT-Merger zusammen

Verbunden mit [[Architektur & Storage Engine]] und [[Roadmap & Meilensteine]].

- [ ] Simuliere einen 2-Geräte-Offline-Sync über den Sync-Button in der Topbar
  priority:: 1
  scheduled:: 2026-11-17
"#;

    let book_rust = r#"---
tags: [buch, rust]
author: Tim McNamara
rating: 5
status: reading
category: Systems Programming
---

# Buchnotizen - Rust in Action

Zentrale Erkenntnisse für [[Architektur & Storage Engine]] und speichereffiziente Datenstrukturen in Rust:

- Zero-Copy Slices (`&str`) beim Parsen minimieren Heap-Allokationen
- Memory-Mapped Files und kompakte Binärformate senken den RAM-Verbrauch unter 40 MB
- Klare Ownership-Grenzen erlauben angstfreie Parallelisierung mit `rayon`

- [x] Kapitel über Memory, Lifetimes & System-Programmierung durcharbeiten
  priority:: 2
"#;

    let book_dop = r#"---
tags: [buch, architektur]
author: Yehonathan Sharvit
rating: 5
status: done
category: Software Design
---

# Buchnotizen - Data-Oriented Programming

Kernprinzipien, die direkt in `vault-core::model` eingeflossen sind:

- **Prinzip 1:** Code (Logik in `parser.rs`, `db.rs`, `graph.rs`) strikt von Daten (`model.rs`) trennen
- **Prinzip 2:** Generische, serialisierbare Datenstrukturen (`Document`, `Block`, `Properties`) für Tauri IPC & JSON nutzen
- **Prinzip 3:** Unveränderliche Snapshots zwischen Backend und React-UI austauschen

Verknüpft mit [[Willkommen in OxideVault]] und [[Buchnotizen - Rust in Action]].
"#;

    let roadmap = r#"---
tags: [projekt, roadmap]
status: planning
priority: 2
owner: Product
quarter: Q1-2027
---

# Roadmap & Meilensteine

Geplante Ausbaustufen über das MVP hinaus:

- [ ] Optionale P2P-Live-Kollaboration via `iroh` (QUIC) auf Basis der bestehenden `.sync/` CRDT-Ops
  priority:: 2
  deadline:: 2026-12-15
- [ ] Lokale semantische Vektorsuche (Embeddings direkt in Rust via `candle` / `ort`)
  priority:: 3
  deadline:: 2027-01-20
- [ ] Plugin-System mit WebAssembly-Sandbox (`wasmtime`) für sichere Community-Erweiterungen
  priority:: 3
"#;

    let daily_note = format!(
        r#"---
tags: [daily]
date: {today}
---

# Daily Note – {today}

## Fokus für heute

- [ ] [[Architektur & Storage Engine]] und 100.000-Blöcke-Benchmark prüfen
  priority:: 1
  scheduled:: {today}
  deadline:: {today}
- [/] Hybrid-Editor mit Block-Transklusionen `((blk-sqlite-perf))` testen
  priority:: 2
  scheduled:: {today}
- [ ] [[CRDT Google Drive Sync]] mit 2-Geräte-Simulation verifizieren
  priority:: 1
  scheduled:: {today}

## Journal & Notizen

- Heute das Dual-Layer-Design fertiggestellt: Cloud-sichere `.md` + `.sync/*.oplog` Dateien kombiniert mit lokalem SQLite-WAL-Index.
- Siehe auch [[Buchnotizen - Data-Oriented Programming]] für die Trennung von Daten und Engine.
"#,
        today = today
    );

    write_if_missing(&vault_path.join("Willkommen in OxideVault.md"), &welcome)?;
    write_if_missing(&vault_path.join("Architektur & Storage Engine.md"), arch)?;
    write_if_missing(&vault_path.join("CRDT Google Drive Sync.md"), sync_doc)?;
    write_if_missing(&vault_path.join("Buchnotizen - Rust in Action.md"), book_rust)?;
    write_if_missing(
        &vault_path.join("Buchnotizen - Data-Oriented Programming.md"),
        book_dop,
    )?;
    write_if_missing(&vault_path.join("Roadmap & Meilensteine.md"), roadmap)?;
    write_if_missing(
        &vault_path.join(format!("daily/{}.md", today)),
        &daily_note,
    )?;

    let canvas_path = "canvas/System-Architektur.canvas";
    if !vault_path.join(canvas_path).exists() {
        let canvas = CanvasData {
            path: canvas_path.to_string(),
            nodes: vec![
                CanvasNode {
                    id: "node-vault".to_string(),
                    node_type: "doc_embed".to_string(),
                    x: 80.0,
                    y: 90.0,
                    width: 280.0,
                    height: 150.0,
                    title: Some("Willkommen in OxideVault".to_string()),
                    text: Some("Hybrid-Dokumente + adressierbare Blöcke in Rust & Tauri v2".to_string()),
                    ref_doc_path: Some("Willkommen in OxideVault.md".to_string()),
                    ref_block_id: None,
                    color: Some("indigo".to_string()),
                },
                CanvasNode {
                    id: "node-sqlite".to_string(),
                    node_type: "block_embed".to_string(),
                    x: 440.0,
                    y: 60.0,
                    width: 310.0,
                    height: 165.0,
                    title: Some("SQLite WAL + FTS5 Core".to_string()),
                    text: None,
                    ref_doc_path: Some("Architektur & Storage Engine.md".to_string()),
                    ref_block_id: Some("blk-sqlite-perf".to_string()),
                    color: Some("emerald".to_string()),
                },
                CanvasNode {
                    id: "node-crdt".to_string(),
                    node_type: "block_embed".to_string(),
                    x: 440.0,
                    y: 280.0,
                    width: 310.0,
                    height: 165.0,
                    title: Some("Google-Drive CRDT Sync".to_string()),
                    text: None,
                    ref_doc_path: Some("CRDT Google Drive Sync.md".to_string()),
                    ref_block_id: Some("blk-crdt-core".to_string()),
                    color: Some("amber".to_string()),
                },
                CanvasNode {
                    id: "node-ui".to_string(),
                    node_type: "text".to_string(),
                    x: 840.0,
                    y: 170.0,
                    width: 260.0,
                    height: 140.0,
                    title: Some("Tauri v2 + React 19 UI".to_string()),
                    text: Some("Sub-Millisekunden IPC, 60fps Graph-Rendering, Table & Kanban Database Views".to_string()),
                    ref_doc_path: None,
                    ref_block_id: None,
                    color: Some("cyan".to_string()),
                },
            ],
            edges: vec![
                CanvasEdge {
                    id: "edge-1".to_string(),
                    from_node: "node-vault".to_string(),
                    to_node: "node-sqlite".to_string(),
                    from_side: Some("right".to_string()),
                    to_side: Some("left".to_string()),
                    label: Some("BLAKE3 Index".to_string()),
                    color: Some("emerald".to_string()),
                },
                CanvasEdge {
                    id: "edge-2".to_string(),
                    from_node: "node-vault".to_string(),
                    to_node: "node-crdt".to_string(),
                    from_side: Some("right".to_string()),
                    to_side: Some("left".to_string()),
                    label: Some("Append-Only Oplog".to_string()),
                    color: Some("amber".to_string()),
                },
                CanvasEdge {
                    id: "edge-3".to_string(),
                    from_node: "node-sqlite".to_string(),
                    to_node: "node-ui".to_string(),
                    from_side: Some("right".to_string()),
                    to_side: Some("left".to_string()),
                    label: Some("< 1ms Queries".to_string()),
                    color: Some("cyan".to_string()),
                },
            ],
        };
        save_canvas(vault_path, &canvas)?;
    }

    // Ensure initial CRDT oplog exists in .sync/
    let oplog_dir = vault_path.join(".sync");
    let has_oplog = fs::read_dir(&oplog_dir)?
        .filter_map(|e| e.ok())
        .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("oplog"));
    if !has_oplog {
        let mut sync = CrdtSyncEngine::new("primary-workstation");
        sync.append_op(
            vault_path,
            "Willkommen in OxideVault.md",
            "blk-welcome",
            SyncOperationKind::UpsertBlock,
            serde_json::json!({ "note": "Initialer Vault-Snapshot" }),
        )?;
    }

    Ok(())
}

fn write_if_missing(path: &Path, content: &str) -> Result<()> {
    if !path.exists() {
        fs::write(path, content)?;
    }
    Ok(())
}
