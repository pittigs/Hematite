import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Coffee,
  ExternalLink,
  Flame,
  Kanban,
  List,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Target,
  Timer,
  X,
  XCircle,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { TaskStatus, TaskViewItem } from "../types/vault";

interface TasksCalendarViewProps {
  onOpenDocument: (docPath: string) => void;
  onOpenDaily: (date?: string) => void;
  onTasksChanged: () => Promise<void>;
}

type ViewMode = "list" | "kanban" | "calendar";
type StatusFilter = "open" | "today" | "overdue" | "done" | "all";
type PriorityFilter = "all" | "1" | "2" | "3";
type SortOption = "default" | "deadline" | "priority" | "document";
type PomodoroMode = "focus" | "break";

const KANBAN_COLUMNS: ReadonlyArray<{
  status: TaskStatus;
  label: string;
  accentClass: string;
  badgeClass: string;
}> = [
  {
    status: "TODO",
    label: "TODO",
    accentClass: "border-zinc-700/80",
    badgeClass: "bg-zinc-800 text-zinc-300",
  },
  {
    status: "DOING",
    label: "DOING",
    accentClass: "border-amber-500/40",
    badgeClass: "bg-amber-500/20 text-amber-300",
  },
  {
    status: "DONE",
    label: "DONE",
    accentClass: "border-emerald-500/40",
    badgeClass: "bg-emerald-500/20 text-emerald-300",
  },
  {
    status: "CANCELED",
    label: "CANCELED",
    accentClass: "border-zinc-800",
    badgeClass: "bg-zinc-800/80 text-zinc-500",
  },
];

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDatePrefix(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length < 10) return null;
  return trimmed.slice(0, 10);
}

function getDueState(
  task: TaskViewItem,
  todayStr: string,
): "overdue" | "today" | null {
  if (task.status === "DONE" || task.status === "CANCELED") return null;
  const deadline = normalizeDatePrefix(task.deadlineAt);
  const scheduled = normalizeDatePrefix(task.scheduledAt);
  if ((deadline && deadline < todayStr) || (scheduled && scheduled < todayStr)) {
    return "overdue";
  }
  if (deadline === todayStr || scheduled === todayStr) {
    return "today";
  }
  return null;
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

interface CalendarCell {
  dateStr: string;
  dayNumber: number;
  inCurrentMonth: boolean;
}

function buildMonthGrid(year: number, monthIndex: number): CalendarCell[] {
  const firstDay = new Date(year, monthIndex, 1);
  // Monday = 0 ... Sunday = 6
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i += 1) {
    const cellDate = new Date(year, monthIndex, 1 - startOffset + i);
    cells.push({
      dateStr: formatLocalDate(cellDate),
      dayNumber: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === monthIndex,
    });
  }
  return cells;
}

