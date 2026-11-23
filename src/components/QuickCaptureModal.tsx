import { useEffect, useRef, useState } from "react";
import { Calendar, CheckSquare, FileText, Send, Sparkles, X } from "lucide-react";
import { vaultApi } from "../api/bridge";

interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptured: () => Promise<void>;
}

type CaptureMode = "task" | "note";
type PriorityLevel = 1 | 2 | 3;

function todayLocalIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function QuickCaptureModal({
  isOpen,
  onClose,
  onCaptured,
}: QuickCaptureModalProps) {
  const [mode, setMode] = useState<CaptureMode>("task");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<PriorityLevel>(2);
  const [scheduledDate, setScheduledDate] = useState<string>(todayLocalIso);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setText("");
    setError(null);
    setScheduledDate(todayLocalIso());
    setTimeout(() => textareaRef.current?.focus(), 20);
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

  const cleanText = text.replace(/\s+/g, " ").trim();
  const previewLine =
    mode === "task"
      ? `- [ ] ${cleanText || "..."} priority:: ${priority}${
          scheduledDate ? ` scheduled:: ${scheduledDate}` : ""
        }`
      : `- ${cleanText || "..."}`;

  const handleSubmit = async () => {
    if (!cleanText || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const daily = await vaultApi.openDailyNote();
      const line =
        mode === "task"
          ? `- [ ] ${cleanText} priority:: ${priority}${
              scheduledDate ? ` scheduled:: ${scheduledDate}` : ""
            }`
          : `- ${cleanText}`;
      const base = daily.rawMarkdown.replace(/\s+$/, "");
      const nextMd = base.length > 0 ? `${base}\n${line}\n` : `${line}\n`;
      await vaultApi.saveMarkdownDocument(daily.document.path, nextMd);
      await onCaptured();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-4 pt-24 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Quick Capture → Daily Note
            </h2>
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

        <div className="space-y-4 p-5">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Mode Toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("task")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mode === "task"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Aufgabe
            </button>
            <button
              type="button"
              onClick={() => setMode("note")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mode === "note"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Notiz
            </button>
          </div>

          {/* Text Input */}
          <div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={
                mode === "task"
                  ? "Aufgabe erfassen (z. B. Rust-Benchmark prüfen #performance)..."
                  : "Schnelle Notiz für die heutige Daily Note..."
              }
              className="w-full resize-none rounded-xl border border-zinc-700/80 bg-zinc-950/70 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500/70"
            />
          </div>

          {/* Task Metadata */}
          {mode === "task" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-400">Priorität:</span>
                {([1, 2, 3] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setPriority(level)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      priority === level
                        ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                        : "border-zinc-700/80 bg-zinc-950/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    P{level}{" "}
                    {level === 1 ? "Hoch" : level === 2 ? "Mittel" : "Niedrig"}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                <span>Geplant:</span>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="rounded-lg border border-zinc-700/80 bg-zinc-950/70 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:border-indigo-500/70"
                />
              </label>
            </div>
          )}

          {/* Live Markdown Preview */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Markdown-Vorschau
            </div>
            <code className="block break-all font-mono text-xs text-indigo-300">
              {previewLine}
            </code>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-5 py-3">
          <span className="text-[11px] text-zinc-500">
            Ctrl+Enter / Cmd+Enter Speichern • Esc Abbrechen
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!cleanText || submitting}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? "Speichere..." : "In Daily Note erfassen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
