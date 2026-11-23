import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Database,
  FolderOpen,
  FolderSync,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { VaultOverview } from "../types/vault";

export interface VaultSwitcherModalProps {
  isOpen: boolean;
  currentVaultPath: string;
  currentDbPath: string;
  onClose: () => void;
  onSwitched: (overview: VaultOverview) => Promise<void>;
}

const RECENT_VAULTS_STORAGE_KEY = "oxidevault_recent_vaults";
const MAX_RECENT_VAULTS = 6;

function normalizeVaultList(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "—" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_RECENT_VAULTS) break;
  }
  return result;
}

function loadRecentVaults(currentVaultPath: string): string[] {
  let stored: string[] = [];
  try {
    const raw = localStorage.getItem(RECENT_VAULTS_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stored = parsed.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    // ignore storage failures
  }
  return normalizeVaultList(
    currentVaultPath ? [currentVaultPath, ...stored] : stored,
  );
}

function persistRecentVaults(paths: string[]): void {
  try {
    localStorage.setItem(
      RECENT_VAULTS_STORAGE_KEY,
      JSON.stringify(normalizeVaultList(paths)),
    );
  } catch {
    // ignore storage failures
  }
}

export function VaultSwitcherModal({
  isOpen,
  currentVaultPath,
  currentDbPath,
  onClose,
  onSwitched,
}: VaultSwitcherModalProps) {
  const [vaultPathInput, setVaultPathInput] = useState("");
  const [recentVaults, setRecentVaults] = useState<string[]>(() =>
    loadRecentVaults(currentVaultPath),
  );
  const [switchingPath, setSwitchingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const merged = loadRecentVaults(currentVaultPath);
    setRecentVaults(merged);
    persistRecentVaults(merged);
    setVaultPathInput("");
    setError(null);
    setSwitchingPath(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [isOpen, currentVaultPath]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !switchingPath) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, switchingPath]);

  if (!isOpen) return null;

  const isLoading = switchingPath !== null;

  const handleSwitch = async (rawPath: string) => {
    const targetPath = rawPath.trim();
    if (!targetPath || isLoading) return;
    setSwitchingPath(targetPath);
    setError(null);
    try {
      const nextOverview = await vaultApi.switchVault(targetPath);
      const updatedRecent = normalizeVaultList([
        nextOverview.vaultPath,
        currentVaultPath,
        ...recentVaults,
      ]);
      setRecentVaults(updatedRecent);
      persistRecentVaults(updatedRecent);
      await onSwitched(nextOverview);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Vault konnte nicht gewechselt werden.",
      );
    } finally {
      setSwitchingPath(null);
    }
  };

  const handleRemoveRecent = (pathToRemove: string) => {
    const updated = recentVaults.filter((p) => p !== pathToRemove);
    setRecentVaults(updated);
    persistRecentVaults(updated);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-4 pt-16 backdrop-blur-xs"
      onClick={() => {
        if (!isLoading) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
              <FolderSync className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Vault wechseln
              </h2>
              <p className="text-[11px] text-zinc-400">
                Cloud-Safe Markdown-Ordner mit getrenntem lokalem SQLite-Index
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Active Vault & Local SQLite Cache Info */}
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span>Aktiver Vault (Cloud-Safe)</span>
                </div>
                <code
                  title={currentVaultPath}
                  className="block truncate font-mono text-xs text-zinc-100"
                >
                  {currentVaultPath || "—"}
                </code>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                Aktiv
              </span>
            </div>

            <div className="border-t border-zinc-800/80 pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <Database className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                <span>Separater lokaler SQLite-Cache</span>
              </div>
              <code
                title={currentDbPath}
                className="block truncate font-mono text-xs text-zinc-300"
              >
                {currentDbPath || "—"}
              </code>
            </div>
          </div>

          {/* Inline Error Feedback */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Switch Path Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSwitch(vaultPathInput);
            }}
            className="space-y-2"
          >
            <label
              htmlFor="vault-path-input"
              className="block text-xs font-medium text-zinc-300"
            >
              Vault-Ordnerpfad öffnen oder anlegen
            </label>
            <div className="flex gap-2">
              <input
                id="vault-path-input"
                ref={inputRef}
                type="text"
                value={vaultPathInput}
                disabled={isLoading}
                onChange={(e) => setVaultPathInput(e.target.value)}
                placeholder="~/Google Drive/MeinVault, ./demo-vault oder /pfad/zum/vault"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700/80 bg-zinc-950/80 px-3.5 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-indigo-500/70 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!vaultPathInput.trim() || isLoading}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isLoading && switchingPath === vaultPathInput.trim() ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Wechsle...</span>
                  </>
                ) : (
                  <>
                    <span>Wechseln</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Akzeptiert absolute Pfade, relative Pfade (z. B.{" "}
              <code className="text-zinc-400">./demo-vault</code>) und{" "}
              <code className="text-zinc-400">~</code>-Home-Pfade. Jeder Vault
              erhält automatisch einen isolierten lokalen SQLite-Index.
            </p>
          </form>

          {/* Recent Vaults List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                Zuletzt geöffnete Vaults
              </span>
              <span className="text-[11px] text-zinc-500">
                {recentVaults.length} / {MAX_RECENT_VAULTS}
              </span>
            </div>

            {recentVaults.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-5 text-center text-xs text-zinc-500">
                Noch keine kürzlich verwendeten Vaults gespeichert.
              </div>
            ) : (
              <div className="space-y-1.5">
                {recentVaults.map((vaultPath) => {
                  const isCurrent = vaultPath === currentVaultPath;
                  const isSwitchingThis = switchingPath === vaultPath;
                  return (
                    <div
                      key={vaultPath}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition ${
                        isCurrent
                          ? "border-indigo-500/40 bg-indigo-500/10"
                          : "border-zinc-800/90 bg-zinc-950/60 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <FolderOpen
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isCurrent ? "text-indigo-400" : "text-zinc-500"
                          }`}
                        />
                        <code
                          title={vaultPath}
                          className={`truncate font-mono text-xs ${
                            isCurrent ? "text-indigo-200" : "text-zinc-300"
                          }`}
                        >
                          {vaultPath}
                        </code>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300">
                            <Check className="h-3 w-3" />
                            Aktiv
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => void handleSwitch(vaultPath)}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-indigo-500/60 hover:bg-indigo-500/15 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isSwitchingThis ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Lädt...</span>
                                </>
                              ) : (
                                <>
                                  <span>Öffnen</span>
                                  <ArrowRight className="h-3 w-3" />
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleRemoveRecent(vaultPath)}
                              title="Aus Verlauf entfernen"
                              aria-label={`${vaultPath} aus Verlauf entfernen`}
                              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-5 py-3">
          <span className="text-[11px] text-zinc-500">
            Enter Wechseln • Esc Schließen
          </span>
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
