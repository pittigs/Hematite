---
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
  scheduled:: 2026-11-17
- [ ] Öffne [[daily/2026-11-17|heutige Daily Note]] und verknüpfe neue Gedanken
  priority:: 2
- [x] Rust-Kern (`vault-core`) mit BLAKE3 & SQLite WAL initialisieren
  priority:: 1
