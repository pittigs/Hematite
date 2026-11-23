import { useEffect, useState } from "react";
import { FileText, RotateCcw, Trash2, X } from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { DocumentWithBlocks, TrashItem } from "../types/vault";

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored: (doc: DocumentWithBlocks) => Promise<void>;
  onChanged: () => Promise<void>;
}

function formatDeletedAt(ts: number): string {
  if (!ts) return "Unbekannt";
  const ms = ts > 1_000_000_000_000 ? ts : ts * 1000;
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKb(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function TrashModal({
  isOpen,
  onClose,
  onRestored,
  onChanged,
}: TrashModalProps) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    vaultApi
      .listTrash()
      .then((list) => {
        if (!cancelled) {
          setItems(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRestore = async (item: TrashItem) => {
    setRestoringId(item.trashId);
    setError(null);
    try {
      const doc = await vaultApi.restoreTrashItem(item.trashId);
      await onRestored(doc);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setRestoringId(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (items.length === 0) return;
    const confirmed = window.confirm(
      `Papierkorb wirklich endgültig leeren? ${items.length} gelöschte Notiz(en) werden unwiderruflich entfernt.`,
    );
    if (!confirmed) return;

    setEmptying(true);
    setError(null);
    try {
      await vaultApi.emptyTrash();
      setItems([]);
      await onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Trash2 className="h-4.5 w-4.5 text-red-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Papierkorb
              </h2>
              <p className="text-[11px] text-zinc-500">
                {items.length}{" "}
                {items.length === 1 ? "gelöschtes Dokument" : "gelöschte Dokumente"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEmptyTrash}
              disabled={items.length === 0 || emptying || restoringId !== null}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {emptying ? "Leere..." : "Papierkorb leeren"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Schließen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              Lade Papierkorb...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Trash2 className="h-8 w-8 text-zinc-700" />
              <div className="text-sm font-medium text-zinc-300">
                Der Papierkorb ist leer
              </div>
              <p className="text-xs text-zinc-500">
                Gelöschte Notizen werden hier zwischengespeichert und können
                jederzeit wiederhergestellt werden.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((item) => {
                const isRestoring = restoringId === item.trashId;
                return (
                  <div
                    key={item.trashId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-100">
                          {item.title}
                        </div>
                        <div className="truncate font-mono text-[11px] text-zinc-500">
                          {item.originalPath}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                          <span>Gelöscht: {formatDeletedAt(item.deletedAt)}</span>
                          <span className="font-mono">
                            {formatKb(item.sizeBytes)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRestore(item)}
                      disabled={restoringId !== null || emptying}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {isRestoring ? "Stelle wieder her..." : "Wiederherstellen"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-5 py-2.5 text-[11px] text-zinc-500">
          <span>Wiederhergestellte Dokumente werden automatisch neu indexiert</span>
          <span>Esc Schließen</span>
        </div>
      </div>
    </div>
  );
}
