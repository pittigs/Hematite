import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Database,
  FileText,
  FileWarning,
  Link2Off,
  Network,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { OptimizeReport, VaultAnalytics } from "../types/vault";

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDocument: (target: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function AnalyticsModal({
  isOpen,
  onClose,
  onOpenDocument,
}: AnalyticsModalProps) {
  const [analytics, setAnalytics] = useState<VaultAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeReport, setOptimizeReport] = useState<OptimizeReport | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await vaultApi.getVaultAnalytics();
      setAnalytics(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setOptimizeReport(null);
    void loadAnalytics();
  }, [isOpen, loadAnalytics]);

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

  const handleOptimize = async () => {
    setOptimizing(true);
    setError(null);
    try {
      const report = await vaultApi.optimizeIndex();
      setOptimizeReport(report);
      const refreshed = await vaultApi.getVaultAnalytics();
      setAnalytics(refreshed);
    } catch (err) {
      setError(String(err));
    } finally {
      setOptimizing(false);
    }
  };

  const handleJump = (target: string) => {
    onOpenDocument(target);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="h-4.5 w-4.5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Vault Analytics & Index-Wartung
              </h2>
              <p className="text-[11px] text-zinc-500">
                Graph-Struktur, Lesevolumen, Orphans & Ghost-Links
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {loading && !analytics ? (
            <div className="py-16 text-center text-sm text-zinc-500">
              Berechne Vault-Statistiken...
            </div>
          ) : analytics ? (
            <div className="space-y-5">
              {/* KPI Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard
                  label="Dokumente"
                  value={analytics.totalDocuments.toLocaleString("de-DE")}
                />
                <KpiCard
                  label="Blöcke"
                  value={analytics.totalBlocks.toLocaleString("de-DE")}
                />
                <KpiCard
                  label="Wörter"
                  value={analytics.totalWords.toLocaleString("de-DE")}
                />
                <KpiCard
                  label="Zeichen"
                  value={analytics.totalChars.toLocaleString("de-DE")}
                />
                <KpiCard
                  label="Lesezeit"
                  value={`${analytics.estimatedReadingMinutes.toLocaleString("de-DE")} min`}
                  icon={<BookOpen className="h-3 w-3 text-indigo-400" />}
                />
                <KpiCard
                  label="SQLite-Größe"
                  value={formatBytes(analytics.dbSizeBytes)}
                  icon={<Database className="h-3 w-3 text-emerald-400" />}
                />
              </div>

              {/* Index Maintenance */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Wrench className="h-4 w-4 text-indigo-400" />
                    <div>
                      <div className="text-xs font-semibold text-zinc-100">
                        Index-Wartung
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        Führt FTS5-Segment-Merge, PRAGMA optimize und
                        SQLite-VACUUM aus.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOptimize}
                    disabled={optimizing}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-500/20 px-3.5 py-2 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {optimizing
                      ? "Optimiere Index..."
                      : "FTS5 & SQLite optimieren"}
                  </button>
                </div>

                {optimizeReport && (
                  <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    <span>
                      Optimierung abgeschlossen in{" "}
                      <strong>
                        {(optimizeReport.elapsedUs / 1000).toFixed(2)} ms
                      </strong>
                    </span>
                    <span className="font-mono text-[11px]">
                      {formatBytes(optimizeReport.dbSizeBeforeBytes)} →{" "}
                      {formatBytes(optimizeReport.dbSizeAfterBytes)}
                    </span>
                    {optimizeReport.dbSizeBeforeBytes >
                      optimizeReport.dbSizeAfterBytes && (
                      <span className="font-mono text-[11px]">
                        (-
                        {formatBytes(
                          optimizeReport.dbSizeBeforeBytes -
                            optimizeReport.dbSizeAfterBytes,
                        )}
                        )
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Top Hubs & Orphans */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      <Network className="h-3.5 w-3.5 text-indigo-400" />
                      Top Hubs ({analytics.topHubs.length})
                    </h3>
                  </div>
                  {analytics.topHubs.length === 0 ? (
                    <p className="py-4 text-center text-xs text-zinc-500">
                      Noch keine verlinkten Hub-Dokumente vorhanden.
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                      {analytics.topHubs.map((hub) => (
                        <button
                          key={hub.docId}
                          type="button"
                          onClick={() => handleJump(hub.path)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-800/80"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-zinc-100">
                                {hub.title}
                              </div>
                              <div className="truncate font-mono text-[10px] text-zinc-500">
                                {hub.path}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-zinc-400">
                            <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300">
                              {hub.degree} Links
                            </span>
                            <span>{hub.wordCount} W.</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      <FileWarning className="h-3.5 w-3.5 text-amber-400" />
                      Verwaiste Notizen / Orphans (
                      {analytics.orphanDocuments.length})
                    </h3>
                  </div>
                  {analytics.orphanDocuments.length === 0 ? (
                    <p className="py-4 text-center text-xs text-zinc-500">
                      Keine verwaisten Notizen — alle Dokumente sind vernetzt.
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                      {analytics.orphanDocuments.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => handleJump(doc.path)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-800/80"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-zinc-100">
                                {doc.title}
                              </div>
                              <div className="truncate font-mono text-[10px] text-zinc-500">
                                {doc.path}
                              </div>
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                            {doc.blockCount} Blöcke
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Broken / Ghost Links */}
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    <Link2Off className="h-3.5 w-3.5 text-rose-400" />
                    Offene Ghost-Links ({analytics.brokenLinks.length})
                  </h3>
                  <span className="text-[11px] text-zinc-500">
                    Klicken, um Zieldokument anzulegen oder zu öffnen
                  </span>
                </div>
                {analytics.brokenLinks.length === 0 ? (
                  <p className="py-4 text-center text-xs text-zinc-500">
                    Keine offenen Ghost-Links gefunden.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {analytics.brokenLinks.map((item) => (
                      <button
                        key={item.targetRaw}
                        type="button"
                        onClick={() => handleJump(item.targetRaw)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-800/80"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-medium text-indigo-300">
                            [[{item.targetRaw}]]
                          </div>
                          {item.sourceDocs.length > 0 && (
                            <div className="truncate text-[10px] text-zinc-500">
                              Referenziert in:{" "}
                              {item.sourceDocs.slice(0, 3).join(", ")}
                              {item.sourceDocs.length > 3
                                ? ` (+${item.sourceDocs.length - 3})`
                                : ""}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 rounded bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] text-rose-300">
                          {item.referenceCount}×
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-5 py-2.5 text-[11px] text-zinc-500">
          <span>Echtzeit-Analyse direkt aus SQLite & Graph-Index</span>
          <span>Esc Schließen</span>
        </div>
      </div>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

function KpiCard({ label, value, icon }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-zinc-100">
        {value}
      </div>
    </div>
  );
}
