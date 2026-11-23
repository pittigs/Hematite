import {
  CheckSquare,
  Code2,
  Heading1,
  List,
  Minus,
  Quote,
  Sparkles,
} from "lucide-react";
import type { DocumentSummary } from "../../types/vault";
import type {
  AutocompleteMenuState,
  BlockRefCandidate,
  SlashOption,
} from "./editorHelpers";

interface AutocompleteMenuProps {
  menu: AutocompleteMenuState;
  menuIndex: number;
  onSelectIndex: (index: number) => void;
  slashOptions: SlashOption[];
  wikiDocs: DocumentSummary[];
  blockRefs: BlockRefCandidate[];
  onApplySlash: (opt: SlashOption) => void;
  onApplyWiki: (doc: DocumentSummary) => void;
  onApplyBlockRef: (candidate: BlockRefCandidate) => void;
}

export function AutocompleteMenu({
  menu,
  menuIndex,
  onSelectIndex,
  slashOptions,
  wikiDocs,
  blockRefs,
  onApplySlash,
  onApplyWiki,
  onApplyBlockRef,
}: AutocompleteMenuProps) {
  if (menu.kind === "slash") {
    return (
      <div className="mt-1.5 rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
        <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] uppercase text-zinc-500">
          <span>
            Blocktyp wählen {menu.query ? `• Filter: /${menu.query}` : ""}
          </span>
          <span className="font-mono">↑↓ Enter Esc</span>
        </div>
        {slashOptions.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-zinc-500">
            Kein passender Blocktyp für „/{menu.query}“.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {slashOptions.map((opt, optIdx) => {
              const selected = optIdx === menuIndex;
              return (
                <button
                  key={opt.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => onSelectIndex(optIdx)}
                  onClick={() => onApplySlash(opt)}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                    selected
                      ? "bg-indigo-600/35 text-white ring-1 ring-indigo-500/50"
                      : "text-zinc-200 hover:bg-zinc-800"
                  }`}
                >
                  {opt.type === "heading" ? (
                    <Heading1 className="h-3.5 w-3.5 text-indigo-400" />
                  ) : opt.type === "taskItem" ? (
                    <CheckSquare className="h-3.5 w-3.5 text-emerald-400" />
                  ) : opt.type === "listItem" ? (
                    <List className="h-3.5 w-3.5 text-sky-400" />
                  ) : opt.type === "codeBlock" ? (
                    <Code2 className="h-3.5 w-3.5 text-amber-400" />
                  ) : opt.type === "quote" ? (
                    <Quote className="h-3.5 w-3.5 text-zinc-400" />
                  ) : opt.type === "divider" ? (
                    <Minus className="h-3.5 w-3.5 text-zinc-500" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                  )}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (menu.kind === "wiki") {
    return (
      <div className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
        <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase text-zinc-500">
          <span>
            Wiki-Link einfügen {menu.query ? `• Filter: ${menu.query}` : ""}
          </span>
          <span className="font-mono">↑↓ Enter Esc</span>
        </div>
        {wikiDocs.length === 0 ? (
          <div className="px-2.5 py-1.5 text-xs text-zinc-500">
            Keine passende Notiz gefunden.
          </div>
        ) : (
          wikiDocs.map((d, dIdx) => {
            const selected = dIdx === menuIndex;
            return (
              <button
                key={d.id}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onSelectIndex(dIdx)}
                onClick={() => onApplyWiki(d)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  selected
                    ? "bg-indigo-600/35 text-white ring-1 ring-indigo-500/50"
                    : "text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                <span className="truncate font-medium">{d.title}</span>
                <span className="ml-2 shrink-0 text-[10px] text-zinc-500">
                  {d.path}
                </span>
              </button>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase text-zinc-500">
        <span>
          Block-Referenz einfügen {menu.query ? `• Filter: ${menu.query}` : ""}
        </span>
        <span className="font-mono">↑↓ Enter Esc</span>
      </div>
      {blockRefs.length === 0 ? (
        <div className="px-2.5 py-1.5 text-xs text-zinc-500">
          Kein passender Block gefunden.
        </div>
      ) : (
        blockRefs.map((cand, cIdx) => {
          const selected = cIdx === menuIndex;
          return (
            <button
              key={`${cand.blockId}-${cIdx}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onSelectIndex(cIdx)}
              onClick={() => onApplyBlockRef(cand)}
              className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                selected
                  ? "bg-amber-500/25 text-white ring-1 ring-amber-400/50"
                  : "text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-amber-300">
                  (({cand.blockId}))
                </span>
                <span className="truncate text-[10px] text-zinc-500">
                  {cand.isLocal ? "Dieses Dokument" : cand.docTitle}
                </span>
              </div>
              <span className="line-clamp-1 text-[11px] text-zinc-300">
                {cand.preview}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
