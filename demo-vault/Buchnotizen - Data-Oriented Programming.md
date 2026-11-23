---
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
