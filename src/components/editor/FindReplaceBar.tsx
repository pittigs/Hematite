import type { RefObject } from "react";
import { ArrowDown, ArrowUp, Replace, Search, X } from "lucide-react";

interface FindReplaceBarProps {
  findInputRef: RefObject<HTMLInputElement | null>;
  findQuery: string;
  onFindQueryChange: (value: string) => void;
  replaceQuery: string;
  onReplaceQueryChange: (value: string) => void;
  caseSensitive: boolean;
  onToggleCaseSensitive: () => void;
  matchCount: number;
  activeMatchIdx: number;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  onReplaceCurrent: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function FindReplaceBar({
  findInputRef,
  findQuery,
  onFindQueryChange,
  replaceQuery,
  onReplaceQueryChange,
  caseSensitive,
  onToggleCaseSensitive,
  matchCount,
  activeMatchIdx,
  onPrevMatch,
  onNextMatch,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
}: FindReplaceBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/75 px-5 py-2 text-xs">
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1">
        <Search className="h-3.5 w-3.5 text-zinc-500" />
        <input
          ref={findInputRef}
          value={findQuery}
          onChange={(e) => onFindQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) {
                onPrevMatch();
              } else {
                onNextMatch();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Suchen..."
          className="w-40 bg-transparent text-xs text-zinc-100 placeholder-zinc-600 outline-none"
        />
        <button
          onClick={onToggleCaseSensitive}
          title="Groß-/Kleinschreibung beachten"
          className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold transition ${
            caseSensitive
              ? "bg-indigo-600 text-white"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          Aa
        </button>
      </div>

      <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-400">
        <span className="min-w-14 text-center">
          {matchCount === 0 ? "0 / 0" : `${activeMatchIdx + 1} / ${matchCount}`}
        </span>
        <button
          onClick={onPrevMatch}
          disabled={matchCount === 0}
          title="Vorheriger Treffer (Shift+Enter)"
          className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          onClick={onNextMatch}
          disabled={matchCount === 0}
          title="Nächster Treffer (Enter)"
          className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1">
        <Replace className="h-3.5 w-3.5 text-zinc-500" />
        <input
          value={replaceQuery}
          onChange={(e) => onReplaceQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Ersetzen durch..."
          className="w-40 bg-transparent text-xs text-zinc-100 placeholder-zinc-600 outline-none"
        />
      </div>

      <button
        onClick={onReplaceCurrent}
        disabled={!findQuery || matchCount === 0}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-40"
      >
        Ersetzen
      </button>
      <button
        onClick={onReplaceAll}
        disabled={!findQuery || matchCount === 0}
        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
      >
        Alle ersetzen
      </button>

      <button
        onClick={onClose}
        title="Suchleiste schließen (Esc)"
        className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
