import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  Columns3,
  Download,
  ExternalLink,
  Filter,
  LayoutGrid,
  Pencil,
  Plus,
  SlidersHorizontal,
  Table2,
  X,
  Zap,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { DatabaseQueryResult, DatabaseRow } from "../types/vault";

interface DatabaseViewProps {
  onOpenDocument: (docPath: string) => void;
}

type DatabaseViewMode = "table" | "board" | "gallery";

interface SavedDatabaseView {
  id: string;
  name: string;
  tag: string;
  propKey: string;
  propValue: string;
  viewMode: DatabaseViewMode;
  groupBy: string;
  sortBy: string | null;
  sortDesc: boolean;
}

const PRESET_TAGS = ["", "projekt", "buch", "architektur", "rust", "daily"];
const SAVED_VIEWS_STORAGE_KEY = "oxidevault_saved_views";

function loadSavedViews(): SavedDatabaseView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedDatabaseView =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SavedDatabaseView).id === "string" &&
        typeof (item as SavedDatabaseView).name === "string",
    );
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedDatabaseView[]): void {
  try {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Ignore storage quota / private mode errors
  }
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function DatabaseView({ onOpenDocument }: DatabaseViewProps) {
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [propKey, setPropKey] = useState<string>("");
  const [propValue, setPropValue] = useState<string>("");
  const [viewMode, setViewMode] = useState<DatabaseViewMode>("table");
  const [groupBy, setGroupBy] = useState<string>("status");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState<boolean>(true);
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Column visibility
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [showColumnsMenu, setShowColumnsMenu] = useState<boolean>(false);

  // Inline property editing state
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    docPath: string;
    col: string;
  } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingCell, setSavingCell] = useState<boolean>(false);

  // Saved Views
  const [savedViews, setSavedViews] = useState<SavedDatabaseView[]>(() =>
    loadSavedViews(),
  );
  const [showSaveViewForm, setShowSaveViewForm] = useState<boolean>(false);
  const [newViewName, setNewViewName] = useState<string>("");

  const runQuery = useCallback(async () => {
    setError(null);
    const filters =
      propKey.trim() && propValue.trim()
        ? [
            {
              key: propKey.trim(),
              operator: "contains" as const,
              value: propValue.trim(),
            },
          ]
        : [];

    try {
      const res = await vaultApi.queryDatabase({
        tag: selectedTag || null,
        filters,
        sortBy,
        sortDesc,
      });
      setResult(res);
    } catch (err) {
      setError(String(err));
    }
  }, [selectedTag, propKey, propValue, sortBy, sortDesc]);

  useEffect(() => {
    void runQuery();
  }, [runQuery]);

  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.includes(col)),
    [columns, hiddenColumns],
  );

  const groupByOptions = useMemo(() => {
    const set = new Set<string>(["status", ...columns]);
    return Array.from(set);
  }, [columns]);

  const boardColumns = useMemo(
    () => groupRowsForKanban(rows, groupBy),
    [rows, groupBy],
  );

  const handleToggleSort = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortBy(columnKey);
      setSortDesc(false);
    }
  };

  const toggleColumnVisibility = (col: string) => {
    setHiddenColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const startEditingCell = (row: DatabaseRow, col: string) => {
    setEditingCell({ rowId: row.id, docPath: row.docPath, col });
    setEditingValue(row.properties[col] ?? "");
  };

  const cancelEditingCell = () => {
    setEditingCell(null);
    setEditingValue("");
  };

  const commitEditingCell = async () => {
    if (!editingCell || savingCell) return;
    setSavingCell(true);
    setError(null);
    try {
      await vaultApi.updateDocumentProperty(
        editingCell.docPath,
        editingCell.col,
        editingValue,
      );
      setEditingCell(null);
      setEditingValue("");
      await runQuery();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingCell(false);
    }
  };

  const handleSaveCurrentView = () => {
    const trimmed = newViewName.trim();
    if (!trimmed) return;
    const view: SavedDatabaseView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      tag: selectedTag,
      propKey,
      propValue,
      viewMode,
      groupBy,
      sortBy,
      sortDesc,
    };
    const next = [...savedViews, view];
    setSavedViews(next);
    persistSavedViews(next);
    setNewViewName("");
    setShowSaveViewForm(false);
  };

  const applySavedView = (view: SavedDatabaseView) => {
    setSelectedTag(view.tag);
    setPropKey(view.propKey);
    setPropValue(view.propValue);
    setViewMode(view.viewMode);
    setGroupBy(view.groupBy || "status");
    setSortBy(view.sortBy ?? null);
    setSortDesc(Boolean(view.sortDesc));
  };

  const deleteSavedView = (id: string) => {
    const next = savedViews.filter((v) => v.id !== id);
    setSavedViews(next);
    persistSavedViews(next);
  };

  const handleExportCsv = () => {
    const exportCols = visibleColumns.length > 0 ? visibleColumns : columns;
    const header = ["Titel", "Pfad", "Tags", ...exportCols];
    const lines = [
      header.map(escapeCsvCell).join(","),
      ...rows.map((row) =>
        [
          row.title,
          row.docPath,
          row.tags.join(" "),
          ...exportCols.map((col) => row.properties[col] ?? ""),
        ]
          .map(escapeCsvCell)
          .join(","),
      ),
    ];
    const filename = `oxidevault-database-${selectedTag || "alle"}.csv`;
    downloadBlob(
      `\uFEFF${lines.join("\r\n")}`,
      filename,
      "text/csv;charset=utf-8",
    );
  };

  const handleExportJson = () => {
    const filename = `oxidevault-database-${selectedTag || "alle"}.json`;
    downloadBlob(
      JSON.stringify(rows, null, 2),
      filename,
      "application/json;charset=utf-8",
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">
            Strukturierte Datenbank-Ansichten
          </h1>
          <p className="text-xs text-zinc-400">
            Live-Queries über Frontmatter & Block-Properties (SQLite JSONB) als
            Tabelle, Kanban-Board oder Galerie
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {result && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-mono text-[11px] text-emerald-300">
              <Zap className="h-3 w-3" />
              {result.elapsedUs} µs · {rows.length} Einträge
            </span>
          )}

          {/* Export Buttons */}
          <button
            onClick={handleExportCsv}
            disabled={rows.length === 0}
            title="Gefilterte Zeilen als CSV herunterladen"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:text-indigo-300 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            onClick={handleExportJson}
            disabled={rows.length === 0}
            title="Gefilterte Zeilen als JSON herunterladen"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:text-indigo-300 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </button>

          {/* 3 View Modes */}
          <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "table"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              Tabelle
            </button>
            <button
              onClick={() => setViewMode("board")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "board"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Kanban-Board
            </button>
            <button
              onClick={() => setViewMode("gallery")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "gallery"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Galerie
            </button>
          </div>
        </div>
      </div>

      {/* Saved Views Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/20 px-6 py-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-500">
          <Bookmark className="h-3 w-3" />
          Gespeicherte Ansichten:
        </span>

        {savedViews.map((view) => (
          <div
            key={view.id}
            className="flex items-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 text-[11px] text-zinc-300 transition hover:border-indigo-500/40"
          >
            <button
              onClick={() => applySavedView(view)}
              className="px-2.5 py-1 hover:bg-indigo-500/15 hover:text-indigo-200"
            >
              {view.name}
            </button>
            <button
              onClick={() => deleteSavedView(view.id)}
              title="Gespeicherte Ansicht löschen"
              className="border-l border-zinc-800 px-1.5 py-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {showSaveViewForm ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveCurrentView();
                if (e.key === "Escape") {
                  setShowSaveViewForm(false);
                  setNewViewName("");
                }
              }}
              placeholder="Name der Ansicht..."
              autoFocus
              className="w-40 rounded-lg border border-indigo-500/60 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
            />
            <button
              onClick={handleSaveCurrentView}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Speichern
            </button>
            <button
              onClick={() => {
                setShowSaveViewForm(false);
                setNewViewName("");
              }}
              className="rounded-lg p-1 text-zinc-400 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveViewForm(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-indigo-500/50 hover:text-indigo-300"
          >
            <Plus className="h-3 w-3" />
            Ansicht speichern
          </button>
        )}
      </div>

      {/* Filter & View Controls Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/30 px-6 py-3">
        <Filter className="h-3.5 w-3.5 text-zinc-500" />
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_TAGS.map((tag) => (
            <button
              key={tag || "all"}
              onClick={() => setSelectedTag(tag)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                selectedTag === tag
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {tag ? `#${tag}` : "Alle Notizen"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {viewMode === "board" && (
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span>Gruppieren nach:</span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              >
                {groupByOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Column Visibility Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowColumnsMenu((prev) => !prev)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                showColumnsMenu || hiddenColumns.length > 0
                  ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Spalten
              {hiddenColumns.length > 0 && (
                <span className="rounded-full bg-indigo-500/30 px-1.5 text-[10px]">
                  {visibleColumns.length}/{columns.length}
                </span>
              )}
            </button>

            {showColumnsMenu && (
              <div className="absolute right-0 z-20 mt-1.5 w-52 rounded-xl border border-zinc-800 bg-zinc-900 p-2 shadow-xl">
                <div className="mb-1.5 flex items-center justify-between px-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Sichtbare Spalten
                  </span>
                  {hiddenColumns.length > 0 && (
                    <button
                      onClick={() => setHiddenColumns([])}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300"
                    >
                      Alle zeigen
                    </button>
                  )}
                </div>
                {columns.length === 0 ? (
                  <div className="px-1.5 py-2 text-[11px] text-zinc-500">
                    Keine Properties vorhanden
                  </div>
                ) : (
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {columns.map((col) => {
                      const visible = !hiddenColumns.includes(col);
                      return (
                        <label
                          key={col}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          <input
                            type="checkbox"
                            checked={visible}
                            onChange={() => toggleColumnVisibility(col)}
                            className="accent-indigo-500"
                          />
                          <span className="truncate font-mono text-[11px]">
                            {col}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <input
            value={propKey}
            onChange={(e) => setPropKey(e.target.value)}
            placeholder="Property (z.B. author)"
            className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
          <input
            value={propValue}
            onChange={(e) => setPropValue(e.target.value)}
            placeholder="enthält Wert..."
            className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Main Content */}
      <div
        className="flex-1 overflow-auto p-6"
        onClick={() => {
          if (showColumnsMenu) setShowColumnsMenu(false);
        }}
      >
        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {viewMode === "table" ? (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80 text-[11px] uppercase tracking-wider text-zinc-400">
                  <th className="px-4 py-3 font-semibold">
                    <button
                      onClick={() => handleToggleSort("title")}
                      className="inline-flex items-center gap-1 transition hover:text-zinc-100"
                    >
                      <span>Dokument</span>
                      <SortIndicator
                        active={sortBy === "title"}
                        desc={sortDesc}
                      />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-semibold">Tags</th>
                  {visibleColumns.map((col) => (
                    <th key={col} className="px-4 py-3 font-semibold">
                      <button
                        onClick={() => handleToggleSort(col)}
                        className="inline-flex items-center gap-1 transition hover:text-zinc-100"
                      >
                        <span>{col}</span>
                        <SortIndicator
                          active={sortBy === col}
                          desc={sortDesc}
                        />
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length + 3}
                      className="px-4 py-10 text-center text-zinc-500"
                    >
                      Keine Einträge für diese Abfrage gefunden.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="transition hover:bg-zinc-900/60"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-100">
                          {row.title}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {row.docPath}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      </td>
                      {visibleColumns.map((col) => {
                        const isEditing =
                          editingCell?.rowId === row.id &&
                          editingCell?.col === col;

                        return (
                          <td key={col} className="px-4 py-3 text-zinc-300">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={editingValue}
                                  disabled={savingCell}
                                  autoFocus
                                  onChange={(e) =>
                                    setEditingValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      void commitEditingCell();
                                    } else if (e.key === "Escape") {
                                      cancelEditingCell();
                                    }
                                  }}
                                  className="w-32 rounded border border-indigo-500 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-100 outline-none"
                                />
                                <button
                                  onClick={() => void commitEditingCell()}
                                  disabled={savingCell}
                                  title="Speichern"
                                  className="rounded bg-indigo-600 p-1 text-white hover:bg-indigo-500 disabled:opacity-50"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={cancelEditingCell}
                                  disabled={savingCell}
                                  title="Abbrechen"
                                  className="rounded bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditingCell(row, col)}
                                title={`Property „${col}“ bearbeiten`}
                                className="group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-zinc-800/80"
                              >
                                {row.properties[col] ? (
                                  <span className="rounded bg-zinc-800/90 px-2 py-0.5 font-mono text-[11px]">
                                    {row.properties[col]}
                                  </span>
                                ) : (
                                  <span className="text-zinc-600">—</span>
                                )}
                                <Pencil className="h-2.5 w-2.5 text-zinc-500 opacity-0 transition group-hover:opacity-100" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => onOpenDocument(row.docPath)}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-indigo-500/40 hover:text-indigo-300"
                        >
                          Öffnen
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : viewMode === "board" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {boardColumns.map(([groupLabel, groupRows]) => (
              <div
                key={groupLabel}
                className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    {groupLabel}
                  </span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                    {groupRows.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {groupRows.map((row) => (
                    <button
                      key={row.id}
                      onClick={() => onOpenDocument(row.docPath)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-left transition hover:border-indigo-500/50"
                    >
                      <div className="text-sm font-medium text-zinc-100">
                        {row.title}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {row.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
                        {Object.entries(row.properties)
                          .filter(([k]) => !hiddenColumns.includes(k))
                          .slice(0, 3)
                          .map(([k, v]) => (
                            <div
                              key={k}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-zinc-500">{k}:</span>
                              <span className="truncate font-mono text-zinc-300">
                                {v}
                              </span>
                            </div>
                          ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Gallery View */
          rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">
              Keine Einträge für diese Galerie-Ansicht gefunden.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.map((row) => {
                const propEntries = Object.entries(row.properties).filter(
                  ([k, v]) => !hiddenColumns.includes(k) && v.trim() !== "",
                );
                return (
                  <div
                    key={row.id}
                    onClick={() => onOpenDocument(row.docPath)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenDocument(row.docPath);
                      }
                    }}
                    className="group flex cursor-pointer flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-indigo-500/50 hover:bg-zinc-900"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-indigo-200">
                          {row.title}
                        </h3>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-indigo-300" />
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                        {row.docPath}
                      </div>

                      {row.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {row.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {propEntries.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-800/80 pt-3">
                        {propEntries.map(([k, v]) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px]"
                          >
                            <span className="text-zinc-500">{k}:</span>
                            <span className="font-mono text-zinc-200">{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function SortIndicator({ active, desc }: { active: boolean; desc: boolean }) {
  if (!active) {
    return <ArrowUpDown className="h-3 w-3 text-zinc-600" />;
  }
  return desc ? (
    <ArrowDown className="h-3 w-3 text-indigo-400" />
  ) : (
    <ArrowUp className="h-3 w-3 text-indigo-400" />
  );
}

function groupRowsForKanban(
  rows: DatabaseRow[],
  groupByProp: string,
): Array<[string, DatabaseRow[]]> {
  const prop = groupByProp.trim() || "status";
  const buckets = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const value = row.properties[prop]?.trim() || `ohne ${prop}`;
    const list = buckets.get(value) ?? [];
    list.push(row);
    buckets.set(value, list);
  }
  return Array.from(buckets.entries());
}
