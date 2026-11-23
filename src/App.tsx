import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cloud,
  Compass,
  Contrast,
  Database,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  Keyboard,
  Layers,
  Moon,
  Pin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { isTauriRuntime, vaultApi } from "./api/bridge";
import { AnalyticsModal } from "./components/AnalyticsModal";
import {
  CommandPalette,
  type CommandPaletteAction,
} from "./components/CommandPalette";
import { DatabaseView } from "./components/DatabaseView";
import { GraphView } from "./components/GraphView";
import { HybridEditor } from "./components/HybridEditor";
import { InfiniteCanvas } from "./components/InfiniteCanvas";
import { QuickCaptureModal } from "./components/QuickCaptureModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SyncBenchmarkModal } from "./components/SyncBenchmarkModal";
import { TasksCalendarView } from "./components/TasksCalendarView";
import { TrashModal } from "./components/TrashModal";
import type {
  DocumentSummary,
  DocumentWithBlocks,
  VaultOverview,
} from "./types/vault";

type ActiveView = "editor" | "tasks" | "database" | "graph" | "canvas";
type ThemeMode = "dark" | "light" | "high-contrast";

const PINNED_STORAGE_KEY = "oxidevault_pinned_docs";
const RECENT_STORAGE_KEY = "oxidevault_recent_docs";
const THEME_STORAGE_KEY = "oxidevault_theme";
const MAX_RECENT_DOCS = 8;

function loadStoredList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function loadStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "high-contrast" || raw === "dark") {
      return raw;
    }
  } catch {
    // ignore storage failures
  }
  return "dark";
}

