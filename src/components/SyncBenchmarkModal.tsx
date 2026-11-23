import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  DownloadCloud,
  Gauge,
  GitMerge,
  Laptop,
  Minimize2,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type {
  BenchmarkReport,
  OptimizeReport,
  SyncApplyReport,
  SyncCompactReport,
  SyncMergeReport,
  SyncStatus,
} from "../types/vault";

interface SyncBenchmarkModalProps {
  isOpen: boolean;
  initialTab: "sync" | "benchmark";
  onClose: () => void;
  syncStatus: SyncStatus | null;
  onRefresh: () => Promise<void>;
}

function formatTimestamp(ts: number): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${bytes} B`;
  if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SyncBenchmarkModal({
  isOpen,
  initialTab,
  onClose,
  syncStatus,
  onRefresh,
}: SyncBenchmarkModalProps) {
  const [tab, setTab] = useState<"sync" | "benchmark">(initialTab);
  const [mergeReport, setMergeReport] = useState<SyncMergeReport | null>(null);
  const [applyReport, setApplyReport] = useState<SyncApplyReport | null>(null);
  const [compactReport, setCompactReport] = useState<SyncCompactReport | null>(
    null,
  );
  const [benchReport, setBenchReport] = useState<BenchmarkReport | null>(null);
  const [optimizeReport, setOptimizeReport] = useState<OptimizeReport | null>(
    null,
  );
  const [loadingSync, setLoadingSync] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [loadingCompact, setLoadingCompact] = useState(false);
  const [loadingBench, setLoadingBench] = useState(false);
  const [loadingOptimize, setLoadingOptimize] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleSimulateSync = async () => {
    setLoadingSync(true);
    setError(null);
    try {
      const report = await vaultApi.simulateCrdtSync();
      setMergeReport(report);
      await onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingSync(false);
    }
  };

  const handleApplyRemoteSync = async () => {
    setLoadingApply(true);
    setError(null);
    try {
      const report = await vaultApi.applyRemoteSync();
      setApplyReport(report);
      await onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingApply(false);
    }
  };

  const handleCompactOplogs = async () => {
    setLoadingCompact(true);
    setError(null);
    try {
      const report = await vaultApi.compactSyncOplogs();
      setCompactReport(report);
      await onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingCompact(false);
    }
  };

  const handleRunBenchmark = async () => {
    setLoadingBench(true);
    setError(null);
    try {
      const report = await vaultApi.run100kBenchmark();
      setBenchReport(report);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingBench(false);
    }
  };

  const handleOptimizeIndex = async () => {
    setLoadingOptimize(true);
    setError(null);
    try {
      const report = await vaultApi.optimizeIndex();
      setOptimizeReport(report);
      await onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingOptimize(false);
    }
  };

  const devices = syncStatus?.devices ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab("sync")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === "sync"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <Cloud className="h-3.5 w-3.5" />
              Google Drive CRDT Sync
            </button>
            <button
              onClick={() => setTab("benchmark")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === "benchmark"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <Gauge className="h-3.5 w-3.5" />
              100.000-Blöcke Rust Benchmark
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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

          {tab === "sync" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                  <div className="text-[11px] text-zinc-500">Geräte-ID</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-zinc-200">
                    {syncStatus?.deviceId ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                  <div className="text-[11px] text-zinc-500">
                    Append-Only .oplog Dateien
                  </div>
                  <div className="mt-1 text-base font-bold text-indigo-300">
                    {syncStatus?.oplogFiles.length ?? 0}{" "}
                    <span className="text-xs font-normal text-zinc-500">
                      ({syncStatus?.totalOps ?? 0} Ops)
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                  <div className="text-[11px] text-zinc-500">
                    Cloud-Konfliktkopien
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-base font-bold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span>{syncStatus?.conflictFilesDetected ?? 0}</span>
                  </div>
                </div>
              </div>

              {/* Connected Devices List */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                    <Laptop className="h-3.5 w-3.5 text-indigo-400" />
                    Synchronisierte Geräte ({devices.length})
                  </div>
                </div>
                {devices.length === 0 ? (
                  <div className="text-xs text-zinc-500">
                    Noch keine Remote-Geräte im Sync-Ordner erkannt.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800/80 bg-zinc-900/50">
                    {devices.map((device) => (
                      <div
                        key={device.deviceId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-medium text-zinc-200">
                            {device.displayName}
                          </div>
                          <div className="font-mono text-[10px] text-zinc-500">
                            {device.deviceId}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="rounded bg-indigo-500/15 px-2 py-0.5 font-mono text-indigo-300">
                            {device.opCount} Ops
                          </span>
                          <span className="text-zinc-400">
                            Zuletzt: {formatTimestamp(device.lastSeenTs)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Sync Maintenance Actions */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-sky-200">
                      <DownloadCloud className="h-4 w-4" />
                      Remote-Änderungen einspielen
                    </div>
                    <p className="text-[11px] text-zinc-300">
                      Scannt fremde <code>.oplog</code>-Dateien und wendet alle
                      neuen CRDT-Operationen lokal an.
                    </p>
                  </div>
                  <button
                    onClick={handleApplyRemoteSync}
                    disabled={loadingApply}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
                  >
                    <DownloadCloud className="h-3.5 w-3.5" />
                    {loadingApply ? "Wird angewendet..." : "Remote Ops anwenden"}
                  </button>
                </div>

                <div className="flex flex-col justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                      <Minimize2 className="h-4 w-4" />
                      Oplog-Kompaktierung
                    </div>
                    <p className="text-[11px] text-zinc-300">
                      Fasst historische <code>.oplog</code>-Chunks zusammen und
                      reduziert Speicherbedarf im Sync-Ordner.
                    </p>
                  </div>
                  <button
                    onClick={handleCompactOplogs}
                    disabled={loadingCompact}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                    {loadingCompact
                      ? "Kompaktiere..."
                      : "Oplogs kompaktieren"}
                  </button>
                </div>
              </div>

              {applyReport && (
                <div className="space-y-2 rounded-xl border border-sky-500/30 bg-zinc-950 p-4 text-xs">
                  <div className="flex items-center justify-between text-sky-300">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      Remote Ops angewendet ({applyReport.elapsedUs} µs)
                    </span>
                    <span className="font-mono text-[11px]">
                      {applyReport.opsApplied} / {applyReport.opsScanned} Ops
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <MetricCard
                      label="Gescannte Ops"
                      value={applyReport.opsScanned.toLocaleString("de-DE")}
                      sub="Remote-Oplogs"
                    />
                    <MetricCard
                      label="Angewendete Ops"
                      value={applyReport.opsApplied.toLocaleString("de-DE")}
                      sub="Neu eingespielt"
                      accent="indigo"
                    />
                    <MetricCard
                      label="Aktualisierte Docs"
                      value={applyReport.docsUpdated.length.toLocaleString(
                        "de-DE",
                      )}
                      sub={`${applyReport.elapsedUs} µs`}
                      accent="emerald"
                    />
                  </div>
                  {applyReport.docsUpdated.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {applyReport.docsUpdated.map((doc) => (
                        <span
                          key={doc}
                          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-300"
                        >
                          {doc}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {compactReport && (
                <div className="space-y-2 rounded-xl border border-amber-500/30 bg-zinc-950 p-4 text-xs">
                  <div className="flex items-center justify-between text-amber-300">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      Oplog-Kompaktierung abgeschlossen
                    </span>
                    <span className="font-mono text-[11px]">
                      {formatBytes(compactReport.bytesSaved)} gespart
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <MetricCard
                      label="Dateien"
                      value={`${compactReport.filesBefore} → ${compactReport.filesAfter}`}
                      sub="Vorher → Nachher"
                    />
                    <MetricCard
                      label="Kompaktierte Ops"
                      value={compactReport.opsCompacted.toLocaleString("de-DE")}
                      sub="Zusammengefasst"
                      accent="amber"
                    />
                    <MetricCard
                      label="Speicher gespart"
                      value={formatBytes(compactReport.bytesSaved)}
                      sub={`${compactReport.bytesSaved.toLocaleString("de-DE")} Bytes`}
                      accent="emerald"
                    />
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
                <div className="mb-2 text-xs font-semibold text-zinc-300">
                  Aktive .sync/ Oplog-Chunks (Cloud-Sync-Ordner)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {syncStatus?.oplogFiles.map((f) => (
                    <span
                      key={f}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300"
                    >
                      .sync/{f}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                <div className="space-y-1 pr-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
                    <GitMerge className="h-4 w-4" />
                    2-Geräte Offline-Edit Simulation
                  </div>
                  <p className="text-xs text-zinc-300">
                    Simuliert, wie <code>laptop-a</code> und{" "}
                    <code>desktop-b</code> gleichzeitig offline denselben Absatz
                    bearbeiten, getrennte <code>.oplog</code>-Dateien in Google
                    Drive ablegen und Rust beide Änderungen ohne Konfliktkopie
                    zusammenführt.
                  </p>
                </div>
                <button
                  onClick={handleSimulateSync}
                  disabled={loadingSync}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {loadingSync ? "Merge läuft..." : "Jetzt simulieren"}
                </button>
              </div>

              {mergeReport && (
                <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-zinc-950 p-4 text-xs">
                  <div className="flex items-center justify-between text-emerald-300">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      Konfliktfreier CRDT-Merge abgeschlossen (
                      {mergeReport.elapsedUs} µs)
                    </span>
                    <span className="font-mono text-[11px]">
                      Konfliktkopien: {mergeReport.conflictCopiesCreated}
                    </span>
                  </div>
                  <div className="grid gap-2 pt-1">
                    <div className="rounded-lg bg-zinc-900 p-2.5">
                      <div className="text-[10px] uppercase text-zinc-500">
                        Basis-Text
                      </div>
                      <div className="mt-0.5 text-zinc-300">
                        {mergeReport.baseText}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5">
                        <div className="font-mono text-[10px] text-sky-400">
                          {mergeReport.deviceAFile}
                        </div>
                        <div className="mt-1 text-zinc-200">
                          {mergeReport.deviceAEdit}
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                        <div className="font-mono text-[10px] text-amber-400">
                          {mergeReport.deviceBFile}
                        </div>
                        <div className="mt-1 text-zinc-200">
                          {mergeReport.deviceBEdit}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                      <div className="text-[10px] font-semibold uppercase text-emerald-400">
                        Deterministisches Merge-Ergebnis (Beide Edits erhalten)
                      </div>
                      <div className="mt-1 font-medium text-emerald-100">
                        {mergeReport.mergedResult}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* SQLite Index & FTS5 Optimization */}
              <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                <div className="space-y-1 pr-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
                    <Sparkles className="h-4 w-4" />
                    SQLite Index & FTS5 Wartung
                  </div>
                  <p className="text-xs text-zinc-300">
                    Optimiert den FTS5-Suchindex, führt <code>VACUUM</code> und{" "}
                    <code>PRAGMA optimize</code> aus, um Abfragen zu
                    beschleunigen und Speicherplatz freizugeben.
                  </p>
                </div>
                <button
                  onClick={handleOptimizeIndex}
                  disabled={loadingOptimize}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {loadingOptimize
                    ? "Optimiere..."
                    : "SQLite Index & FTS5 optimieren"}
                </button>
              </div>

              {optimizeReport && (
                <div className="space-y-2 rounded-xl border border-indigo-500/30 bg-zinc-950 p-4 text-xs">
                  <div className="flex items-center justify-between text-indigo-300">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      SQLite & FTS5 Optimierung abgeschlossen
                    </span>
                    <span className="font-mono text-[11px]">
                      {optimizeReport.elapsedUs.toLocaleString("de-DE")} µs
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <MetricCard
                      label="Dauer"
                      value={`${(optimizeReport.elapsedUs / 1000).toFixed(2)} ms`}
                      sub={`${optimizeReport.elapsedUs.toLocaleString("de-DE")} µs`}
                      accent="indigo"
                    />
                    <MetricCard
                      label="DB-Größe vorher"
                      value={formatBytes(optimizeReport.dbSizeBeforeBytes)}
                      sub={`${optimizeReport.dbSizeBeforeBytes.toLocaleString("de-DE")} B`}
                    />
                    <MetricCard
                      label="DB-Größe nachher"
                      value={formatBytes(optimizeReport.dbSizeAfterBytes)}
                      sub={
                        optimizeReport.dbSizeBeforeBytes >=
                        optimizeReport.dbSizeAfterBytes
                          ? `-${formatBytes(
                              optimizeReport.dbSizeBeforeBytes -
                                optimizeReport.dbSizeAfterBytes,
                            )} gespart`
                          : `${optimizeReport.dbSizeAfterBytes.toLocaleString("de-DE")} B`
                      }
                      accent="emerald"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="space-y-1 pr-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                    <Cpu className="h-4 w-4" />
                    Echter Multi-Threaded Rust Benchmark
                  </div>
                  <p className="text-xs text-zinc-300">
                    Erzeugt im Temp-Ordner{" "}
                    <strong>5.000 Markdown-Dateien</strong> mit{" "}
                    <strong>100.000 Blöcken</strong>, über 100.000 Links/Tags
                    und 20.000 Tasks, misst Kalt-Indexierung, BLAKE3-Delta-Sync,
                    FTS5-Volltextsuche und Graph-Layout.
                  </p>
                </div>
                <button
                  onClick={handleRunBenchmark}
                  disabled={loadingBench}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {loadingBench ? "Benchmark läuft..." : "100k Test starten"}
                </button>
              </div>

              {benchReport && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard
                    label="Blöcke indexiert"
                    value={benchReport.blockCount.toLocaleString("de-DE")}
                    sub={`${benchReport.fileCount.toLocaleString("de-DE")} .md Dateien`}
                  />
                  <MetricCard
                    label="Kalt-Indexierung"
                    value={`${benchReport.coldIndexMs.toFixed(0)} ms`}
                    sub={`${Math.round(benchReport.blocksPerSec).toLocaleString("de-DE")} Blöcke/s`}
                    accent="emerald"
                  />
                  <MetricCard
                    label="Delta-Sync (1 Datei)"
                    value={`${benchReport.deltaSync1FileMs.toFixed(1)} ms`}
                    sub={`${benchReport.deltaFilesSkipped} via BLAKE3 übersprungen`}
                    accent="indigo"
                  />
                  <MetricCard
                    label="FTS5 Volltextsuche"
                    value={`${benchReport.ftsSearchUs} µs`}
                    sub={`${(benchReport.ftsSearchUs / 1000).toFixed(3)} ms (${benchReport.ftsHits} Treffer)`}
                    accent="amber"
                  />
                  <MetricCard
                    label="Graph Build & Layout"
                    value={`${benchReport.graphBuildLayoutMs.toFixed(1)} ms`}
                    sub={`${benchReport.linkCount.toLocaleString("de-DE")} Links`}
                  />
                  <MetricCard
                    label="Tasks extrahiert"
                    value={benchReport.taskCount.toLocaleString("de-DE")}
                    sub="In SQLite indiziert"
                  />
                  <MetricCard
                    label="SQLite Index-Größe"
                    value={`${benchReport.dbSizeMb.toFixed(1)} MB`}
                    sub="Inkl. FTS5 & WAL"
                  />
                  <MetricCard
                    label="Dateigenerierung"
                    value={`${benchReport.generationMs.toFixed(1)} ms`}
                    sub="Parallel via rayon"
                  />
                </div>
              )}

              {!benchReport && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-10 text-xs text-zinc-500">
                  <Database className="mb-2 h-6 w-6 text-zinc-600" />
                  Klicke auf „100k Test starten“, um den nativen Rust-Benchmark
                  live auf deinem System auszuführen.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent = "zinc",
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "zinc" | "emerald" | "indigo" | "amber";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "indigo"
        ? "text-indigo-300"
        : accent === "amber"
          ? "text-amber-300"
          : "text-zinc-100";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-bold ${accentClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}
