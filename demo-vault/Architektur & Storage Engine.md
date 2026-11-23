---
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
