import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  Command,
  CornerDownLeft,
  FileText,
  Search,
  Zap,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { DocumentSummary, SearchResponse } from "../types/vault";

export interface CommandPaletteAction {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  documents: DocumentSummary[];
  onSelectDocument: (docPath: string) => void;
  recentPaths?: string[];
  actions?: CommandPaletteAction[];
}

interface OperatorChip {
  label: string;
  insert: string;
  mode: "append" | "quote" | "action";
  title: string;
}

const OPERATOR_CHIPS: OperatorChip[] = [
  {
    label: "tag:#",
    insert: "tag:#",
    mode: "append",
    title: "Nach Tag filtern (z. B. tag:#rust)",
  },
  {
    label: "path:",
    insert: "path:",
    mode: "append",
    title: "Nach Dateipfad filtern (z. B. path:daily/)",
  },
  {
    label: "status:TODO",
    insert: "status:TODO",
    mode: "append",
    title: "Nach Aufgabenstatus filtern",
  },
  {
    label: '"..."',
    insert: '""',
    mode: "quote",
    title: "Exakte Phrasensuche in Anführungszeichen",
  },
  {
    label: "-ausschluss",
    insert: "-",
    mode: "append",
    title: "Begriff aus Ergebnissen ausschließen",
  },
  {
    label: "> Befehle",
    insert: "> ",
    mode: "action",
    title: "Befehlsmodus mit > aktivieren",
  },
];