export function TasksCalendarView({
  onOpenDocument,
  onOpenDaily,
  onTasksChanged,
}: TasksCalendarViewProps) {
  const [tasks, setTasks] = useState<TaskViewItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const [loading, setLoading] = useState(true);

  // Drag & Drop state for Kanban
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState<{
    year: number;
    month: number;
  }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Pomodoro state
  const [pomodoroMode, setPomodoroMode] = useState<PomodoroMode>("focus");
  const [secondsLeft, setSecondsLeft] = useState<number>(FOCUS_SECONDS);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

  const focusedTask = useMemo(
    () =>
      focusedTaskId
        ? (tasks.find((t) => t.blockId === focusedTaskId) ?? null)
        : null,
    [tasks, focusedTaskId],
  );

  const todayStr = formatLocalDate(new Date());

  const loadTasks = async () => {
    setLoading(true);
    try {
      const list = await vaultApi.getTasks();
      setTasks(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  // Pomodoro interval
  useEffect(() => {
    if (!timerRunning) return;
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  const switchPomodoroMode = (mode: PomodoroMode) => {
    setPomodoroMode(mode);
    setTimerRunning(false);
    setSecondsLeft(mode === "focus" ? FOCUS_SECONDS : BREAK_SECONDS);
  };

  const resetPomodoro = () => {
    setTimerRunning(false);
    setSecondsLeft(pomodoroMode === "focus" ? FOCUS_SECONDS : BREAK_SECONDS);
  };

  const handleFocusTask = (task: TaskViewItem) => {
    setFocusedTaskId(task.blockId);
    if (pomodoroMode !== "focus") {
      setPomodoroMode("focus");
      setSecondsLeft(FOCUS_SECONDS);
      setTimerRunning(false);
    }
  };

  const updateTaskStatus = async (blockId: string, nextStatus: TaskStatus) => {
    await vaultApi.toggleTaskStatus(blockId, nextStatus);
    await loadTasks();
    await onTasksChanged();
  };

  const cycleStatus = async (item: TaskViewItem) => {
    const next: TaskStatus =
      item.status === "TODO"
        ? "DOING"
        : item.status === "DOING"
          ? "DONE"
          : "TODO";
    await updateTaskStatus(item.blockId, next);
  };

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const task of tasks) {
      for (const tag of task.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, "de"));
  }, [tasks]);

  // Shared attribute filters (search, priority, tag) + sorting
  const baseFilteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matched = tasks.filter((task) => {
      if (q) {
        const inContent = task.content.toLowerCase().includes(q);
        const inDoc = task.docTitle.toLowerCase().includes(q);
        const inPath = task.docPath.toLowerCase().includes(q);
        const inTags = task.tags.some((t) => t.toLowerCase().includes(q));
        if (!inContent && !inDoc && !inPath && !inTags) return false;
      }

      if (priorityFilter !== "all") {
        if (String(task.priority ?? "") !== priorityFilter) return false;
      }

      if (tagFilter !== "all") {
        if (!task.tags.includes(tagFilter)) return false;
      }

      return true;
    });

    if (sortBy === "default") return matched;

    return [...matched].sort((a, b) => {
      if (sortBy === "deadline") {
        const aDate =
          normalizeDatePrefix(a.deadlineAt) ??
          normalizeDatePrefix(a.scheduledAt) ??
          "9999-12-31";
        const bDate =
          normalizeDatePrefix(b.deadlineAt) ??
          normalizeDatePrefix(b.scheduledAt) ??
          "9999-12-31";
        return aDate.localeCompare(bDate);
      }
      if (sortBy === "priority") {
        const aP = a.priority ?? 99;
        const bP = b.priority ?? 99;
        return aP - bP;
      }
      return a.docTitle.localeCompare(b.docTitle, "de");
    });
  }, [tasks, searchQuery, priorityFilter, tagFilter, sortBy]);

  const listFiltered = useMemo(() => {
    return baseFilteredAndSorted.filter((task) => {
      if (statusFilter === "open") {
        return task.status === "TODO" || task.status === "DOING";
      }
      if (statusFilter === "today") {
        return getDueState(task, todayStr) === "today";
      }
      if (statusFilter === "overdue") {
        return getDueState(task, todayStr) === "overdue";
      }
      if (statusFilter === "done") {
        return task.status === "DONE" || task.status === "CANCELED";
      }
      return true;
    });
  }, [baseFilteredAndSorted, statusFilter, todayStr]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, TaskViewItem[]> = {
      TODO: [],
      DOING: [],
      DONE: [],
      CANCELED: [],
    };
    for (const task of baseFilteredAndSorted) {
      grouped[task.status].push(task);
    }
    return grouped;
  }, [baseFilteredAndSorted]);

  const calendarCells = useMemo(
    () => buildMonthGrid(calendarMonth.year, calendarMonth.month),
    [calendarMonth.year, calendarMonth.month],
  );

  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskViewItem[]>();
    for (const task of listFiltered) {
      const dates = new Set<string>();
      const scheduled = normalizeDatePrefix(task.scheduledAt);
      const deadline = normalizeDatePrefix(task.deadlineAt);
      if (scheduled) dates.add(scheduled);
      if (deadline) dates.add(deadline);
      for (const d of dates) {
        const existing = map.get(d) ?? [];
        existing.push(task);
        map.set(d, existing);
      }
    }
    return map;
  }, [listFiltered]);

  const openCount = tasks.filter(
    (t) => t.status === "TODO" || t.status === "DOING",
  ).length;
  const doingCount = tasks.filter((t) => t.status === "DOING").length;
  const doneCount = tasks.filter((t) => t.status === "DONE").length;
  const overdueCount = tasks.filter(
    (t) => getDueState(t, todayStr) === "overdue",
  ).length;

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    blockId: string,
  ) => {
    e.dataTransfer.setData("text/plain", blockId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingBlockId(blockId);
  };

  const handleDropOnColumn = async (
    e: React.DragEvent<HTMLDivElement>,
    targetStatus: TaskStatus,
  ) => {
    e.preventDefault();
    const blockId = e.dataTransfer.getData("text/plain") || draggingBlockId;
    setDragOverColumn(null);
    setDraggingBlockId(null);
    if (!blockId) return;

    const task = tasks.find((t) => t.blockId === blockId);
    if (!task || task.status === targetStatus) return;

    await updateTaskStatus(blockId, targetStatus);
  };

  const navigateMonth = (delta: number) => {
    setCalendarMonth((prev) => {
      const nextDate = new Date(prev.year, prev.month + delta, 1);
      return { year: nextDate.getFullYear(), month: nextDate.getMonth() };
    });
  };

  const jumpToCurrentMonth = () => {
    const now = new Date();
    setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() });
  };

  const monthHeading = new Date(
    calendarMonth.year,
    calendarMonth.month,
    1,
  ).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  const totalDuration =
    pomodoroMode === "focus" ? FOCUS_SECONDS : BREAK_SECONDS;
  const timerProgress = Math.round(
    ((totalDuration - secondsLeft) / totalDuration) * 100,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">
            Aufgaben & Zeitplanung
          </h1>
          <p className="text-xs text-zinc-400">
            Alle Inline-Tasks live über SQLite aggregiert ({openCount} offen,{" "}
            {doingCount} aktiv, {doneCount} erledigt
            {overdueCount > 0 ? `, ${overdueCount} überfällig` : ""})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Switcher */}
          <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
            {(
              [
                ["list", "Liste", List],
                ["kanban", "Kanban", Kanban],
                ["calendar", "Kalender", Calendar],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === mode
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => onOpenDaily(todayStr)}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Heutige Daily Note ({todayStr})
          </button>
        </div>
      </div>

      {/* Pomodoro Focus Timer Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/70 bg-zinc-900/40 px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <Timer className="h-4 w-4 text-indigo-400" />
            <span>Pomodoro</span>
          </div>

          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
            <button
              onClick={() => switchPomodoroMode("focus")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                pomodoroMode === "focus"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Target className="h-3 w-3" />
              25:00 Fokus
            </button>
            <button
              onClick={() => switchPomodoroMode("break")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                pomodoroMode === "break"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Coffee className="h-3 w-3" />
              05:00 Pause
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1">
            <span
              className={`font-mono text-sm font-bold ${
                secondsLeft === 0
                  ? "text-emerald-400"
                  : pomodoroMode === "focus"
                    ? "text-zinc-100"
                    : "text-emerald-300"
              }`}
            >
              {formatTimer(secondsLeft)}
            </span>
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all ${
                  pomodoroMode === "focus" ? "bg-indigo-500" : "bg-emerald-500"
                }`}
                style={{ width: `${timerProgress}%` }}
              />
            </div>
            {secondsLeft === 0 && (
              <span className="text-[10px] font-semibold text-emerald-400">
                Fertig!
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (secondsLeft === 0) {
                  setSecondsLeft(
                    pomodoroMode === "focus" ? FOCUS_SECONDS : BREAK_SECONDS,
                  );
                }
                setTimerRunning((prev) => !prev);
              }}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                timerRunning
                  ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                  : "bg-indigo-600 text-white hover:bg-indigo-500"
              }`}
            >
              {timerRunning ? (
                <>
                  <Pause className="h-3 w-3" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Start
                </>
              )}
            </button>
            <button
              onClick={resetPomodoro}
              title="Timer zurücksetzen"
              className="rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Focused Task Display */}
        <div className="flex items-center gap-2 text-xs">
          {focusedTask ? (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-indigo-200">
              <Target className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
              <span className="max-w-xs truncate font-medium">
                {focusedTask.content}
              </span>
              <button
                onClick={() => onOpenDocument(focusedTask.docPath)}
                title="Dokument öffnen"
                className="text-indigo-300 hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
              <button
                onClick={() => setFocusedTaskId(null)}
                title="Fokus lösen"
                className="text-indigo-300 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-zinc-500">
              Kein Fokus-Task gewählt („Fokus“ auf einer Aufgabe anklicken)
            </span>
          )}
        </div>
      </div>

      {/* Rich Filter & Sort Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 px-6 py-2.5">
        {viewMode !== "kanban" && (
          <div className="flex flex-wrap items-center gap-1 pr-2">
            {(
              [
                ["open", "Offen"],
                ["today", "Heute"],
                ["overdue", "Überfällig"],
                ["done", "Erledigt"],
                ["all", "Alle"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  statusFilter === key
                    ? key === "overdue"
                      ? "bg-rose-500/20 text-rose-300"
                      : "bg-indigo-500/20 text-indigo-300"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                {label}
                {key === "overdue" && overdueCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-rose-500/30 px-1.5 py-0.2 text-[10px] text-rose-200">
                    {overdueCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Aufgaben durchsuchen..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pr-7 pl-8 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Priority Filter */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px]">
          {(
            [
              ["all", "Alle"],
              ["1", "P1"],
              ["2", "P2"],
              ["3", "P3"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setPriorityFilter(val)}
              className={`rounded-md px-2 py-1 font-medium transition ${
                priorityFilter === val
                  ? "bg-rose-500/20 text-rose-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tag Filter Dropdown */}
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label="Tag-Filter"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        >
          <option value="all">Alle Tags</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>

        {/* Sort Selector */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
          <span>Sortierung:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sortierung"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          >
            <option value="default">Standard</option>
            <option value="deadline">Deadline</option>
            <option value="priority">Priorität</option>
            <option value="document">Dokument</option>
          </select>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="text-xs text-zinc-500">Lade Tasks aus SQLite...</div>
        ) : viewMode === "list" ? (
          listFiltered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">
              Keine Aufgaben für diesen Filter gefunden.
            </div>
          ) : (
            <div className="space-y-2">
              {listFiltered.map((task) => {
                const dueState = getDueState(task, todayStr);
                const isFocused = focusedTask?.blockId === task.blockId;
                return (
                  <div
                    key={task.blockId}
                    className={`group flex items-start justify-between gap-4 rounded-xl border p-3.5 transition ${
                      isFocused
                        ? "border-indigo-500/60 bg-indigo-500/10"
                        : dueState === "overdue"
                          ? "border-rose-500/40 bg-rose-950/15 hover:border-rose-500/60"
                          : dueState === "today"
                            ? "border-amber-500/35 bg-amber-950/10 hover:border-amber-500/50"
                            : "border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => void cycleStatus(task)}
                        title="Status umschalten (TODO → DOING → DONE)"
                        className="mt-0.5 shrink-0 text-zinc-400 transition hover:scale-110"
                      >
                        <StatusIcon status={task.status} />
                      </button>

                      <div className="space-y-1">
                        <div
                          className={`text-sm leading-snug ${
                            task.status === "DONE" || task.status === "CANCELED"
                              ? "text-zinc-500 line-through"
                              : "text-zinc-100"
                          }`}
                        >
                          {task.content}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <StatusBadge status={task.status} />

                          {dueState === "overdue" && (
                            <span className="flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                              <AlertTriangle className="h-3 w-3" />
                              Überfällig
                            </span>
                          )}

                          {dueState === "today" && (
                            <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                              <Clock className="h-3 w-3" />
                              Heute
                            </span>
                          )}

                          {task.priority && (
                            <span className="flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                              <Flame className="h-3 w-3" />P{task.priority}
                            </span>
                          )}

                          {task.scheduledAt && (
                            <span className="flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                              <Calendar className="h-3 w-3" />
                              Geplant: {task.scheduledAt}
                            </span>
                          )}

                          {task.deadlineAt && (
                            <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                              <Clock className="h-3 w-3" />
                              Deadline: {task.deadlineAt}
                            </span>
                          )}

                          {task.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => handleFocusTask(task)}
                        title="Aufgabe im Pomodoro-Timer fokussieren"
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                          isFocused
                            ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                            : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-indigo-500/40 hover:text-indigo-300"
                        }`}
                      >
                        <Target className="h-3 w-3" />
                        Fokus
                      </button>

                      <button
                        onClick={() => onOpenDocument(task.docPath)}
                        className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-indigo-500/40 hover:text-indigo-300"
                      >
                        <span>{task.docTitle}</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : viewMode === "kanban" ? (
          /* Kanban View */
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {KANBAN_COLUMNS.map((col) => {
              const colTasks = tasksByStatus[col.status];
              const isDropTarget = dragOverColumn === col.status;

              return (
                <div
                  key={col.status}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverColumn !== col.status) {
                      setDragOverColumn(col.status);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDragOverColumn((prev) =>
                        prev === col.status ? null : prev,
                      );
                    }
                  }}
                  onDrop={(e) => void handleDropOnColumn(e, col.status)}
                  className={`flex min-h-[24rem] flex-col rounded-2xl border p-3 transition ${
                    isDropTarget
                      ? "border-indigo-500 bg-indigo-500/10"
                      : `${col.accentClass} bg-zinc-900/40`
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span
                      className={`rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${col.badgeClass}`}
                    >
                      {col.label}
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                      {colTasks.length}
                    </span>
                  </div>

                  <div className="flex-1 space-y-2.5">
                    {colTasks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-800/90 p-6 text-center text-[11px] text-zinc-600">
                        Hierher ziehen für {col.label}
                      </div>
                    ) : (
                      colTasks.map((task) => {
                        const dueState = getDueState(task, todayStr);
                        const isFocused = focusedTask?.blockId === task.blockId;
                        const isDragging = draggingBlockId === task.blockId;

                        return (
                          <div
                            key={task.blockId}
                            draggable
                            onDragStart={(e) => handleDragStart(e, task.blockId)}
                            onDragEnd={() => {
                              setDraggingBlockId(null);
                              setDragOverColumn(null);
                            }}
                            className={`cursor-grab rounded-xl border p-3 transition active:cursor-grabbing ${
                              isDragging ? "opacity-40" : ""
                            } ${
                              isFocused
                                ? "border-indigo-500/60 bg-indigo-500/10"
                                : dueState === "overdue"
                                  ? "border-rose-500/40 bg-zinc-900 hover:border-rose-500/60"
                                  : dueState === "today"
                                    ? "border-amber-500/35 bg-zinc-900 hover:border-amber-500/50"
                                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => void cycleStatus(task)}
                                title="Status umschalten"
                                className="mt-0.5 shrink-0"
                              >
                                <StatusIcon status={task.status} />
                              </button>
                              <div
                                className={`text-xs leading-relaxed ${
                                  task.status === "DONE" ||
                                  task.status === "CANCELED"
                                    ? "text-zinc-500 line-through"
                                    : "text-zinc-100"
                                }`}
                              >
                                {task.content}
                              </div>
                            </div>

                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                              {dueState === "overdue" && (
                                <span className="flex items-center gap-0.5 rounded bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-300">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  Überfällig
                                </span>
                              )}
                              {dueState === "today" && (
                                <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-300">
                                  <Clock className="h-2.5 w-2.5" />
                                  Heute
                                </span>
                              )}
                              {task.priority && (
                                <span className="flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-300">
                                  <Flame className="h-2.5 w-2.5" />P
                                  {task.priority}
                                </span>
                              )}
                              {task.deadlineAt && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                                  DL: {task.deadlineAt}
                                </span>
                              )}
                              {task.scheduledAt && (
                                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                                  {task.scheduledAt}
                                </span>
                              )}
                              {task.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>

                            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-2">
                              <button
                                onClick={() => onOpenDocument(task.docPath)}
                                className="flex max-w-[65%] items-center gap-1 truncate text-[11px] text-zinc-400 hover:text-indigo-300"
                              >
                                <span className="truncate">
                                  {task.docTitle}
                                </span>
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </button>
                              <button
                                onClick={() => handleFocusTask(task)}
                                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                                  isFocused
                                    ? "bg-indigo-500/25 text-indigo-200"
                                    : "bg-zinc-800 text-zinc-300 hover:bg-indigo-500/20 hover:text-indigo-200"
                                }`}
                              >
                                <Target className="h-2.5 w-2.5" />
                                Fokus
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Calendar View */
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigateMonth(-1)}
                  title="Vorheriger Monat"
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="min-w-44 text-center text-sm font-semibold capitalize text-zinc-100">
                  {monthHeading}
                </h2>
                <button
                  onClick={() => navigateMonth(1)}
                  title="Nächster Monat"
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={jumpToCurrentMonth}
                  className="ml-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:text-indigo-300"
                >
                  Heute
                </button>
              </div>
              <div className="text-[11px] text-zinc-500">
                Klick auf einen Tag öffnet die zugehörige Daily Note
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30">
              <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900/80">
                {WEEKDAY_LABELS.map((day) => (
                  <div
                    key={day}
                    className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 divide-x divide-y divide-zinc-800/70">
                {calendarCells.map((cell) => {
                  const dayTasks = tasksByDate.get(cell.dateStr) ?? [];
                  const isToday = cell.dateStr === todayStr;

                  return (
                    <div
                      key={cell.dateStr}
                      onClick={() => onOpenDaily(cell.dateStr)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenDaily(cell.dateStr);
                        }
                      }}
                      className={`group min-h-28 cursor-pointer p-2 text-left transition hover:bg-zinc-900/80 ${
                        !cell.inCurrentMonth ? "bg-zinc-950/60 opacity-50" : ""
                      } ${isToday ? "bg-indigo-500/10" : ""}`}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                            isToday
                              ? "bg-indigo-600 text-white"
                              : "text-zinc-300"
                          }`}
                        >
                          {cell.dayNumber}
                        </span>
                        <span className="text-[10px] text-indigo-400 opacity-0 transition group-hover:opacity-100">
                          + Daily
                        </span>
                      </div>

                      <div className="space-y-1">
                        {dayTasks.slice(0, 3).map((task) => {
                          const dueState = getDueState(task, todayStr);
                          return (
                            <button
                              key={`${cell.dateStr}-${task.blockId}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenDocument(task.docPath);
                              }}
                              title={`${task.content} (${task.docTitle})`}
                              className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] transition ${
                                task.status === "DONE" ||
                                task.status === "CANCELED"
                                  ? "bg-zinc-800/70 text-zinc-500 line-through"
                                  : dueState === "overdue"
                                    ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                                    : dueState === "today"
                                      ? "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                                      : "bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30"
                              }`}
                            >
                              {task.content}
                            </button>
                          );
                        })}
                        {dayTasks.length > 3 && (
                          <div className="px-1 text-[10px] text-zinc-500">
                            +{dayTasks.length - 3} weitere
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "DONE") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  }
  if (status === "DOING") {
    return <Clock className="h-5 w-5 text-amber-400" />;
  }
  if (status === "CANCELED") {
    return <XCircle className="h-5 w-5 text-zinc-600" />;
  }
  return <Circle className="h-5 w-5 text-zinc-500 hover:text-indigo-400" />;
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
        status === "DOING"
          ? "bg-amber-500/20 text-amber-300"
          : status === "DONE"
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-zinc-800 text-zinc-400"
      }`}
    >
      {status}
    </span>
  );
}
