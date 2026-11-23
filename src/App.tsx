import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code2,
  Columns2,
  Compass,
  Contrast,
  Database,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderSync,
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
import {
  CommandPalette,
  type CommandPaletteAction,
} from "./components/CommandPalette";
import { HybridEditor } from "./components/HybridEditor";
import type {
  Block,
  DocumentSummary,
  DocumentWithBlocks,
  VaultOverview,
} from "./types/vault";

const GraphView = lazy(() =>
  import("./components/GraphView").then((m) => ({ default: m.GraphView })),
);
const InfiniteCanvas = lazy(() =>
  import("./components/InfiniteCanvas").then((m) => ({
    default: m.InfiniteCanvas,
  })),
);
const TasksCalendarView = lazy(() =>
  import("./components/TasksCalendarView").then((m) => ({
    default: m.TasksCalendarView,
  })),
);
const DatabaseView = lazy(() =>
  import("./components/DatabaseView").then((m) => ({
    default: m.DatabaseView,
  })),
);
const SyncBenchmarkModal = lazy(() =>
  import("./components/SyncBenchmarkModal").then((m) => ({
    default: m.SyncBenchmarkModal,
  })),
);
const TrashModal = lazy(() =>
  import("./components/TrashModal").then((m) => ({ default: m.TrashModal })),
);
const AnalyticsModal = lazy(() =>
  import("./components/AnalyticsModal").then((m) => ({
    default: m.AnalyticsModal,
  })),
);
const QuickCaptureModal = lazy(() =>
  import("./components/QuickCaptureModal").then((m) => ({
    default: m.QuickCaptureModal,
  })),
);
const ShortcutsModal = lazy(() =>
  import("./components/ShortcutsModal").then((m) => ({
    default: m.ShortcutsModal,
  })),
);
const VaultSwitcherModal = lazy(() =>
  import("./components/VaultSwitcherModal").then((m) => ({
    default: m.VaultSwitcherModal,
  })),
);

type ActiveView = "editor" | "tasks" | "database" | "graph" | "canvas";
type ThemeMode = "dark" | "light" | "high-contrast";
type SplitMode = "off" | "doc" | "graph";
type SplitReaderMode = "rendered" | "markdown";

const VIEW_SUSPENSE_FALLBACK = (
  <div className="flex h-full items-center justify-center text-xs text-zinc-500">
    Lade Ansicht...
  </div>
);

