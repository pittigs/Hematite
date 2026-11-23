---
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
