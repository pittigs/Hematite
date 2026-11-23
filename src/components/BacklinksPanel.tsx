import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Hash,
  Link2,
  Loader2,
  Sparkles,
  Unlink,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { BacklinkItem, UnlinkedMention } from "../types/vault";

interface BacklinksPanelProps {
  backlinks: BacklinkItem[];
  onNavigate: (docPath: string) => void;
  docId?: string;
  docTitle?: string;
  onMentionLinked?: () => Promise<void>;
}

export function BacklinksPanel({
  backlinks,
  onNavigate,
  docId,
  docTitle,
  onMentionLinked,
}: BacklinksPanelProps) {
  const [unlinkedMentions, setUnlinkedMentions] = useState<UnlinkedMention[]>(
    [],
  );
  const [loadingMentions, setLoadingMentions] = useState(false);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [mentionError, setMentionError] = useState<string | null>(null);

  const fetchMentions = useCallback(async () => {
    if (!docId) {
      setUnlinkedMentions([]);
      return;
    }
    setLoadingMentions(true);
    setMentionError(null);
    try {
      const items = await vaultApi.getUnlinkedMentions(docId);
      setUnlinkedMentions(items);
    } catch {
      setUnlinkedMentions([]);
    } finally {
      setLoadingMentions(false);
    }
  }, [docId]);

  useEffect(() => {
    void fetchMentions();
  }, [fetchMentions, backlinks]);

  const handleLinkMention = async (item: UnlinkedMention, key: string) => {
    setLinkingKey(key);
    setMentionError(null);
    try {
      await vaultApi.linkUnlinkedMention(
        item.sourceDocPath,
        item.sourceBlockId,
        item.matchedTerm,
        docTitle || item.matchedTerm,
      );
      await fetchMentions();
      await onMentionLinked?.();
    } catch (err) {
      setMentionError(
        err instanceof Error
          ? err.message
          : "Erwähnung konnte nicht verlinkt werden.",
      );
    } finally {
      setLinkingKey(null);
    }
  };

  return (
    <section className="mt-10 space-y-8 border-t border-zinc-800/80 pt-6">
      {/* Linked Backlinks */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Link2 className="h-3.5 w-3.5 text-indigo-400" />
            <span>Eingehende Verknüpfungen (Backlinks)</span>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
              {backlinks.length}
            </span>
          </div>
        </div>

        {backlinks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
            Noch keine anderen Notizen verweisen per{" "}
            <code className="text-zinc-300">[[Wiki-Link]]</code> oder{" "}
            <code className="text-zinc-300">((Block-Ref))</code> auf dieses
            Dokument.
          </div>
        ) : (
          <div className="grid gap-2.5">
            {backlinks.map((item, idx) => (
              <button
                key={`${item.sourceBlockId}-${idx}`}
                onClick={() => onNavigate(item.sourceDocPath)}
                className="group flex flex-col gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 text-left transition hover:border-indigo-500/50 hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-indigo-300">
                    {item.linkType === "blockRef" ? (
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    ) : item.linkType === "tag" ? (
                      <Hash className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5 text-indigo-400" />
                    )}
                    <span>{item.sourceDocTitle}</span>
                    <span className="text-[11px] text-zinc-500">
                      {item.sourceDocPath}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 group-hover:text-indigo-300">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
                      {item.linkType}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </div>
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-zinc-300">
                  {item.sourcePlainText || "(Leerer Block)"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Unlinked Mentions */}
      {docId && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Unlink className="h-3.5 w-3.5 text-amber-400" />
              <span>Unverlinkte Erwähnungen</span>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                {unlinkedMentions.length}
              </span>
            </div>
            {loadingMentions && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
            )}
          </div>

          {mentionError && (
            <div className="mb-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {mentionError}
            </div>
          )}

          {unlinkedMentions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
              Keine unverlinkten Erwähnungen in anderen Notizen gefunden.
            </div>
          ) : (
            <div className="grid gap-2.5">
              {unlinkedMentions.map((item, idx) => {
                const key = `${item.sourceBlockId}-${item.matchedTerm}-${idx}`;
                const isLinking = linkingKey === key;
                return (
                  <div
                    key={key}
                    className="flex flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 transition hover:border-amber-500/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        onClick={() => onNavigate(item.sourceDocPath)}
                        className="flex items-center gap-2 text-left text-xs font-medium text-amber-300 hover:underline"
                      >
                        <span>{item.sourceDocTitle}</span>
                        <span className="text-[11px] text-zinc-500">
                          {item.sourceDocPath}
                        </span>
                      </button>

                      <div className="flex items-center gap-2">
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                          „{item.matchedTerm}“
                        </span>
                        <button
                          onClick={() => void handleLinkMention(item, key)}
                          disabled={isLinking}
                          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                        >
                          {isLinking ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Link2 className="h-3 w-3" />
                          )}
                          Verlinken
                        </button>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-zinc-300">
                      {item.sourcePlainText || "(Leerer Block)"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