function getVaultBaseName(vaultPath?: string): string {
  if (!vaultPath) return "Vault";
  const cleaned = vaultPath.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || vaultPath;
}

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
  const [vaultSwitcherOpen, setVaultSwitcherOpen] = useState(false);

  const [splitMode, setSplitMode] = useState<SplitMode>("off");
  const [splitDoc, setSplitDoc] = useState<DocumentWithBlocks | null>(null);
  const [splitReaderMode, setSplitReaderMode] =
    useState<SplitReaderMode>("rendered");
  const [splitDocLoading, setSplitDocLoading] = useState(false);

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

  const openSplitDocument = useCallback(async (path: string) => {
    setSplitDocLoading(true);
    setActionError(null);
    try {
      const doc = await vaultApi.getDocument(path);
      setSplitDoc(doc);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Split-Dokument konnte nicht geladen werden.",
      );
    } finally {
      setSplitDocLoading(false);
    }
  }, []);

  const activateSplitDoc = useCallback(() => {
    setActiveView("editor");
    setSplitMode("doc");
    if (
      !splitDoc ||
      !documents.some((d) => d.path === splitDoc.document.path)
    ) {
      const candidate =
        documents.find((d) => d.path !== activeDoc?.document.path) ??
        documents[0];
      if (candidate) {
        void openSplitDocument(candidate.path);
      }
    }
  }, [activeDoc?.document.path, documents, openSplitDocument, splitDoc]);

  const cycleSplitMode = useCallback(() => {
    if (splitMode === "off") {
      activateSplitDoc();
    } else if (splitMode === "doc") {
      setActiveView("editor");
      setSplitMode("graph");
    } else {
      setSplitMode("off");
    }
  }, [activateSplitDoc, splitMode]);

  const handleVaultSwitched = useCallback(
    async (newOverview: VaultOverview) => {
      navIndexRef.current = -1;
      setNavHistory([]);
      setNavIndex(-1);
      setActiveDoc(null);
      setSplitDoc(null);
      setOverview(newOverview);
      lastRevisionRef.current = newOverview.revision;
      if (newOverview.canvasFiles.length > 0) {
        setActiveCanvasPath(newOverview.canvasFiles[0]);
      }
      const docs = await refreshVault();
      setActiveView("editor");
      if (docs.length > 0) {
        const preferred =
          docs.find((d) => d.path === "Willkommen in OxideVault.md") ?? docs[0];
        await openDocument(preferred.path);
        if (splitMode === "doc") {
          const secondary =
            docs.find((d) => d.path !== preferred.path) ?? preferred;
          await openSplitDocument(secondary.path);
        }
      }
    },
    [openDocument, openSplitDocument, refreshVault, splitMode],
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
      setSplitDoc((curr) =>
        curr && curr.document.path === relPath ? null : curr,
      );
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
    setSplitDoc((curr) =>
      curr && curr.document.path === oldRelPath ? renamed : curr,
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
        id: "toggle-split-view",
        label: "Split-View umschalten",
        description: `Aktuell: ${
          splitMode === "off"
            ? "Aus"
            : splitMode === "doc"
              ? "Zweite Notiz"
              : "Graph"
        } (Aus → Notiz → Graph)`,
        run: cycleSplitMode,
      },
      {
        id: "switch-vault",
        label: "Vault wechseln...",
        description:
          "Anderen Cloud-Safe Vault-Ordner mit eigenem lokalen SQLite-Cache öffnen",
        run: () => setVaultSwitcherOpen(true),
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
      cycleSplitMode,
      cycleTheme,
      handleOpenDaily,
      handleOpenRandomNote,
      isZenMode,
      refreshVault,
      splitMode,
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
                  <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-zinc-100">
                    <span>OxideVault</span>
                    <span
                      title="Version 0.1.0-alpha.1 (Pre-Release)"
                      className="rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wide text-amber-300"
                    >
                      alpha
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    v0.1.0-alpha.1 • SQLite FTS5
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

            {/* Search, Quick Capture & Split-View Triggers */}
            <div className="flex gap-1.5 p-3">
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Search className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span className="truncate">Suche...</span>
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
              <button
                onClick={cycleSplitMode}
                title={`Split-View umschalten (Aktuell: ${
                  splitMode === "off"
                    ? "Aus"
                    : splitMode === "doc"
                      ? "Notiz"
                      : "Graph"
                })`}
                className={`flex shrink-0 items-center justify-center rounded-xl border px-2.5 transition ${
                  splitMode !== "off"
                    ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-indigo-500/40 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
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

            {/* Utility, Vault Switcher, Sync & Benchmark Actions */}
            <div className="space-y-1.5 border-t border-zinc-800/80 p-3">
              <button
                onClick={() => setVaultSwitcherOpen(true)}
                title={overview?.vaultPath ?? "Vault wechseln"}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-indigo-500/40 hover:bg-zinc-900"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FolderSync className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span className="truncate font-medium">
                    {getVaultBaseName(overview?.vaultPath)}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-indigo-300">
                  Wechseln
                </span>
              </button>
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
            splitMode === "off" ? (
              <HybridEditor
                docBundle={activeDoc}
                allDocuments={documents}
                onSaved={async (updated) => {
                  setActiveDoc(updated);
                  setSplitDoc((curr) =>
                    curr && curr.document.path === updated.document.path
                      ? updated
                      : curr,
                  );
                  await refreshVault();
                }}
                onNavigate={(target) => void openDocument(target)}
                onDeleteDocument={handleDeleteDocument}
                onRenameDocument={handleRenameDocument}
                isZenMode={isZenMode}
                onToggleZenMode={() => setIsZenMode((v) => !v)}
              />
            ) : (
              <div className="grid h-full min-h-0 grid-cols-1 divide-y divide-zinc-800/80 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                <div className="min-h-0 min-w-0 overflow-hidden">
                  <HybridEditor
                    docBundle={activeDoc}
                    allDocuments={documents}
                    onSaved={async (updated) => {
                      setActiveDoc(updated);
                      setSplitDoc((curr) =>
                        curr && curr.document.path === updated.document.path
                          ? updated
                          : curr,
                      );
                      await refreshVault();
                    }}
                    onNavigate={(target) => void openDocument(target)}
                    onDeleteDocument={handleDeleteDocument}
                    onRenameDocument={handleRenameDocument}
                    isZenMode={isZenMode}
                    onToggleZenMode={() => setIsZenMode((v) => !v)}
                  />
                </div>
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-zinc-950">
                  {splitMode === "doc" ? (
                    <SplitDocumentPane
                      documents={documents}
                      splitDoc={splitDoc}
                      loading={splitDocLoading}
                      readerMode={splitReaderMode}
                      onChangeReaderMode={setSplitReaderMode}
                      onSelectDocument={(path) => void openSplitDocument(path)}
                      onOpenInMain={(path) => void openDocument(path)}
                      onSwitchToGraph={() => setSplitMode("graph")}
                      onClose={() => setSplitMode("off")}
                    />
                  ) : (
                    <>
                      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                          <Compass className="h-3.5 w-3.5 text-indigo-400" />
                          <span>Split-Graph</span>
                          <span className="hidden truncate text-[11px] text-zinc-500 sm:inline">
                            • {activeDoc.document.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={activateSplitDoc}
                            title="Zur zweiten Notiz wechseln"
                            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-indigo-500/40 hover:text-indigo-200"
                          >
                            <FileText className="h-3 w-3" />
                            <span>Notiz</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSplitMode("off")}
                            title="Split-View schließen"
                            aria-label="Split-View schließen"
                            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <Suspense fallback={VIEW_SUSPENSE_FALLBACK}>
                          <GraphView
                            onOpenDocument={(p) => void openDocument(p)}
                            activeDocId={activeDoc?.document.id ?? null}
                          />
                        </Suspense>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          )}

          {!backendError && activeView === "editor" && !activeDoc && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-zinc-400">
              <FileText className="h-8 w-8 text-zinc-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-200">
                  Keine Notiz geöffnet
                </p>
                <p className="text-xs text-zinc-500">
                  Erstelle eine neue Notiz in diesem Vault oder wechsle zu einem
                  anderen Vault-Ordner.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreatingNote(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-indigo-500"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Neue Notiz
                </button>
                <button
                  type="button"
                  onClick={() => setVaultSwitcherOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40"
                >
                  <FolderSync className="h-3.5 w-3.5 text-indigo-400" />
                  Vault wechseln
                </button>
              </div>
            </div>
          )}

          {!backendError && activeView === "tasks" && (
            <Suspense fallback={VIEW_SUSPENSE_FALLBACK}>
              <TasksCalendarView
                onOpenDocument={(p) => void openDocument(p)}
                onOpenDaily={(d) => void handleOpenDaily(d)}
                onTasksChanged={async () => {
                  await refreshVault();
                }}
              />
            </Suspense>
          )}

          {!backendError && activeView === "database" && (
            <Suspense fallback={VIEW_SUSPENSE_FALLBACK}>
              <DatabaseView onOpenDocument={(p) => void openDocument(p)} />
            </Suspense>
          )}

          {!backendError && activeView === "graph" && (
            <Suspense fallback={VIEW_SUSPENSE_FALLBACK}>
              <GraphView
                onOpenDocument={(p) => void openDocument(p)}
                activeDocId={activeDoc?.document.id ?? null}
              />
            </Suspense>
          )}

          {!backendError && activeView === "canvas" && (
            <Suspense fallback={VIEW_SUSPENSE_FALLBACK}>
              <InfiniteCanvas
                canvasPath={activeCanvasPath}
                documents={documents}
                onOpenDocument={(p) => void openDocument(p)}
                onCanvasListChanged={async () => {
                  await refreshVault();
                }}
                onSelectCanvas={(p) => setActiveCanvasPath(p)}
              />
            </Suspense>
          )}
        </main>
      </div>

      {/* Bottom Engine Status Bar (hidden in Zen Mode) */}
      {!isZenMode && (
        <footer className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-950 px-4 py-1.5 text-[11px] text-zinc-500">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {isTauriRuntime() ? "Tauri v2 Native" : "Rust Core API"}
            </span>
            <button
              type="button"
              onClick={() => setVaultSwitcherOpen(true)}
              title="Klicken zum Wechseln des Vaults"
              className="hidden min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-left transition hover:bg-zinc-900 hover:text-zinc-200 sm:inline-flex"
            >
              <FolderSync className="h-3 w-3 shrink-0 text-indigo-400" />
              <span className="shrink-0">Vault (Cloud-Safe):</span>
              <code className="truncate text-zinc-300">
                {overview?.vaultPath ?? "—"}
              </code>
            </button>
            <span className="hidden truncate lg:inline">
              Lokaler SQLite-Cache:{" "}
              <code className="text-zinc-400">{overview?.dbPath ?? "—"}</code>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3 font-mono">
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

      <Suspense fallback={null}>
        {modalState.open && (
          <SyncBenchmarkModal
            isOpen={modalState.open}
            initialTab={modalState.tab}
            onClose={() => setModalState((s) => ({ ...s, open: false }))}
            syncStatus={overview?.syncStatus ?? null}
            onRefresh={async () => {
              await refreshVault();
            }}
          />
        )}

        {trashOpen && (
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
        )}

        {analyticsOpen && (
          <AnalyticsModal
            isOpen={analyticsOpen}
            onClose={() => setAnalyticsOpen(false)}
            onOpenDocument={(target) => void openDocument(target)}
          />
        )}

        {quickCaptureOpen && (
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
        )}

        {shortcutsOpen && (
          <ShortcutsModal
            isOpen={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
          />
        )}

        {vaultSwitcherOpen && (
          <VaultSwitcherModal
            isOpen={vaultSwitcherOpen}
            currentVaultPath={overview?.vaultPath ?? ""}
            currentDbPath={overview?.dbPath ?? ""}
            onClose={() => setVaultSwitcherOpen(false)}
            onSwitched={handleVaultSwitched}
          />
        )}
      </Suspense>
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

function SplitDocumentPane({
  documents,
  splitDoc,
  loading,
  readerMode,
  onChangeReaderMode,
  onSelectDocument,
  onOpenInMain,
  onSwitchToGraph,
  onClose,
}: {
  documents: DocumentSummary[];
  splitDoc: DocumentWithBlocks | null;
  loading: boolean;
  readerMode: SplitReaderMode;
  onChangeReaderMode: (mode: SplitReaderMode) => void;
  onSelectDocument: (path: string) => void;
  onOpenInMain: (path: string) => void;
  onSwitchToGraph: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {/* Split Reader Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          <select
            aria-label="Notiz für Split-View auswählen"
            value={splitDoc?.document.path ?? ""}
            onChange={(e) => {
              if (e.target.value) onSelectDocument(e.target.value);
            }}
            className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500/60"
          >
            {documents.length === 0 ? (
              <option value="">Keine Notizen vorhanden</option>
            ) : (
              <>
                {!splitDoc && <option value="">Notiz auswählen...</option>}
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.path}>
                    {doc.title} ({doc.path})
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {splitDoc && (
            <button
              type="button"
              onClick={() => onOpenInMain(splitDoc.document.path)}
              title="Diese Notiz im Haupteditor öffnen"
              className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-indigo-500/40 hover:text-indigo-200"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">Haupteditor</span>
            </button>
          )}

          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/70 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => onChangeReaderMode("rendered")}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition ${
                readerMode === "rendered"
                  ? "bg-indigo-500/20 font-medium text-indigo-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <BookOpen className="h-3 w-3" />
              <span>Gelesen</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeReaderMode("markdown")}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition ${
                readerMode === "markdown"
                  ? "bg-indigo-500/20 font-medium text-indigo-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Code2 className="h-3 w-3" />
              <span>Markdown</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onSwitchToGraph}
            title="Stattdessen Split-Graph anzeigen"
            className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-1 text-zinc-400 transition hover:border-indigo-500/40 hover:text-indigo-300"
          >
            <Compass className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Split-View schließen"
            aria-label="Split-View schließen"
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Split Reader Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Lade Notiz...
          </div>
        ) : !splitDoc ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-zinc-500">
            <FileText className="h-6 w-6 text-zinc-600" />
            <span>Wähle oben eine Notiz für die parallele Ansicht aus.</span>
          </div>
        ) : readerMode === "markdown" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800/70 pb-2">
              <h2 className="truncate text-sm font-semibold text-zinc-100">
                {splitDoc.document.title}
              </h2>
              <code className="ml-2 shrink-0 text-[11px] text-zinc-500">
                {splitDoc.document.path}
              </code>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4 font-mono text-xs leading-relaxed text-zinc-300">
              {splitDoc.rawMarkdown}
            </pre>
          </div>
        ) : (
          <article className="mx-auto max-w-2xl space-y-3">
            <header className="space-y-1.5 border-b border-zinc-800/70 pb-3">
              <h2 className="text-xl font-bold tracking-tight text-zinc-100">
                {splitDoc.document.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <code className="font-mono">{splitDoc.document.path}</code>
                {splitDoc.document.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </header>

            {splitDoc.blocks.length === 0 ? (
              <p className="text-xs italic text-zinc-500">
                Diese Notiz enthält noch keine Blöcke.
              </p>
            ) : (
              <div className="space-y-2">
                {splitDoc.blocks.map((block) => (
                  <SplitReadOnlyBlock key={block.id} block={block} />
                ))}
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}

function SplitReadOnlyBlock({ block }: { block: Block }) {
  const indentPx = Math.min(block.depth, 6) * 16;

  if (block.blockType === "divider") {
    return <hr className="my-3 border-zinc-800" />;
  }

  if (block.blockType === "heading") {
    const level = block.headingLevel ?? 2;
    const headingClass =
      level <= 1
        ? "pt-2 text-lg font-bold text-zinc-100"
        : level === 2
          ? "pt-1.5 text-base font-semibold text-zinc-100"
          : "pt-1 text-sm font-semibold text-zinc-200";
    return <div className={headingClass}>{block.plainText}</div>;
  }

  if (block.blockType === "taskItem") {
    const status = block.task?.status ?? "TODO";
    const isDone = status === "DONE";
    const isCanceled = status === "CANCELED";
    const isDoing = status === "DOING";
    return (
      <div
        style={{ paddingLeft: `${indentPx}px` }}
        className="flex items-start gap-2.5 text-sm leading-relaxed"
      >
        <span
          className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
            isDone
              ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
              : isDoing
                ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                : isCanceled
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
                  : "border-zinc-700 bg-zinc-900 text-transparent"
          }`}
        >
          {isDone ? (
            <Check className="h-3 w-3" />
          ) : isDoing ? (
            "•"
          ) : isCanceled ? (
            "×"
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <span
            className={
              isDone || isCanceled
                ? "text-zinc-500 line-through"
                : "text-zinc-200"
            }
          >
            {block.plainText}
          </span>
          {(block.task?.priority || block.task?.scheduledAt) && (
            <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px]">
              {block.task.priority && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-amber-300">
                  P{block.task.priority}
                </span>
              )}
              {block.task.scheduledAt && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-sky-300">
                  {block.task.scheduledAt}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (block.blockType === "listItem") {
    return (
      <div
        style={{ paddingLeft: `${indentPx}px` }}
        className="flex items-start gap-2 text-sm leading-relaxed text-zinc-200"
      >
        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400/70" />
        <span className="min-w-0 flex-1">{block.plainText}</span>
      </div>
    );
  }

  if (block.blockType === "codeBlock") {
    return (
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70">
        {block.codeLang && (
          <div className="border-b border-zinc-800 px-3 py-1 font-mono text-[10px] uppercase text-zinc-500">
            {block.codeLang}
          </div>
        )}
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-300">
          {block.rawContent}
        </pre>
      </div>
    );
  }

  if (block.blockType === "quote") {
    return (
      <blockquote className="border-l-2 border-indigo-500/60 pl-3 text-sm italic leading-relaxed text-zinc-300">
        {block.plainText}
      </blockquote>
    );
  }

  if (block.blockType === "callout") {
    return (
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-indigo-100">
        {block.plainText}
      </div>
    );
  }

  return (
    <p
      style={{ paddingLeft: `${indentPx}px` }}
      className="text-sm leading-relaxed text-zinc-200"
    >
      {block.plainText}
    </p>
  );
}

export default App;
