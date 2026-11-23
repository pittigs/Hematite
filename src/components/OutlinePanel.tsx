import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  ListTree,
  Type,
  X,
} from "lucide-react";
import type { Block } from "../types/vault";
import {
  computeDocumentStats,
  stripExplicitBlockIds,
} from "../utils/markdownRich";

export interface OutlinePanelProps {
  blocks: Block[];
  activeBlockId?: string | null;
  onJumpToBlock: (blockId: string) => void;
  onClose?: () => void;
}

export function OutlinePanel({
  blocks,
  activeBlockId,
  onJumpToBlock,
  onClose,
}: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const stats = useMemo(() => computeDocumentStats(blocks), [blocks]);

  const headings = useMemo(
    () =>
      blocks.filter(
        (b) =>
          b.blockType === "heading" &&
          (b.headingLevel === 1 || b.headingLevel === 2 || b.headingLevel === 3),
      ),
    [blocks],
  );

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-zinc-800/80 bg-zinc-950/90 py-3">
        <button
          onClick={() => setCollapsed(false)}
          title="Gliederung ausklappen"
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-indigo-300"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="mt-4 flex flex-col items-center gap-3 text-[10px] font-mono text-zinc-500">
          <ListTree className="h-3.5 w-3.5 text-indigo-400" />
          <span title={`${stats.words} Wörter`}>{stats.words}w</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-zinc-800/80 bg-zinc-950/95">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <ListTree className="h-3.5 w-3.5 text-indigo-400" />
          <span>Gliederung</span>
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {headings.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(true)}
            title="Gliederung einklappen"
            className="rounded p-1 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Gliederung schließen"
              className="rounded p-1 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Document Stats */}
      <div className="grid grid-cols-3 gap-1.5 border-b border-zinc-800/70 p-3">
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <FileText className="h-2.5 w-2.5 text-indigo-400" />
            Wörter
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">
            {stats.words}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Type className="h-2.5 w-2.5 text-sky-400" />
            Zeichen
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">
            {stats.chars}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Clock className="h-2.5 w-2.5 text-emerald-400" />
            Lesezeit
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">
            {stats.readingMinutes === 0 ? "0m" : `${stats.readingMinutes}m`}
          </div>
        </div>
      </div>

      {/* Headings TOC */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {headings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-3 text-center text-[11px] text-zinc-500">
            Keine Überschriften (H1–H3) im Dokument.
          </div>
        ) : (
          <nav className="space-y-0.5" aria-label="Dokument-Gliederung">
            {headings.map((h) => {
              const level = h.headingLevel ?? 1;
              const indentClass =
                level === 1 ? "pl-2" : level === 2 ? "pl-5" : "pl-8";
              const label =
                stripExplicitBlockIds(h.rawContent || h.plainText).trim() ||
                "(Leere Überschrift)";
              const isActive = activeBlockId === h.id;

              return (
                <button
                  key={h.id}
                  onClick={() => onJumpToBlock(h.id)}
                  title={label}
                  className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs transition ${indentClass} ${
                    isActive
                      ? "bg-indigo-500/15 font-medium text-indigo-200"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  }`}
                >
                  <span className="shrink-0 rounded bg-zinc-900 px-1 py-0.5 font-mono text-[9px] text-zinc-500">
                    H{level}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
