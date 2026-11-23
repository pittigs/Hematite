import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  FileDiff,
  History,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { DocumentSnapshot, DocumentWithBlocks } from "../types/vault";

export interface HistoryModalProps {
  isOpen: boolean;
  docPath: string;
  currentMarkdown: string;
  onClose: () => void;
  onRestored: (doc: DocumentWithBlocks) => Promise<void>;
}

function formatSnapshotDate(ts: number): string {
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n/g, "\n").split("\n").length;
}

export function HistoryModal({
  isOpen,
  docPath,
  currentMarkdown,
  onClose,
  onRestored,
}: HistoryModalProps) {
  const [snapshots, setSnapshots] = useState<DocumentSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    vaultApi
      .listSnapshots(docPath)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort(
          (a, b) => b.createdAt - a.createdAt || b.id - a.id,
        );
        setSnapshots(sorted);
        setSelectedId(sorted[0]?.id ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Snapshots konnten nicht geladen werden.",
        );
        setSnapshots([]);
        setSelectedId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, docPath]);

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

  const selectedSnapshot = useMemo(
    () => snapshots.find((s) => s.id === selectedId) ?? null,
    [snapshots, selectedId],
  );

  const lineStats = useMemo(() => {
    const currentLines = countLines(currentMarkdown);
    if (!selectedSnapshot) {
      return { currentLines, snapshotLines: 0, delta: 0, identical: false };
    }
    const snapshotLines = countLines(selectedSnapshot.content);
    const delta = snapshotLines - currentLines;
    const identical = selectedSnapshot.content === currentMarkdown;
    return { currentLines, snapshotLines, delta, identical };
  }, [currentMarkdown, selectedSnapshot]);

  const handleRestore = async () => {
    if (!selectedSnapshot || restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const restored = await vaultApi.restoreSnapshot(selectedSnapshot.id);
      await onRestored(restored);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Wiederherstellen fehlgeschlagen.",
      );
    } finally {
      setRestoring(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
              <History className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100">
                Versionsverlauf (Snapshots)
              </h2>
              <p className="truncate font-mono text-[11px] text-zinc-500">
                {docPath}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Schließen (Esc)"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Snapshot List */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-zinc-800/80 p-3">
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <span>Gespeicherte Stände</span>
              <span>{snapshots.length}</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                Lade Snapshots...
              </div>
            ) : snapshots.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center text-xs text-zinc-500">
                Noch keine Snapshots für dieses Dokument vorhanden.
              </div>
            ) : (
              <div className="space-y-1.5">
                {snapshots.map((snap) => {
                  const active = snap.id === selectedId;
                  return (
                    <button
                      key={snap.id}
                      onClick={() => setSelectedId(snap.id)}
                      className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition ${
                        active
                          ? "border-indigo-500/50 bg-indigo-500/15 text-zinc-100"
                          : "border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <Clock className="h-3 w-3 shrink-0 text-indigo-400" />
                        <span className="truncate">
                          {formatSnapshotDate(snap.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
                        <span>{formatBytes(snap.byteLen)}</span>
                        <span>#{snap.blake3Hash.slice(0, 10)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Snapshot Preview */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {selectedSnapshot ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                    <FileDiff className="h-3.5 w-3.5 text-indigo-400" />
                    <span>
                      Snapshot:{" "}
                      <strong className="font-mono text-zinc-100">
                        {lineStats.snapshotLines} Zeilen
                      </strong>
                    </span>
                    <span className="text-zinc-600">vs.</span>
                    <span>
                      Aktuell:{" "}
                      <strong className="font-mono text-zinc-100">
                        {lineStats.currentLines} Zeilen
                      </strong>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                        lineStats.delta > 0
                          ? "bg-emerald-500/15 text-emerald-300"
                          : lineStats.delta < 0
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {lineStats.delta > 0
                        ? `+${lineStats.delta}`
                        : lineStats.delta === 0
                          ? "±0"
                          : `${lineStats.delta}`}{" "}
                      Zeilen
                    </span>
                    {lineStats.identical && (
                      <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] text-indigo-300">
                        Identisch mit aktuellem Stand
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => void handleRestore()}
                    disabled={restoring}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {restoring ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Diese Version wiederherstellen
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-4">
                  <pre className="whitespace-pre-wrap break-words rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 font-mono text-xs leading-relaxed text-zinc-200">
                    {selectedSnapshot.content}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
                Wähle links einen Snapshot für die Vorschau aus.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