export function CommandPalette({
  isOpen,
  onClose,
  documents,
  onSelectDocument,
  recentPaths,
  actions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [searchRes, setSearchRes] = useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isActionMode = query.trimStart().startsWith(">");
  const actionQuery = isActionMode
    ? query.trimStart().slice(1).trim().toLowerCase()
    : "";
  const trimmed = query.trim();

  const filteredActions = useMemo(() => {
    const list = actions ?? [];
    if (!isActionMode) return [];
    if (!actionQuery) return list;
    return list.filter(
      (action) =>
        action.label.toLowerCase().includes(actionQuery) ||
        (action.description?.toLowerCase().includes(actionQuery) ?? false) ||
        action.id.toLowerCase().includes(actionQuery),
    );
  }, [actions, isActionMode, actionQuery]);

  const recentDocs = useMemo(() => {
    if (!recentPaths || recentPaths.length === 0) return [];
    const byPath = new Map<string, DocumentSummary>();
    for (const doc of documents) {
      byPath.set(doc.path, doc);
    }
    const seen = new Set<string>();
    const resolved: DocumentSummary[] = [];
    for (const path of recentPaths) {
      if (seen.has(path)) continue;
      const found = byPath.get(path);
      if (found) {
        seen.add(path);
        resolved.push(found);
      }
    }
    return resolved;
  }, [documents, recentPaths]);

  const emptyNavDocs = useMemo(
    () => [...recentDocs, ...documents],
    [recentDocs, documents],
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSearchRes(null);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (isActionMode) {
      setSearchRes(null);
      setActiveIndex(0);
      return;
    }

    if (!trimmed) {
      setSearchRes(null);
      setActiveIndex(0);
      return;
    }

    let cancelled = false;
    vaultApi
      .searchVault(trimmed, 20)
      .then((res) => {
        if (!cancelled) {
          setSearchRes(res);
          setActiveIndex(0);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [trimmed, isActionMode, isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [actionQuery]);

  if (!isOpen) return null;

  const itemsCount = isActionMode
    ? filteredActions.length
    : trimmed
      ? (searchRes?.results.length ?? 0)
      : emptyNavDocs.length;

  const safeActiveIndex =
    itemsCount > 0 ? Math.min(activeIndex, itemsCount - 1) : 0;

  const applyOperatorChip = (chip: OperatorChip) => {
    let nextQuery: string;
    let cursorOffsetFromEnd = 0;

    if (chip.mode === "action") {
      nextQuery = chip.insert;
    } else {
      const base = isActionMode ? "" : query;
      const needsSpace = base.length > 0 && !/\s$/.test(base);
      nextQuery = `${base}${needsSpace ? " " : ""}${chip.insert}`;
      if (chip.mode === "quote") {
        cursorOffsetFromEnd = 1;
      }
    }

    setQuery(nextQuery);
    setActiveIndex(0);
    setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const pos = Math.max(0, nextQuery.length - cursorOffsetFromEnd);
      input.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (itemsCount > 0) {
        setActiveIndex((prev) => (prev + 1) % itemsCount);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (itemsCount > 0) {
        setActiveIndex((prev) => (prev - 1 + itemsCount) % itemsCount);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isActionMode) {
        const selected = filteredActions[safeActiveIndex];
        if (selected) {
          onClose();
          selected.run();
        }
      } else if (trimmed && searchRes && searchRes.results[safeActiveIndex]) {
        onSelectDocument(searchRes.results[safeActiveIndex].docPath);
        onClose();
      } else if (!trimmed && emptyNavDocs[safeActiveIndex]) {
        onSelectDocument(emptyNavDocs[safeActiveIndex].path);
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-20 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3.5">
          {isActionMode ? (
            <Command className="h-4.5 w-4.5 text-indigo-400" />
          ) : (
            <Search className="h-4.5 w-4.5 text-indigo-400" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suche in allen Blöcken via SQLite FTS5 oder tippe > für Befehle..."
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
          {!isActionMode && searchRes && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
              <Zap className="h-3 w-3" />
              {(searchRes.elapsedUs / 1000).toFixed(2)} ms ({searchRes.elapsedUs}{" "}
              µs)
            </span>
          )}
          {isActionMode && (
            <span className="shrink-0 rounded-full bg-indigo-500/20 px-2.5 py-0.5 font-mono text-[11px] text-indigo-300">
              Befehle ({filteredActions.length})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800/80 bg-zinc-950/40 px-4 py-2">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Filter:
          </span>
          {OPERATOR_CHIPS.map((chip) => {
            const highlighted = chip.mode === "action" && isActionMode;
            return (
              <button
                key={chip.label}
                type="button"
                title={chip.title}
                onClick={() => applyOperatorChip(chip)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition ${
                  highlighted
                    ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                    : "border-zinc-700/80 bg-zinc-800/70 text-zinc-300 hover:border-indigo-500/50 hover:bg-indigo-500/15 hover:text-indigo-300"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {isActionMode ? (
            filteredActions.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                Keine Befehle für „{actionQuery || ">"}“ gefunden.
              </div>
            ) : (
              <>
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Befehle ({filteredActions.length})
                </div>
                {filteredActions.map((action, idx) => {
                  const isActive = idx === safeActiveIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        onClose();
                        action.run();
                      }}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        isActive
                          ? "bg-indigo-500/20 text-zinc-100"
                          : "text-zinc-300 hover:bg-zinc-800/70"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Command className="h-4 w-4 shrink-0 text-indigo-400" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {action.label}
                          </div>
                          {action.description && (
                            <div className="truncate text-[11px] text-zinc-500">
                              {action.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {action.shortcut && (
                          <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                            {action.shortcut}
                          </kbd>
                        )}
                        {isActive && (
                          <CornerDownLeft className="h-3.5 w-3.5 text-indigo-400" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </>
            )
          ) : !trimmed ? (
            <>
              {recentDocs.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Clock className="h-3 w-3" />
                    Zuletzt geöffnet ({recentDocs.length})
                  </div>
                  {recentDocs.map((doc, idx) => {
                    const isActive = idx === safeActiveIndex;
                    return (
                      <button
                        key={`recent-${doc.id}`}
                        type="button"
                        onClick={() => {
                          onSelectDocument(doc.path);
                          onClose();
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition ${
                          isActive
                            ? "bg-indigo-500/20 text-zinc-100"
                            : "text-zinc-300 hover:bg-zinc-800/70"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Clock className="h-4 w-4 shrink-0 text-indigo-400" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {doc.title}
                            </div>
                            <div className="truncate text-[11px] text-zinc-500">
                              {doc.path}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500">
                          <span>{doc.blockCount} Blöcke</span>
                          {isActive && (
                            <CornerDownLeft className="h-3.5 w-3.5 text-indigo-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              <div className="mt-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Notizen im Vault ({documents.length})
              </div>
              {documents.map((doc, idx) => {
                const flatIndex = recentDocs.length + idx;
                const isActive = flatIndex === safeActiveIndex;
                return (
                  <button
                    key={`vault-${doc.id}`}
                    type="button"
                    onClick={() => {
                      onSelectDocument(doc.path);
                      onClose();
                    }}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition ${
                      isActive
                        ? "bg-indigo-500/20 text-zinc-100"
                        : "text-zinc-300 hover:bg-zinc-800/70"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {doc.title}
                        </div>
                        <div className="truncate text-[11px] text-zinc-500">
                          {doc.path}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500">
                      <span>{doc.blockCount} Blöcke</span>
                      {isActive && (
                        <CornerDownLeft className="h-3.5 w-3.5 text-indigo-400" />
                      )}
                    </div>
                  </button>
                );
              })}
            </>
          ) : searchRes && searchRes.results.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              Keine Block-Treffer für „{trimmed}“ gefunden.
            </div>
          ) : (
            searchRes?.results.map((hit, idx) => {
              const isActive = idx === safeActiveIndex;
              return (
                <button
                  key={`${hit.blockId}-${idx}`}
                  type="button"
                  onClick={() => {
                    onSelectDocument(hit.docPath);
                    onClose();
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition ${
                    isActive
                      ? "bg-indigo-500/20 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{hit.docTitle}</span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        (({hit.blockId}))
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-500">
                      BM25 {hit.bm25Score.toFixed(2)}
                    </span>
                  </div>
                  <div
                    className="text-xs leading-relaxed text-zinc-300"
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                  />
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[11px] text-zinc-500">
          <span>
            {isActionMode
              ? "Befehlsmodus • Aktion auswählen"
              : "SQLite FTS5 Volltextsuche mit BM25-Ranking"}
          </span>
          <span>
            ↑↓ Navigieren • Enter {isActionMode ? "Ausführen" : "Öffnen"} • Esc
            Schließen
          </span>
        </div>
      </div>
    </div>
  );
}
