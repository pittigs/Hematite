import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation & Suche",
    items: [
      {
        keys: ["Ctrl", "K"],
        description: "Command Palette öffnen (FTS5 Suche & > Befehle)",
      },
      {
        keys: ["Ctrl", "F"],
        description: "Im aktuellen Dokument suchen",
      },
      {
        keys: ["Alt", "←"],
        description: "Zur vorherigen Notiz in der Historie wechseln",
      },
      {
        keys: ["Alt", "→"],
        description: "Zur nächsten Notiz in der Historie wechseln",
      },
    ],
  },
  {
    title: "Dokument & Ansicht",
    items: [
      {
        keys: ["Ctrl", "S"],
        description: "Aktuelles Dokument sofort speichern",
      },
      {
        keys: ["Ctrl", "Shift", "N"],
        description: "Quick Capture in die heutige Daily Note",
      },
      {
        keys: ["Ctrl", "Shift", "F"],
        description: "Fokus-Modus (Zen-Ansicht) umschalten",
      },
      {
        keys: ["Ctrl", "/"],
        description: "Diese Tastenkürzel-Übersicht anzeigen",
      },
    ],
  },
  {
    title: "HybridEditor & Outliner",
    items: [
      {
        keys: ["Ctrl", "Z"],
        description: "Letzte Bearbeitung rückgängig machen",
      },
      {
        keys: ["Ctrl", "Shift", "Z"],
        description: "Rückgängig gemachte Bearbeitung wiederholen",
      },
      {
        keys: ["Tab"],
        description: "Block im Outliner einrücken",
      },
      {
        keys: ["Shift", "Tab"],
        description: "Block im Outliner ausrücken",
      },
      {
        keys: ["Enter"],
        description: "Neuen Block unterhalb erstellen / aufteilen",
      },
      {
        keys: ["Backspace"],
        description: "Leeren Block entfernen oder mit vorherigem verbinden",
      },
    ],
  },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
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
            <Keyboard className="h-4.5 w-4.5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Tastenkürzel
              </h2>
              <p className="text-[11px] text-zinc-500">
                Auf macOS kann Cmd (⌘) statt Ctrl verwendet werden
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

        <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.title}
              </h3>
              <div className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-zinc-950/60">
                {group.items.map((entry) => (
                  <div
                    key={entry.keys.join("+")}
                    className="flex items-center justify-between gap-4 px-3.5 py-2.5"
                  >
                    <span className="text-xs text-zinc-300">
                      {entry.description}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {entry.keys.map((key, idx) => (
                        <span
                          key={`${key}-${idx}`}
                          className="flex items-center gap-1"
                        >
                          {idx > 0 && (
                            <span className="text-[10px] text-zinc-500">+</span>
                          )}
                          <kbd className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-200">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-5 py-2.5 text-[11px] text-zinc-500">
          <span>OxideVault Keyboard-First Workflow</span>
          <span>Esc Schließen</span>
        </div>
      </div>
    </div>
  );
}