export function App() {
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentWithBlocks | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const [activeCanvasPath, setActiveCanvasPath] = useState(
    "canvas/System-Architektur.canvas",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modalState, setModalState] = useState<{
    open: boolean;
    tab: "sync" | "benchmark";
  }>({ open: false, tab: "sync" });
  const [trashOpen, setTrashOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [creatingNote, setCreatingNote] = useState(false);
  const [newNoteName, setNewNoteName] = useState("");
  const [creatingCanvas, setCreatingCanvas] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<
    Record<string, boolean>
  >({});

  const [theme, setTheme] = useState<ThemeMode>(loadStoredTheme);
  const [isZenMode, setIsZenMode] = useState(false);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(() =>
    loadStoredList(PINNED_STORAGE_KEY),
  );
  const [recentPaths, setRecentPaths] = useState<string[]>(() =>
    loadStoredList(RECENT_STORAGE_KEY),
  );

  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState<number>(-1);
  const navIndexRef = useRef<number>(-1);
  const lastRevisionRef = useRef<number>(0);

  const [backendError, setBackendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    navIndexRef.current = navIndex;
  }, [navIndex]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme !== "light");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedPaths));
    } catch {
      // ignore
    }
  }, [pinnedPaths]);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentPaths));
    } catch {
      // ignore
    }
  }, [recentPaths]);

  const cycleTheme = useCallback(() => {
    setTheme((curr) =>
      curr === "dark" ? "light" : curr === "light" ? "high-contrast" : "dark",
    );
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      const [ov, docs] = await Promise.all([
        vaultApi.getOverview(),
        vaultApi.listDocuments(),
      ]);
      lastRevisionRef.current = ov.revision;
      setOverview(ov);
      setDocuments(docs);
      setBackendError(null);
      return docs;
    } catch (err) {
      setBackendError(
        "Verbindung zur Rust-Engine fehlgeschlagen. Starte `cargo run -p vault-cli -- serve` oder die Tauri-Desktop-App.",
      );
      console.error(err);
      return [];
    }
  }, []);

  const recordOpenedDocument = useCallback(
    (docPath: string, pushHistory: boolean) => {
      setRecentPaths((prev) =>
        [docPath, ...prev.filter((p) => p !== docPath)].slice(
          0,
          MAX_RECENT_DOCS,
        ),
      );
      if (pushHistory) {
        setNavHistory((prev) => {
          const idx = navIndexRef.current;
          const sliced = idx >= 0 ? prev.slice(0, idx + 1) : [];
          if (sliced[sliced.length - 1] === docPath) {
            navIndexRef.current = sliced.length - 1;
            setNavIndex(sliced.length - 1);
            return sliced;
          }
          const next = [...sliced, docPath];
          navIndexRef.current = next.length - 1;
          setNavIndex(next.length - 1);
          return next;
        });
      }
    },
    [],
  );

  const openDocument = useCallback(
    async (target: string, options?: { skipHistory?: boolean }) => {
      setActionError(null);
      try {
        let doc = await vaultApi.getDocument(target);
        if (!doc) {
          // Obsidian-like UX: clicking an unresolved [[Wiki-Link]] creates the note cleanly
          doc = await vaultApi.createDocument(target, target);
          await refreshVault();
        }
        setActiveDoc(doc);
        setActiveView("editor");
        recordOpenedDocument(doc.document.path, !options?.skipHistory);
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : "Dokument konnte nicht geöffnet werden.",
        );
      }
    },
    [recordOpenedDocument, refreshVault],
  );

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex >= 0 && navIndex < navHistory.length - 1;

  const goBack = useCallback(() => {
    if (navIndex <= 0) return;
    const nextIdx = navIndex - 1;
    const target = navHistory[nextIdx];
    if (!target) return;
    navIndexRef.current = nextIdx;
    setNavIndex(nextIdx);
    void openDocument(target, { skipHistory: true });
  }, [navHistory, navIndex, openDocument]);

  const goForward = useCallback(() => {
    if (navIndex < 0 || navIndex >= navHistory.length - 1) return;
    const nextIdx = navIndex + 1;
    const target = navHistory[nextIdx];
    if (!target) return;
    navIndexRef.current = nextIdx;
    setNavIndex(nextIdx);
    void openDocument(target, { skipHistory: true });
  }, [navHistory, navIndex, openDocument]);

  const handleOpenDaily = useCallback(
    async (date?: string) => {
      setActionError(null);
      try {
        const daily = await vaultApi.openDailyNote(date);
        setActiveDoc(daily);
        setActiveView("editor");
        recordOpenedDocument(daily.document.path, true);
        await refreshVault();
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : "Daily Note konnte nicht geöffnet werden.",
        );
      }
    },
    [recordOpenedDocument, refreshVault],
  );

  const handleOpenRandomNote = useCallback(() => {
    if (documents.length === 0) return;
    const candidates =
      documents.length > 1 && activeDoc
        ? documents.filter((d) => d.path !== activeDoc.document.path)
        : documents;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (chosen) {
      void openDocument(chosen.path);
    }
  }, [activeDoc, documents, openDocument]);

  useEffect(() => {
    refreshVault().then((docs) => {
      if (docs.length > 0) {
        const preferred =
          docs.find((d) => d.path === "Willkommen in OxideVault.md") ?? docs[0];
        void openDocument(preferred.path);
      }
    });
  }, [refreshVault, openDocument]);

  // Live File-Watcher Sync (Tauri Event in Desktop mode, Revision polling in HTTP mode)
  useEffect(() => {
    if (isTauriRuntime()) {
      let disposed = false;
      let unlisten: (() => void) | null = null;
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<number>("vault-changed", (event) => {
            if (typeof event.payload === "number") {
              lastRevisionRef.current = event.payload;
            }
            void refreshVault();
          }),
        )
        .then((fn) => {
          if (disposed) {
            fn();
          } else {
            unlisten = fn;
          }
        })
        .catch(() => {});
      return () => {
        disposed = true;
        unlisten?.();
      };
    }

    const timer = window.setInterval(() => {
      void vaultApi
        .getRevision()
        .then((rev) => {
          if (rev > lastRevisionRef.current) {
            void refreshVault();
          }
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshVault]);

  // Global Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const lower = e.key.toLowerCase();

      if (mod && !e.shiftKey && lower === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.shiftKey && lower === "n") {
        e.preventDefault();
        setQuickCaptureOpen(true);
      } else if (mod && e.shiftKey && lower === "f") {
        e.preventDefault();
        setIsZenMode((v) => !v);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goBack, goForward]);

  const handleCreateNote = async () => {
    const name = newNoteName.trim();
    if (!name) return;
    setActionError(null);
    try {
      const created = await vaultApi.createDocument(name, name);
      setNewNoteName("");
      setCreatingNote(false);
      await refreshVault();
      setActiveDoc(created);
      setActiveView("editor");
      recordOpenedDocument(created.document.path, true);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Notiz konnte nicht erstellt werden.",
      );
    }
  };

  const handleCreateCanvas = async () => {
    const raw = newCanvasName.trim();
    if (!raw) return;
    const target = raw.endsWith(".canvas")
      ? raw
      : raw.includes("/")
        ? `${raw}.canvas`
        : `canvas/${raw}.canvas`;
    setActionError(null);
    try {
      const created = await vaultApi.createCanvas(target);
      setNewCanvasName("");
      setCreatingCanvas(false);
      await refreshVault();
      setActiveCanvasPath(created.path);
      setActiveView("canvas");
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Canvas konnte nicht erstellt werden.",
      );
    }
  };

  const handleDeleteDocument = async (relPath: string) => {
    setActionError(null);
    try {
      await vaultApi.deleteDocument(relPath);
      setPinnedPaths((prev) => prev.filter((p) => p !== relPath));
      const docs = await refreshVault();
      if (docs.length > 0) {
        await openDocument(docs[0].path);
      } else {
        setActiveDoc(null);
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Notiz konnte nicht gelöscht werden.",
      );
    }
  };

  const handleRenameDocument = async (
    oldRelPath: string,
    newRelPath: string,
  ) => {
    setActionError(null);
    const renamed = await vaultApi.renameDocument(oldRelPath, newRelPath);
    setPinnedPaths((prev) =>
      prev.map((p) => (p === oldRelPath ? renamed.document.path : p)),
    );
    setRecentPaths((prev) =>
      prev.map((p) => (p === oldRelPath ? renamed.document.path : p)),
    );
    await refreshVault();
    setActiveDoc(renamed);
    setActiveView("editor");
  };

  const togglePin = useCallback((docPath: string) => {
    setPinnedPaths((prev) =>
      prev.includes(docPath)
        ? prev.filter((p) => p !== docPath)
        : [docPath, ...prev],
    );
  }, []);

  const filteredDocuments = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q),
    );
  }, [documents, fileFilter]);

  const pinnedDocs = useMemo(
    () =>
      pinnedPaths
        .map((p) => filteredDocuments.find((d) => d.path === p))
        .filter((d): d is DocumentSummary => Boolean(d)),
    [filteredDocuments, pinnedPaths],
  );

  const folderTree = useMemo(
    () => buildFolderTree(filteredDocuments),
    [filteredDocuments],
  );

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const paletteActions: CommandPaletteAction[] = useMemo(
    () => [
      {
        id: "open-daily",
        label: "Heutige Daily Note öffnen",
        description: "Erstellt oder öffnet das heutige Tagesjournal",
        run: () => void handleOpenDaily(),
      },
      {
        id: "quick-capture",
        label: "Quick Capture (Aufgabe / Notiz erfassen)",
        description: "Schnell in die heutige Daily Note schreiben",
        shortcut: "Ctrl+Shift+N",
        run: () => setQuickCaptureOpen(true),
      },
      {
        id: "random-note",
        label: "Zufällige Notiz öffnen (Serendipity)",
        description: "Eine bestehende Notiz im Vault neu entdecken",
        run: handleOpenRandomNote,
      },
      {
        id: "cycle-theme",
        label: `Theme wechseln (aktuell: ${theme})`,
        description: "Zwischen Dark, Light und High-Contrast umschalten",
        run: cycleTheme,
      },
      {
        id: "toggle-zen",
        label: isZenMode ? "Zen-Modus beenden" : "Zen-Modus aktivieren",
        description: "Sidebar und Statusleiste ausblenden",
        shortcut: "Ctrl+Shift+F",
        run: () => setIsZenMode((v) => !v),
      },
      {
        id: "open-analytics",
        label: "Vault-Analyse & Health öffnen",
        description: "Wörter, Orphans, Ghost-Links & Top Hubs prüfen",
        run: () => setAnalyticsOpen(true),
      },
      {
        id: "open-trash",
        label: "Papierkorb öffnen",
        description: "Gelöschte Notizen wiederherstellen oder endgültig löschen",
        run: () => setTrashOpen(true),
      },
      {
        id: "reindex-vault",
        label: "Vault neu indexieren (BLAKE3 Delta)",
        description: "Dateisystem scannen und SQLite-Index synchronisieren",
        run: () => void vaultApi.reindexVault().then(() => refreshVault()),
      },
      {
        id: "optimize-index",
        label: "SQLite & FTS5 optimieren",
        description: "FTS5-Index kompaktieren und PRAGMA optimize ausführen",
        run: () => {
          void vaultApi.optimizeIndex().then(() => refreshVault());
        },
      },
      {
        id: "show-shortcuts",
        label: "Tastenkürzel anzeigen",
        description: "Übersicht aller Shortcuts öffnen",
        shortcut: "Ctrl+/",
        run: () => setShortcutsOpen(true),
      },
    ],
    [
      cycleTheme,
      handleOpenDaily,
      handleOpenRandomNote,
      isZenMode,
      refreshVault,
      theme,
    ],
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar (hidden in Zen Mode) */}
        {!isZenMode && (
          <aside className="flex w-68 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
            {/* App Brand & Quick Header Tools */}
            <div className="flex items-center justify-between border-b border-zinc-800/70 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/40">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold tracking-tight text-zinc-100">
                    OxideVault
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Rust Core • SQLite FTS5
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-0.5">
                <button
                  onClick={goBack}
                  disabled={!canGoBack}
                  title="Zurück (Alt+←)"
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={goForward}
                  disabled={!canGoForward}
                  title="Vorwärts (Alt+→)"
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleOpenRandomNote}
                  disabled={documents.length === 0}
                  title="Zufällige Notiz (Serendipity)"
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-indigo-300 disabled:opacity-30"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={cycleTheme}
                  title={`Theme wechseln (aktuell: ${theme})`}
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-amber-300"
                >
                  {theme === "light" ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : theme === "high-contrast" ? (
                    <Contrast className="h-3.5 w-3.5" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  onClick={() => {
                    void vaultApi.reindexVault().then(() => refreshVault());
                  }}
                  title="Vault neu scannen (BLAKE3 Delta)"
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Search & Quick Capture Triggers */}
            <div className="flex gap-1.5 p-3">
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
              >
                <span className="flex items-center gap-2 truncate">
                  <Search className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span className="truncate">Suche & Befehle...</span>
                </span>
                <kbd className="ml-1 shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  Ctrl+K
                </kbd>
              </button>
              <button
                onClick={() => setQuickCaptureOpen(true)}
                title="Quick Capture (Ctrl+Shift+N)"
                className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/70 px-2.5 text-amber-400 transition hover:border-amber-500/40 hover:bg-zinc-900"
              >
                <Zap className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <nav className="space-y-0.5 px-2.5 pb-3">
              <SidebarNavBtn
                active={activeView === "editor"}
                onClick={() => setActiveView("editor")}
                icon={<FileText className="h-4 w-4" />}
                label="Notizen & Blöcke"
                badge={overview?.totalDocuments}
              />
              <SidebarNavBtn
                active={false}
                onClick={() => void handleOpenDaily()}
                icon={<CalendarDays className="h-4 w-4 text-amber-400" />}
                label="Heutige Daily Note"
              />
              <SidebarNavBtn
                active={activeView === "tasks"}
                onClick={() => setActiveView("tasks")}
                icon={<CheckSquare className="h-4 w-4 text-emerald-400" />}
                label="Aufgaben & Zeitplan"
                badge={overview?.openTasks}
              />
              <SidebarNavBtn
                active={activeView === "database"}
                onClick={() => setActiveView("database")}
                icon={<Database className="h-4 w-4 text-sky-400" />}
                label="Datenbank-Views"
              />
              <SidebarNavBtn
                active={activeView === "graph"}
                onClick={() => setActiveView("graph")}
                icon={<Compass className="h-4 w-4 text-indigo-400" />}
                label="Wissensgraph"
              />
              <SidebarNavBtn
                active={activeView === "canvas"}
                onClick={() => setActiveView("canvas")}
                icon={<Layers className="h-4 w-4 text-cyan-400" />}
                label="Infinite Canvas"
              />
            </nav>

            {/* Documents List */}
            <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800/70">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Vault Dateien
                </span>
                <button
                  onClick={() => setCreatingNote((v) => !v)}
                  title="Neue Notiz erstellen"
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-indigo-300"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {creatingNote && (
                <div className="mx-3 mb-2 flex gap-1">
                  <input
                    value={newNoteName}
                    onChange={(e) => setNewNoteName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateNote();
                      if (e.key === "Escape") setCreatingNote(false);
                    }}
                    placeholder="Dateiname..."
                    autoFocus
                    className="w-full rounded-lg border border-indigo-500/50 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 outline-none"
                  />
                  <button
                    onClick={() => void handleCreateNote()}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white"
                  >
                    OK
                  </button>
                </div>
              )}

              <div className="mx-3 mb-2">
                <input
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  placeholder="Dateien filtern..."
                  className="w-full rounded-lg border border-zinc-800/90 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500/50"
                />
              </div>

              <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
                {pinnedDocs.length > 0 && (
                  <div className="mb-2 border-b border-zinc-800/60 pb-2">
                    <div className="flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                      <Pin className="h-3 w-3" />
                      <span>Angepinnt</span>
                    </div>
                    {pinnedDocs.map((doc) => {
                      const isSelected =
                        activeView === "editor" &&
                        activeDoc?.document.path === doc.path;
                      return (
                        <div
                          key={`pin-${doc.id}`}
                          className={`group flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs transition ${
                            isSelected
                              ? "bg-indigo-500/15 font-medium text-indigo-200"
                              : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                          }`}
                        >
                          <button
                            onClick={() => void openDocument(doc.path)}
                            className="min-w-0 flex-1 truncate text-left"
                          >
                            {doc.title}
                          </button>
                          <button
                            onClick={() => togglePin(doc.path)}
                            title="Aus Angepinnt entfernen"
                            className="ml-1 shrink-0 rounded p-0.5 text-amber-400 opacity-70 hover:opacity-100"
                          >
                            <Pin className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <FolderTreeView
                  node={folderTree}
                  depth={0}
                  activePath={
                    activeView === "editor"
                      ? (activeDoc?.document.path ?? null)
                      : null
                  }
                  pinnedSet={new Set(pinnedPaths)}
                  collapsedFolders={collapsedFolders}
                  forceExpand={fileFilter.trim().length > 0}
                  onToggleFolder={toggleFolder}
                  onTogglePin={togglePin}
                  onSelectDocument={(p) => void openDocument(p)}
                />

                <div className="flex items-center justify-between px-2 pt-3 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    Whiteboards (.canvas)
                  </span>
                  <button
                    onClick={() => setCreatingCanvas((v) => !v)}
                    title="Neues Whiteboard erstellen"
                    className="rounded p-0.5 text-zinc-500 hover:bg-zinc-900 hover:text-cyan-300"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                {creatingCanvas && (
                  <div className="mx-1 mb-1.5 flex gap-1">
                    <input
                      value={newCanvasName}
                      onChange={(e) => setNewCanvasName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleCreateCanvas();
                        if (e.key === "Escape") setCreatingCanvas(false);
                      }}
                      placeholder="canvas/Ideen.canvas"
                      autoFocus
                      className="w-full rounded-lg border border-cyan-500/50 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 outline-none"
                    />
                    <button
                      onClick={() => void handleCreateCanvas()}
                      className="rounded-lg bg-cyan-600 px-2 py-1 text-[11px] font-semibold text-white"
                    >
                      OK
                    </button>
                  </div>
                )}

                {overview?.canvasFiles.map((cp) => (
                  <button
                    key={cp}
                    onClick={() => {
                      setActiveCanvasPath(cp);
                      setActiveView("canvas");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      activeView === "canvas" && activeCanvasPath === cp
                        ? "bg-cyan-500/15 font-medium text-cyan-200"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate">{cp}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Utility, Sync & Benchmark Actions */}
            <div className="space-y-1.5 border-t border-zinc-800/80 p-3">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setAnalyticsOpen(true)}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:border-sky-500/40 hover:bg-zinc-900"
                >
                  <BarChart3 className="h-3.5 w-3.5 text-sky-400" />
                  <span>Analyse</span>
                </button>
                <button
                  onClick={() => setTrashOpen(true)}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:border-rose-500/40 hover:bg-zinc-900"
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                  <span>Papierkorb</span>
                  {(overview?.trashCount ?? 0) > 0 && (
                    <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                      {overview?.trashCount}
                    </span>
                  )}
                </button>
              </div>
              <button
                onClick={() => setModalState({ open: true, tab: "sync" })}
                className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 transition hover:border-indigo-500/40 hover:bg-zinc-900"
              >
                <span className="flex items-center gap-2">
                  <Cloud className="h-3.5 w-3.5 text-indigo-400" />
                  CRDT Cloud Sync
                </span>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <ShieldCheck className="h-3 w-3" />
                  {overview?.syncStatus.conflictFilesDetected ?? 0} Konflikte
                </span>
              </button>
              <button
                onClick={() => setModalState({ open: true, tab: "benchmark" })}
                className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:bg-zinc-900"
              >
                <span className="flex items-center gap-2">
                  <Gauge className="h-3.5 w-3.5 text-emerald-400" />
                  100k Rust Benchmark
                </span>
                <span className="text-[10px] text-zinc-500">Testen</span>
              </button>
            </div>
          </aside>
        )}

        {/* Main Workspace */}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {backendError && (
            <div className="m-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
              {backendError}
            </div>
          )}

          {actionError && (
            <div className="mx-6 mt-4 flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {actionError}
              </span>
              <button
                onClick={() => setActionError(null)}
                className="rounded p-0.5 hover:bg-rose-500/20"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {!backendError && activeView === "editor" && activeDoc && (
            <HybridEditor
              docBundle={activeDoc}
              allDocuments={documents}
              onSaved={async (updated) => {
                setActiveDoc(updated);
                await refreshVault();
              }}
              onNavigate={(target) => void openDocument(target)}
              onDeleteDocument={handleDeleteDocument}
              onRenameDocument={handleRenameDocument}
              isZenMode={isZenMode}
              onToggleZenMode={() => setIsZenMode((v) => !v)}
            />
          )}

          {!backendError && activeView === "tasks" && (
            <TasksCalendarView
              onOpenDocument={(p) => void openDocument(p)}
              onOpenDaily={(d) => void handleOpenDaily(d)}
              onTasksChanged={async () => {
                await refreshVault();
              }}
            />
          )}

          {!backendError && activeView === "database" && (
            <DatabaseView onOpenDocument={(p) => void openDocument(p)} />
          )}

          {!backendError && activeView === "graph" && (
            <GraphView
              onOpenDocument={(p) => void openDocument(p)}
              activeDocId={activeDoc?.document.id ?? null}
            />
          )}

          {!backendError && activeView === "canvas" && (
            <InfiniteCanvas
              canvasPath={activeCanvasPath}
              documents={documents}
              onOpenDocument={(p) => void openDocument(p)}
              onCanvasListChanged={async () => {
                await refreshVault();
              }}
              onSelectCanvas={(p) => setActiveCanvasPath(p)}
            />
          )}
        </main>
      </div>

      {/* Bottom Engine Status Bar (hidden in Zen Mode) */}
      {!isZenMode && (
        <footer className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-950 px-4 py-1.5 text-[11px] text-zinc-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {isTauriRuntime() ? "Tauri v2 Native" : "Rust Core API"}
            </span>
            <span className="hidden truncate sm:inline">
              Vault (Cloud-Safe):{" "}
              <code className="text-zinc-400">{overview?.vaultPath ?? "—"}</code>
            </span>
            <span className="hidden truncate lg:inline">
              Lokaler SQLite-Cache:{" "}
              <code className="text-zinc-400">{overview?.dbPath ?? "—"}</code>
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono">
            <span>{overview?.totalDocuments ?? 0} Docs</span>
            <span>{overview?.totalBlocks ?? 0} Blöcke</span>
            <span>{overview?.totalLinks ?? 0} Links</span>
            <button
              onClick={() => setShortcutsOpen(true)}
              title="Tastenkürzel anzeigen (Ctrl+/)"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Keyboard className="h-3 w-3" />
              <span className="hidden sm:inline">Ctrl+/</span>
            </button>
          </div>
        </footer>
      )}

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        documents={documents}
        onSelectDocument={(p) => void openDocument(p)}
        recentPaths={recentPaths}
        actions={paletteActions}
      />

      <SyncBenchmarkModal
        isOpen={modalState.open}
        initialTab={modalState.tab}
        onClose={() => setModalState((s) => ({ ...s, open: false }))}
        syncStatus={overview?.syncStatus ?? null}
        onRefresh={async () => {
          await refreshVault();
        }}
      />

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={async (doc) => {
          await refreshVault();
          setActiveDoc(doc);
          setActiveView("editor");
          recordOpenedDocument(doc.document.path, true);
        }}
        onChanged={async () => {
          await refreshVault();
        }}
      />

      <AnalyticsModal
        isOpen={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        onOpenDocument={(target) => void openDocument(target)}
      />

      <QuickCaptureModal
        isOpen={quickCaptureOpen}
        onClose={() => setQuickCaptureOpen(false)}
        onCaptured={async () => {
          const docs = await refreshVault();
          if (activeDoc) {
            const refreshed = await vaultApi.getDocument(
              activeDoc.document.path,
            );
            if (refreshed) {
              setActiveDoc(refreshed);
            } else if (docs.length > 0) {
              await openDocument(docs[0].path);
            }
          }
        }}
      />

      <ShortcutsModal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}

function SidebarNavBtn({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition ${
        active
          ? "bg-indigo-500/15 text-indigo-200"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      <span className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </span>
      {typeof badge === "number" && (
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
          {badge}
        </span>
      )}
    </button>
  );
}

interface FolderTreeNode {
  name: string;
  fullPath: string;
  folders: Map<string, FolderTreeNode>;
  docs: DocumentSummary[];
}

function buildFolderTree(docs: DocumentSummary[]): FolderTreeNode {
  const root: FolderTreeNode = {
    name: "",
    fullPath: "",
    folders: new Map(),
    docs: [],
  };
  for (const doc of docs) {
    const parts = doc.path.split("/");
    let curr = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const nextPath = curr.fullPath ? `${curr.fullPath}/${segment}` : segment;
      let child = curr.folders.get(segment);
      if (!child) {
        child = {
          name: segment,
          fullPath: nextPath,
          folders: new Map(),
          docs: [],
        };
        curr.folders.set(segment, child);
      }
      curr = child;
    }
    curr.docs.push(doc);
  }
  return root;
}

function FolderTreeView({
  node,
  depth,
  activePath,
  pinnedSet,
  collapsedFolders,
  forceExpand,
  onToggleFolder,
  onTogglePin,
  onSelectDocument,
}: {
  node: FolderTreeNode;
  depth: number;
  activePath: string | null;
  pinnedSet: Set<string>;
  collapsedFolders: Record<string, boolean>;
  forceExpand: boolean;
  onToggleFolder: (folderPath: string) => void;
  onTogglePin: (docPath: string) => void;
  onSelectDocument: (relPath: string) => void;
}) {
  const sortedFolders = Array.from(node.folders.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const sortedDocs = [...node.docs].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  return (
    <>
      {sortedFolders.map((folder) => {
        const isCollapsed = !forceExpand && !!collapsedFolders[folder.fullPath];
        return (
          <div key={folder.fullPath}>
            <button
              onClick={() => onToggleFolder(folder.fullPath)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs font-medium text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
              )}
              {isCollapsed ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
              )}
              <span className="truncate">{folder.name}</span>
            </button>
            {!isCollapsed && (
              <FolderTreeView
                node={folder}
                depth={depth + 1}
                activePath={activePath}
                pinnedSet={pinnedSet}
                collapsedFolders={collapsedFolders}
                forceExpand={forceExpand}
                onToggleFolder={onToggleFolder}
                onTogglePin={onTogglePin}
                onSelectDocument={onSelectDocument}
              />
            )}
          </div>
        );
      })}
      {sortedDocs.map((doc) => {
        const isSelected = activePath === doc.path;
        const isPinned = pinnedSet.has(doc.path);
        return (
          <div
            key={doc.id}
            style={{ paddingLeft: `${10 + depth * 12}px` }}
            className={`group flex w-full items-center justify-between rounded-lg py-1 pr-2 text-xs transition ${
              isSelected
                ? "bg-indigo-500/15 font-medium text-indigo-200"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <button
              onClick={() => onSelectDocument(doc.path)}
              className="min-w-0 flex-1 truncate py-0.5 text-left"
            >
              {doc.title}
            </button>
            <div className="ml-1.5 flex shrink-0 items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(doc.path);
                }}
                title={isPinned ? "Nicht mehr anpinnen" : "Notiz anpinnen"}
                className={`rounded p-0.5 transition ${
                  isPinned
                    ? "text-amber-400 opacity-90"
                    : "text-zinc-500 opacity-0 hover:text-amber-300 group-hover:opacity-100"
                }`}
              >
                <Pin className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-zinc-600">
                {doc.blockCount}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default App;
