---
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
