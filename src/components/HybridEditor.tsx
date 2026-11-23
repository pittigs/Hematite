import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileDown,
  Flame,
  GripVertical,
  Hash,
  Heading1,
  History,
  Indent,
  Info,
  Lightbulb,
  List,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  Outdent,
  Pencil,
  PenLine,
  Plus,
  Quote,
  Redo2,
  Replace,
  Save,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type {
  BacklinkItem,
  Block,
  BlockLookup,
  BlockType,
  DocumentSummary,
  DocumentWithBlocks,
  SearchResult,
  TaskStatus,
} from "../types/vault";
import {
  type CalloutKind,
  parseCalloutHeader,
  parseInlineTokens,
  renderDocumentToStandaloneHtml,
  stripExplicitBlockIds,
} from "../utils/markdownRich";
import { BacklinksPanel } from "./BacklinksPanel";
import { HistoryModal } from "./HistoryModal";
import { OutlinePanel } from "./OutlinePanel";

interface HybridEditorProps {
  docBundle: DocumentWithBlocks;
  allDocuments: DocumentSummary[];
  onSaved: (updated: DocumentWithBlocks) => Promise<void>;
  onNavigate: (target: string) => void;
  onDeleteDocument: (relPath: string) => Promise<void>;
  onRenameDocument: (oldRelPath: string, newRelPath: string) => Promise<void>;
  isZenMode?: boolean;
  onToggleZenMode?: () => void;
}

const MAX_HISTORY = 50;

const SLASH_OPTIONS: Array<{
  type: BlockType;
  label: string;
  headingLevel?: number;
  keywords: string;
  initialContent?: string;
}> = [
  {
    type: "paragraph",
    label: "Absatz (Text)",
    keywords: "paragraph text absatz p",
  },
  {
    type: "heading",
    label: "Überschrift H1",
    headingLevel: 1,
    keywords: "heading h1 titel ueberschrift überschrift",
  },
  {
    type: "heading",
    label: "Überschrift H2",
    headingLevel: 2,
    keywords: "heading h2 ueberschrift überschrift",
  },
  {
    type: "heading",
    label: "Überschrift H3",
    headingLevel: 3,
    keywords: "heading h3 ueberschrift überschrift",
  },
  {
    type: "listItem",
    label: "Listenpunkt (Outliner)",
    keywords: "list bullet punkt outliner ul li",
  },
  {
    type: "taskItem",
    label: "Aufgabe (TODO Checkbox)",
    keywords: "task todo checkbox aufgabe check",
  },
  {
    type: "callout",
    label: "Callout Box",
    keywords: "callout note tip warning info hinweis box",
    initialContent: "[!NOTE] Hinweis\n",
  },
  {
    type: "quote",
    label: "Zitat",
    keywords: "quote zitat blockquote",
  },
  {
    type: "codeBlock",
    label: "Code-Block",
    keywords: "code snippet block pre",
  },
  {
    type: "divider",
    label: "Trennlinie",
    keywords: "divider hr trennlinie line",
  },
];

type AutocompleteMenu =
  | {
      kind: "slash";
      blockId: string;
      query: string;
      triggerStart: number;
      triggerEnd: number;
    }
  | {
      kind: "wiki";
      blockId: string;
      query: string;
      triggerStart: number;
      triggerEnd: number;
    }
  | {
      kind: "blockRef";
      blockId: string;
      query: string;
      triggerStart: number;
      triggerEnd: number;
    };

interface BlockRefCandidate {
  blockId: string;
  docTitle: string;
  docPath: string;
  preview: string;
  isLocal: boolean;
}

interface PendingFocus {
  blockId: string;
  position: "start" | "end" | number;
  selectionEnd?: number;
}

interface HoverDocPreview {
  title: string;
  path: string;
  snippet: string;
  tags: string[];
}

interface FindMatch {
  blockId?: string;
  blockIndex?: number;
  start: number;
  end: number;
}

function cloneBlocks(list: Block[]): Block[] {
  return list.map((b) => ({
    ...b,
    properties: { ...b.properties },
    tags: [...b.tags],
    task: b.task ? { ...b.task } : null,
  }));
}

function autoResizeTextarea(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
}

function extractBlockRefs(raw: string): string[] {
  const out: string[] = [];
  const regex = /\(\(([a-zA-Z0-9_-]+)\)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function findMatchesInText(
  text: string,
  query: string,
  caseSensitive: boolean,
): Array<{ start: number; end: number }> {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  let idx = 0;
  while (idx <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    out.push({ start: found, end: found + needle.length });
    idx = found + Math.max(1, needle.length);
  }
  return out;
}

function replaceAllOccurrences(
  text: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (!query) return text;
  const matches = findMatchesInText(text, query, caseSensitive);
  if (matches.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const m of matches) {
    result += text.slice(cursor, m.start) + replacement;
    cursor = m.end;
  }
  result += text.slice(cursor);
  return result;
}

function serializeBlocksToCleanMarkdown(
  blocks: Block[],
  frontmatter: Record<string, unknown>,
): string {
  const fmEntries = Object.entries(frontmatter).filter(
    ([, v]) => v !== undefined && v !== null && String(v).trim() !== "",
  );
  const parts: string[] = [];

  if (fmEntries.length > 0) {
    const fmLines = fmEntries.map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}: [${v.map((x) => String(x)).join(", ")}]`;
      }
      return `${k}: ${String(v)}`;
    });
    parts.push(`---\n${fmLines.join("\n")}\n---`);
  }

  for (const blk of blocks) {
    const indent = "  ".repeat(Math.max(0, blk.depth));
    const clean = stripExplicitBlockIds(blk.rawContent);

    switch (blk.blockType) {
      case "divider":
        parts.push("---");
        break;
      case "heading": {
        const hashes = "#".repeat(Math.min(6, Math.max(1, blk.headingLevel ?? 2)));
        parts.push(`${hashes} ${clean}`);
        break;
      }
      case "listItem":
        parts.push(`${indent}- ${clean}`);
        break;
      case "taskItem": {
        const st = blk.task?.status ?? "TODO";
        const box = st === "DONE" ? "x" : st === "DOING" ? "/" : st === "CANCELED" ? "-" : " ";
        parts.push(`${indent}- [${box}] ${clean}`);
        break;
      }
      case "codeBlock": {
        const lang = blk.codeLang ?? "";
        parts.push(`\`\`\`${lang}\n${clean}\n\`\`\``);
        break;
      }
      case "quote":
        parts.push(
          clean
            .split("\n")
            .map((line) => `${indent}> ${line}`)
            .join("\n"),
        );
        break;
      case "callout":
        parts.push(
          clean
            .split("\n")
            .map((line) =>
              line.trimStart().startsWith(">")
                ? `${indent}${line}`
                : `${indent}> ${line}`,
            )
            .join("\n"),
        );
        break;
      case "paragraph":
      default:
        parts.push(`${indent}${clean}`);
        break;
    }
  }

  return `${parts.join("\n\n")}\n`;
}

function triggerFileDownload(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugifyFilename(titleOrPath: string): string {
  const base = titleOrPath.replace(/\.md$/i, "").split("/").pop() || "dokument";
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "-").trim();
  return cleaned || "dokument";
}

export function HybridEditor({
  docBundle,
  allDocuments,
  onSaved,
  onNavigate,
  onDeleteDocument,
  onRenameDocument,
  isZenMode,
  onToggleZenMode,
}: HybridEditorProps) {
  const [mode, setMode] = useState<"hybrid" | "preview" | "raw">("hybrid");
  const [blocks, setBlocks] = useState<Block[]>(docBundle.blocks);
  const [rawMarkdown, setRawMarkdown] = useState(docBundle.rawMarkdown);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [transclusions, setTransclusions] = useState<
    Record<string, BlockLookup>
  >({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Undo / Redo history
  const [undoStack, setUndoStack] = useState<Block[][]>([]);
  const [redoStack, setRedoStack] = useState<Block[][]>([]);
  const blocksRef = useRef<Block[]>(docBundle.blocks);
  blocksRef.current = blocks;
  const lastEditMetaRef = useRef<{ blockId: string; ts: number } | null>(null);
  const lastDocIdRef = useRef<string>(docBundle.document.id);

  // Autocomplete menus (`/`, `[[`, `((`)
  const [menu, setMenu] = useState<AutocompleteMenu | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [remoteBlockRefs, setRemoteBlockRefs] = useState<SearchResult[]>([]);

  // Block Zoom (Hoisting)
  const [zoomBlockId, setZoomBlockId] = useState<string | null>(null);

  // Drag & Drop state
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);

  // Find & Replace
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // Side panels & modals & Zen fallback
  const [showOutline, setShowOutline] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localZenMode, setLocalZenMode] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  // Frontmatter & rename
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropVal, setNewPropVal] = useState("");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(
    docBundle.document.frontmatter,
  );
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(docBundle.document.path);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);

  const blockRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const blockWrapperRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hoverDocCacheRef = useRef<
    Record<string, HoverDocPreview | "not_found">
  >({});

  const effectiveZenMode = isZenMode ?? localZenMode;
  const handleToggleZen = useCallback(() => {
    if (onToggleZenMode) {
      onToggleZenMode();
    } else {
      setLocalZenMode((v) => !v);
    }
  }, [onToggleZenMode]);

  const loadBacklinks = useCallback(async (docId: string) => {
    try {
      const items = await vaultApi.getBacklinks(docId);
      setBacklinks(items);
    } catch {
      setBacklinks([]);
    }
  }, []);

  // Sync local state whenever active document changes
  useEffect(() => {
    const isNewDocument = lastDocIdRef.current !== docBundle.document.id;
    lastDocIdRef.current = docBundle.document.id;

    setBlocks(docBundle.blocks);
    blocksRef.current = docBundle.blocks;
    setRawMarkdown(docBundle.rawMarkdown);
    setFrontmatter(docBundle.document.frontmatter);
    setDirty(false);
    setEditorError(null);
    setMenu(null);
    setMenuIndex(0);
    setRenaming(false);
    setRenameValue(docBundle.document.path);

    if (isNewDocument) {
      setUndoStack([]);
      setRedoStack([]);
      lastEditMetaRef.current = null;
      setZoomBlockId(null);
      setActiveBlockId(null);
      setDragBlockId(null);
      setDragOverBlockId(null);
    } else {
      // Keep zoom only if zoomed block still exists
      setZoomBlockId((curr) =>
        curr && docBundle.blocks.some((b) => b.id === curr) ? curr : null,
      );
    }

    void loadBacklinks(docBundle.document.id);
  }, [docBundle, loadBacklinks]);

  // Auto-resize all visible block textareas cleanly on render/updates
  useLayoutEffect(() => {
    if (mode !== "hybrid") return;
    for (const el of Object.values(blockRefs.current)) {
      autoResizeTextarea(el);
    }
  }, [blocks, mode, zoomBlockId, showOutline, effectiveZenMode]);

  // Focus newly inserted or targeted block textarea cleanly
  useEffect(() => {
    if (!pendingFocus) return;
    const el = blockRefs.current[pendingFocus.blockId];
    if (el) {
      el.focus();
      const len = el.value.length;
      const start =
        pendingFocus.position === "start"
          ? 0
          : pendingFocus.position === "end"
            ? len
            : Math.min(len, Math.max(0, pendingFocus.position));
      const end =
        pendingFocus.selectionEnd !== undefined
          ? Math.min(len, Math.max(start, pendingFocus.selectionEnd))
          : start;
      el.setSelectionRange(start, end);
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setActiveBlockId(pendingFocus.blockId);
      setPendingFocus(null);
    }
  }, [blocks, pendingFocus, zoomBlockId, mode]);

  // Resolve `((block-id))` references inside blocks for live transclusion rendering
  useEffect(() => {
    const refIds = new Set<string>();
    const regex = /\(\(([a-zA-Z0-9_-]+)\)\)/g;
    for (const blk of blocks) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(blk.rawContent)) !== null) {
        refIds.add(match[1]);
      }
    }
    if (refIds.size === 0) {
      setTransclusions({});
      return;
    }

    let cancelled = false;
    Promise.all(
      Array.from(refIds).map(async (id) => {
        const res = await vaultApi.getBlockById(id).catch(() => null);
        return [id, res] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, BlockLookup> = {};
      for (const [id, val] of entries) {
        if (val) map[id] = val;
      }
      setTransclusions(map);
    });

    return () => {
      cancelled = true;
    };
  }, [blocks]);

  // Fetch cross-vault block candidates when `((` autocomplete has a query
  useEffect(() => {
    if (!menu || menu.kind !== "blockRef") {
      setRemoteBlockRefs([]);
      return;
    }
    const q = menu.query.trim();
    if (q.length < 2) {
      setRemoteBlockRefs([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      vaultApi
        .searchVault(q, 10)
        .then((res) => {
          if (!cancelled) setRemoteBlockRefs(res.results);
        })
        .catch(() => {
          if (!cancelled) setRemoteBlockRefs([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [menu]);

  // Commit block mutations with bounded Undo/Redo history
  const commitBlocks = useCallback(
    (
      nextBlocks: Block[],
      options?: { coalesceBlockId?: string; skipHistory?: boolean },
    ) => {
      const prev = blocksRef.current;
      if (!options?.skipHistory) {
        const now = Date.now();
        const canCoalesce =
          Boolean(options?.coalesceBlockId) &&
          lastEditMetaRef.current?.blockId === options?.coalesceBlockId &&
          now - (lastEditMetaRef.current?.ts ?? 0) < 600;

        if (!canCoalesce) {
          const snapshot = cloneBlocks(prev);
          setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), snapshot]);
        }
        setRedoStack([]);
        lastEditMetaRef.current = options?.coalesceBlockId
          ? { blockId: options.coalesceBlockId, ts: now }
          : null;
      }

      blocksRef.current = nextBlocks;
      setBlocks(nextBlocks);
      setDirty(true);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const previousState = prevUndo[prevUndo.length - 1];
      const currentSnapshot = cloneBlocks(blocksRef.current);
      setRedoStack((prevRedo) => [
        ...prevRedo.slice(-(MAX_HISTORY - 1)),
        currentSnapshot,
      ]);
      blocksRef.current = previousState;
      setBlocks(previousState);
      setDirty(true);
      lastEditMetaRef.current = null;
      setMenu(null);
      return prevUndo.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextState = prevRedo[prevRedo.length - 1];
      const currentSnapshot = cloneBlocks(blocksRef.current);
      setUndoStack((prevUndo) => [
        ...prevUndo.slice(-(MAX_HISTORY - 1)),
        currentSnapshot,
      ]);
      blocksRef.current = nextState;
      setBlocks(nextState);
      setDirty(true);
      lastEditMetaRef.current = null;
      setMenu(null);
      return prevRedo.slice(0, -1);
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setEditorError(null);
    try {
      const updated =
        mode === "raw"
          ? await vaultApi.saveMarkdownDocument(
              docBundle.document.path,
              rawMarkdown,
            )
          : await vaultApi.saveDocumentBlocks(
              docBundle.document.path,
              { ...docBundle.document, frontmatter },
              blocksRef.current,
            );
      setDirty(false);
      await onSaved(updated);
    } catch (err) {
      setEditorError(
        err instanceof Error ? err.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  }, [docBundle.document, frontmatter, mode, onSaved, rawMarkdown]);

  // Global keyboard shortcuts: Ctrl+S, Ctrl+F, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === "s") {
        e.preventDefault();
        if (!saving) {
          void handleSave();
        }
        return;
      }

      if (key === "f") {
        e.preventDefault();
        setFindOpen(true);
        window.requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
        return;
      }

      if (mode !== "raw") {
        const target = e.target as HTMLElement | null;
        const isPlainInput = target?.tagName === "INPUT";
        if (!isPlainInput) {
          if (key === "z" && !e.shiftKey) {
            e.preventDefault();
            handleUndo();
            return;
          }
          if ((key === "z" && e.shiftKey) || key === "y") {
            e.preventDefault();
            handleRedo();
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleSave, handleUndo, mode, saving]);

  // Debounced Auto-Save (1.5s after last edit)
  useEffect(() => {
    if (!autoSave || !dirty || saving) return;
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoSave, dirty, saving, handleSave]);

  // Warn before closing window/tab when unsaved changes exist
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Compute Block Zoom slice & Breadcrumbs
  const zoomState = useMemo(() => {
    if (!zoomBlockId) {
      return {
        isZoomed: false,
        rootDepth: 0,
        startIdx: 0,
        endIdx: blocks.length - 1,
        breadcrumbs: [] as Block[],
      };
    }
    const idx = blocks.findIndex((b) => b.id === zoomBlockId);
    if (idx === -1) {
      return {
        isZoomed: false,
        rootDepth: 0,
        startIdx: 0,
        endIdx: blocks.length - 1,
        breadcrumbs: [] as Block[],
      };
    }
    const rootDepth = blocks[idx].depth;
    let endIdx = idx;
    for (let j = idx + 1; j < blocks.length; j++) {
      if (blocks[j].depth > rootDepth) {
        endIdx = j;
      } else {
        break;
      }
    }

    const ancestors: Block[] = [];
    let minDepth = rootDepth;
    for (let i = idx - 1; i >= 0; i--) {
      if (blocks[i].depth < minDepth) {
        ancestors.unshift(blocks[i]);
        minDepth = blocks[i].depth;
      }
    }
    ancestors.push(blocks[idx]);

    return {
      isZoomed: true,
      rootDepth,
      startIdx: idx,
      endIdx,
      breadcrumbs: ancestors,
    };
  }, [blocks, zoomBlockId]);

  // Determine hidden collapsed children
  const isBlockHiddenByCollapse = useCallback(
    (index: number): boolean => {
      const minBound = zoomState.isZoomed ? zoomState.startIdx : 0;
      const currentDepth = blocks[index].depth;
      for (let i = index - 1; i >= minBound; i--) {
        if (blocks[i].depth < currentDepth) {
          if (blocks[i].collapsed) return true;
          return isBlockHiddenByCollapse(i);
        }
      }
      return false;
    },
    [blocks, zoomState.isZoomed, zoomState.startIdx],
  );

  // Visible block indices respecting zoom & collapse
  const visibleIndices = useMemo(() => {
    const out: number[] = [];
    if (blocks.length === 0) return out;
    const start = zoomState.isZoomed ? zoomState.startIdx : 0;
    const end = zoomState.isZoomed ? zoomState.endIdx : blocks.length - 1;
    for (let i = start; i <= end; i++) {
      if (mode === "hybrid" && isBlockHiddenByCollapse(i)) continue;
      out.push(i);
    }
    return out;
  }, [
    blocks.length,
    isBlockHiddenByCollapse,
    mode,
    zoomState.endIdx,
    zoomState.isZoomed,
    zoomState.startIdx,
  ]);

  // Filtered autocomplete options for active menu
  const filteredSlashOptions = useMemo(() => {
    if (!menu || menu.kind !== "slash") return [];
    const q = menu.query.trim().toLowerCase();
    if (!q) return SLASH_OPTIONS;
    return SLASH_OPTIONS.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.type.toLowerCase().includes(q) ||
        opt.keywords.includes(q),
    );
  }, [menu]);

  const filteredWikiDocs = useMemo(() => {
    if (!menu || menu.kind !== "wiki") return [];
    const q = menu.query.trim().toLowerCase();
    const matched = q
      ? allDocuments.filter(
          (d) =>
            d.title.toLowerCase().includes(q) ||
            d.path.toLowerCase().includes(q),
        )
      : allDocuments;
    return matched.slice(0, 15);
  }, [allDocuments, menu]);

  const filteredBlockRefs = useMemo<BlockRefCandidate[]>(() => {
    if (!menu || menu.kind !== "blockRef") return [];
    const q = menu.query.trim().toLowerCase();
    const seen = new Set<string>();
    const items: BlockRefCandidate[] = [];

    for (const b of blocks) {
      if (b.blockType === "divider" || b.id === menu.blockId) continue;
      const preview = stripExplicitBlockIds(b.plainText || b.rawContent).trim();
      if (!preview && !b.hasExplicitId) continue;
      const matches =
        !q ||
        b.id.toLowerCase().includes(q) ||
        preview.toLowerCase().includes(q);
      if (matches) {
        seen.add(b.id);
        items.push({
          blockId: b.id,
          docTitle: docBundle.document.title,
          docPath: docBundle.document.path,
          preview: preview || "(Leerer Block)",
          isLocal: true,
        });
      }
    }

    for (const r of remoteBlockRefs) {
      if (seen.has(r.blockId)) continue;
      seen.add(r.blockId);
      items.push({
        blockId: r.blockId,
        docTitle: r.docTitle,
        docPath: r.docPath,
        preview: r.plainText || r.snippet,
        isLocal: false,
      });
    }

    return items.slice(0, 15);
  }, [
    blocks,
    docBundle.document.path,
    docBundle.document.title,
    menu,
    remoteBlockRefs,
  ]);

  // Clamp menu selection index when filtered list shrinks
  const activeMenuCount =
    menu?.kind === "slash"
      ? filteredSlashOptions.length
      : menu?.kind === "wiki"
        ? filteredWikiDocs.length
        : menu?.kind === "blockRef"
          ? filteredBlockRefs.length
          : 0;

  useEffect(() => {
    setMenuIndex(0);
  }, [menu?.kind, menu?.blockId, menu?.query]);

  // Find & Replace matches
  const findMatches = useMemo<FindMatch[]>(() => {
    const q = findQuery;
    if (!findOpen || !q) return [];
    if (mode === "raw") {
      return findMatchesInText(rawMarkdown, q, findCaseSensitive);
    }
    const list: FindMatch[] = [];
    blocks.forEach((b, blockIndex) => {
      if (b.blockType === "divider") return;
      const inBlk = findMatchesInText(b.rawContent, q, findCaseSensitive);
      for (const m of inBlk) {
        list.push({
          blockId: b.id,
          blockIndex,
          start: m.start,
          end: m.end,
        });
      }
    });
    return list;
  }, [blocks, findCaseSensitive, findOpen, findQuery, mode, rawMarkdown]);

  useEffect(() => {
    if (findMatches.length === 0) {
      setActiveMatchIdx(0);
    } else if (activeMatchIdx >= findMatches.length) {
      setActiveMatchIdx(0);
    }
  }, [activeMatchIdx, findMatches.length]);

  const jumpToMatch = useCallback(
    (idx: number) => {
      if (findMatches.length === 0) return;
      const safeIdx =
        ((idx % findMatches.length) + findMatches.length) % findMatches.length;
      setActiveMatchIdx(safeIdx);
      const match = findMatches[safeIdx];
      if (match.blockId) {
        if (
          zoomBlockId &&
          match.blockIndex !== undefined &&
          (match.blockIndex < zoomState.startIdx ||
            match.blockIndex > zoomState.endIdx)
        ) {
          setZoomBlockId(null);
        }
        if (mode === "hybrid") {
          setPendingFocus({
            blockId: match.blockId,
            position: match.start,
            selectionEnd: match.end,
          });
        } else {
          blockWrapperRefs.current[match.blockId]?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        }
      }
    },
    [
      findMatches,
      mode,
      zoomBlockId,
      zoomState.endIdx,
      zoomState.startIdx,
    ],
  );

  const handleReplaceCurrent = () => {
    if (!findQuery || findMatches.length === 0) return;
    const match = findMatches[activeMatchIdx] ?? findMatches[0];
    if (mode === "raw") {
      const next =
        rawMarkdown.slice(0, match.start) +
        replaceQuery +
        rawMarkdown.slice(match.end);
      setRawMarkdown(next);
      setDirty(true);
      return;
    }
    if (!match.blockId) return;
    const nextBlocks = blocksRef.current.map((b) => {
      if (b.id !== match.blockId) return b;
      const updatedText =
        b.rawContent.slice(0, match.start) +
        replaceQuery +
        b.rawContent.slice(match.end);
      return { ...b, rawContent: updatedText, plainText: updatedText };
    });
    commitBlocks(nextBlocks);
  };

  const handleReplaceAll = () => {
    if (!findQuery || findMatches.length === 0) return;
    if (mode === "raw") {
      const next = replaceAllOccurrences(
        rawMarkdown,
        findQuery,
        replaceQuery,
        findCaseSensitive,
      );
      setRawMarkdown(next);
      setDirty(true);
      return;
    }
    const nextBlocks = blocksRef.current.map((b) => {
      if (b.blockType === "divider") return b;
      const updatedText = replaceAllOccurrences(
        b.rawContent,
        findQuery,
        replaceQuery,
        findCaseSensitive,
      );
      if (updatedText === b.rawContent) return b;
      return { ...b, rawContent: updatedText, plainText: updatedText };
    });
    commitBlocks(nextBlocks);
  };

  const handleConfirmRename = async () => {
    const target = renameValue.trim();
    if (!target || target === docBundle.document.path) {
      setRenaming(false);
      setRenameValue(docBundle.document.path);
      return;
    }
    setEditorError(null);
    try {
      if (dirty) {
        await handleSave();
      }
      await onRenameDocument(docBundle.document.path, target);
      setRenaming(false);
    } catch (err) {
      setEditorError(
        err instanceof Error ? err.message : "Umbenennen fehlgeschlagen.",
      );
    }
  };

  const updateBlock = useCallback(
    (
      blockId: string,
      patch: Partial<Block>,
      options?: { coalesceBlockId?: string; skipHistory?: boolean },
    ) => {
      const next = blocksRef.current.map((b) =>
        b.id === blockId ? { ...b, ...patch } : b,
      );
      commitBlocks(next, options);
    },
    [commitBlocks],
  );

  const detectAutocomplete = (
    blockId: string,
    value: string,
    cursorPos: number,
  ): AutocompleteMenu | null => {
    const before = value.slice(0, cursorPos);

    // 1. Slash command at start of block (single token)
    if (value.startsWith("/") && !before.includes("\n") && !before.includes(" ")) {
      return {
        kind: "slash",
        blockId,
        query: before.slice(1),
        triggerStart: 0,
        triggerEnd: value.length,
      };
    }

    // 2. Wiki-link `[[query` before cursor
    const wikiMatch = /\[\[([^\]\n]*)$/.exec(before);
    if (wikiMatch) {
      return {
        kind: "wiki",
        blockId,
        query: wikiMatch[1],
        triggerStart: wikiMatch.index,
        triggerEnd: cursorPos,
      };
    }

    // 3. Block-ref `((query` before cursor
    const refMatch = /\(\(([^)\n]*)$/.exec(before);
    if (refMatch) {
      return {
        kind: "blockRef",
        blockId,
        query: refMatch[1],
        triggerStart: refMatch.index,
        triggerEnd: cursorPos,
      };
    }

    return null;
  };

  const handleContentChange = (
    block: Block,
    value: string,
    cursorPos: number,
    el: HTMLTextAreaElement,
  ) => {
    autoResizeTextarea(el);
    updateBlock(
      block.id,
      { rawContent: value, plainText: value },
      { coalesceBlockId: block.id },
    );
    const detected = detectAutocomplete(block.id, value, cursorPos);
    setMenu(detected);
  };

  const applySlashOption = (
    block: Block,
    opt: (typeof SLASH_OPTIONS)[number],
  ) => {
    const initial = opt.initialContent ?? "";
    updateBlock(block.id, {
      blockType: opt.type,
      headingLevel: opt.headingLevel ?? null,
      rawContent: initial,
      plainText: initial,
      task:
        opt.type === "taskItem"
          ? {
              status: "TODO",
              priority: null,
              scheduledAt: null,
              deadlineAt: null,
              recurrence: null,
            }
          : null,
    });
    setMenu(null);
    if (opt.type !== "divider") {
      setPendingFocus({ blockId: block.id, position: "end" });
    }
  };

  const applyWikiSuggestion = (block: Block, doc: DocumentSummary) => {
    if (!menu || menu.kind !== "wiki") return;
    const insertion = `[[${doc.title}]]`;
    const nextValue =
      block.rawContent.slice(0, menu.triggerStart) +
      insertion +
      block.rawContent.slice(menu.triggerEnd);
    const nextCursor = menu.triggerStart + insertion.length;
    updateBlock(block.id, { rawContent: nextValue, plainText: nextValue });
    setMenu(null);
    setPendingFocus({ blockId: block.id, position: nextCursor });
  };

  const applyBlockRefSuggestion = (
    block: Block,
    candidate: BlockRefCandidate,
  ) => {
    if (!menu || menu.kind !== "blockRef") return;
    const insertion = `((${candidate.blockId}))`;
    const nextValue =
      block.rawContent.slice(0, menu.triggerStart) +
      insertion +
      block.rawContent.slice(menu.triggerEnd);
    const nextCursor = menu.triggerStart + insertion.length;
    updateBlock(block.id, { rawContent: nextValue, plainText: nextValue });
    setMenu(null);
    setPendingFocus({ blockId: block.id, position: nextCursor });
  };

  const insertBlockAfter = (
    index: number,
    depth = 0,
    blockType: BlockType = "paragraph",
  ) => {
    const newBlock: Block = {
      id: `b-new-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      docId: docBundle.document.id,
      parentBlockId: null,
      depth,
      sortOrder: (index + 1.5) * 1000,
      blockType,
      headingLevel: blockType === "heading" ? 2 : null,
      codeLang: null,
      hasExplicitId: false,
      rawContent: "",
      plainText: "",
      properties: {},
      tags: [],
      collapsed: false,
      task:
        blockType === "taskItem"
          ? {
              status: "TODO",
              priority: null,
              scheduledAt: null,
              deadlineAt: null,
              recurrence: null,
            }
          : null,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    const next = [...blocksRef.current];
    next.splice(index + 1, 0, newBlock);
    commitBlocks(next);
    setPendingFocus({ blockId: newBlock.id, position: "start" });
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocksRef.current.length) return;
    const next = [...blocksRef.current];
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    commitBlocks(next);
  };

  const reorderBlockByIds = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const current = blocksRef.current;
    const fromIdx = current.findIndex((b) => b.id === sourceId);
    const toIdx = current.findIndex((b) => b.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...current];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    commitBlocks(next);
  };

  const removeBlock = (index: number) => {
    if (blocksRef.current.length <= 1) return;
    const removed = blocksRef.current[index];
    const next = blocksRef.current.filter((_, idx) => idx !== index);
    if (removed && zoomBlockId === removed.id) {
      setZoomBlockId(null);
    }
    commitBlocks(next);
  };

  const handleCopyLazyBlockRef = async (block: Block) => {
    if (dirty) {
      await handleSave();
    }
    const materializedId = await vaultApi.materializeBlockId(
      docBundle.document.path,
      block.id,
    );
    updateBlock(block.id, { hasExplicitId: true }, { skipHistory: true });
    await navigator.clipboard
      ?.writeText(`((${materializedId}))`)
      .catch(() => {});
    setCopiedId(block.id);
    setTimeout(() => setCopiedId(null), 2000);
    const fresh = await vaultApi.getDocument(docBundle.document.path);
    if (fresh) await onSaved(fresh);
  };

  const addFrontmatterProperty = () => {
    const k = newPropKey.trim();
    const v = newPropVal.trim();
    if (!k || !v) return;
    setFrontmatter((prev) => ({ ...prev, [k]: v }));
    setNewPropKey("");
    setNewPropVal("");
    setDirty(true);
  };

  const cycleTaskInBlock = (blk: Block) => {
    const curr = blk.task?.status ?? "TODO";
    const nextStatus: TaskStatus =
      curr === "TODO" ? "DOING" : curr === "DOING" ? "DONE" : "TODO";
    updateBlock(blk.id, {
      task: {
        status: nextStatus,
        priority: blk.task?.priority ?? null,
        scheduledAt: blk.task?.scheduledAt ?? null,
        deadlineAt: blk.task?.deadlineAt ?? null,
        recurrence: blk.task?.recurrence ?? null,
      },
    });
  };

  const handleJumpToBlock = useCallback(
    (blockId: string) => {
      const targetIdx = blocksRef.current.findIndex((b) => b.id === blockId);
      if (targetIdx === -1) return;

      if (
        zoomState.isZoomed &&
        (targetIdx < zoomState.startIdx || targetIdx > zoomState.endIdx)
      ) {
        setZoomBlockId(null);
      }

      setActiveBlockId(blockId);

      if (mode === "raw") {
        setMode("hybrid");
        setPendingFocus({ blockId, position: "end" });
        return;
      }

      if (mode === "hybrid") {
        setPendingFocus({ blockId, position: "end" });
      } else {
        blockWrapperRefs.current[blockId]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    [mode, zoomState.endIdx, zoomState.isZoomed, zoomState.startIdx],
  );

  const handleExportCleanMarkdown = () => {
    const sourceMd =
      mode === "raw"
        ? rawMarkdown
        : dirty
          ? serializeBlocksToCleanMarkdown(blocks, frontmatter)
          : docBundle.rawMarkdown;
    const cleanMd = stripExplicitBlockIds(sourceMd);
    const name = `${slugifyFilename(docBundle.document.title || docBundle.document.path)}.md`;
    triggerFileDownload(name, cleanMd, "text/markdown;charset=utf-8");
  };

  const handleExportHtml = () => {
    const html = renderDocumentToStandaloneHtml(
      docBundle.document.title || docBundle.document.path,
      blocks,
    );
    const name = `${slugifyFilename(docBundle.document.title || docBundle.document.path)}.html`;
    triggerFileDownload(name, html, "text/html;charset=utf-8");
  };

  const focusAdjacentVisibleBlock = (
    currentBlockIdx: number,
    direction: -1 | 1,
  ) => {
    const posInVisible = visibleIndices.indexOf(currentBlockIdx);
    if (posInVisible === -1) return;
    let cursor = posInVisible + direction;
    while (cursor >= 0 && cursor < visibleIndices.length) {
      const candidate = blocks[visibleIndices[cursor]];
      if (candidate && candidate.blockType !== "divider") {
        setPendingFocus({
          blockId: candidate.id,
          position: direction === -1 ? "end" : "start",
        });
        return;
      }
      cursor += direction;
    }
  };

  const loadHoverPreview = useCallback(
    async (target: string): Promise<HoverDocPreview | "not_found"> => {
      const key = target.trim().toLowerCase();
      const cached = hoverDocCacheRef.current[key];
      if (cached) return cached;
      try {
        const doc = await vaultApi.getDocument(target);
        if (!doc) {
          hoverDocCacheRef.current[key] = "not_found";
          return "not_found";
        }
        const snippetText = doc.blocks
          .filter((b) => b.blockType !== "divider")
          .map((b) => stripExplicitBlockIds(b.plainText || b.rawContent).trim())
          .filter(Boolean)
          .join(" ")
          .slice(0, 260);
        const entry: HoverDocPreview = {
          title: doc.document.title,
          path: doc.document.path,
          snippet: snippetText || "(Leeres Dokument)",
          tags: doc.document.tags,
        };
        hoverDocCacheRef.current[key] = entry;
        return entry;
      } catch {
        hoverDocCacheRef.current[key] = "not_found";
        return "not_found";
      }
    },
    [],
  );

  const matchingBlockIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of findMatches) {
      if (m.blockId) set.add(m.blockId);
    }
    return set;
  }, [findMatches]);

  const activeMatchBlockId = findMatches[activeMatchIdx]?.blockId ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-800/80 px-5 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {renaming ? (
              <div className="flex items-center gap-1">
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleConfirmRename();
                    if (e.key === "Escape") {
                      setRenaming(false);
                      setRenameValue(docBundle.document.path);
                    }
                  }}
                  autoFocus
                  className="w-56 rounded-lg border border-indigo-500/60 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-100 outline-none"
                />
                <button
                  onClick={() => void handleConfirmRename()}
                  title="Umbenennen bestätigen (aktualisiert auch [[Wiki-Links]])"
                  className="rounded-lg bg-indigo-600 p-1 text-white hover:bg-indigo-500"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => {
                    setRenaming(false);
                    setRenameValue(docBundle.document.path);
                  }}
                  title="Abbrechen"
                  className="rounded-lg bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setRenameValue(docBundle.document.path);
                  setRenaming(true);
                }}
                title="Notiz umbenennen / verschieben (aktualisiert [[Wiki-Links]])"
                className="group flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 font-mono text-xs text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
              >
                <span className="truncate">{docBundle.document.path}</span>
                <Pencil className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
              </button>
            )}
            <span className="hidden rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 xl:inline">
              BLAKE3: {docBundle.document.blake3Hash.slice(0, 10)}
            </span>
            {dirty ? (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                Ungespeichert
              </span>
            ) : (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                Gespeichert
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Undo / Redo */}
          {mode !== "raw" && (
            <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                title="Rückgängig (Ctrl+Z)"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                title="Wiederholen (Ctrl+Shift+Z / Ctrl+Y)"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Find & Replace toggle */}
          <button
            onClick={() => {
              setFindOpen((prev) => {
                const next = !prev;
                if (next) {
                  window.requestAnimationFrame(() =>
                    findInputRef.current?.focus(),
                  );
                }
                return next;
              });
            }}
            title="Suchen & Ersetzen (Ctrl+F)"
            className={`rounded-xl border p-1.5 transition ${
              findOpen
                ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* Outline toggle */}
          <button
            onClick={() => setShowOutline((v) => !v)}
            title="Gliederung & Dokumentstatistik umschalten"
            className={`flex items-center gap-1 rounded-xl border px-2 py-1.5 text-[11px] font-medium transition ${
              showOutline
                ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <ListTree className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Gliederung</span>
          </button>

          {/* History modal trigger */}
          <button
            onClick={() => setHistoryOpen(true)}
            title="Versionsverlauf (Snapshots)"
            className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Verlauf</span>
          </button>

          {/* Export Clean .md & .html */}
          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
            <button
              onClick={handleExportCleanMarkdown}
              title="Sauberes Markdown (.md ohne ^block-id) exportieren"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>.md</span>
            </button>
            <button
              onClick={handleExportHtml}
              title="Eigenständiges HTML (.html) exportieren"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Download className="h-3.5 w-3.5" />
              <span>.html</span>
            </button>
          </div>

          {/* Zen Mode */}
          <button
            onClick={handleToggleZen}
            title={
              effectiveZenMode ? "Zen-Modus beenden" : "Zen-Modus (Fokusansicht)"
            }
            className={`rounded-xl border p-1.5 transition ${
              effectiveZenMode
                ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {effectiveZenMode ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            onClick={() => setAutoSave((v) => !v)}
            title="Automatisches Speichern nach 1,5 Sekunden umschalten"
            className={`rounded-xl border px-2.5 py-1 text-[11px] font-medium transition ${
              autoSave
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Auto-Save: {autoSave ? "An" : "Aus"}
          </button>

          <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
            <button
              onClick={() => setMode("hybrid")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                mode === "hybrid"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <PenLine className="h-3.5 w-3.5" />
              Hybrid-Editor
            </button>
            <button
              onClick={() => setMode("preview")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                mode === "preview"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Leseansicht
            </button>
            <button
              onClick={() => setMode("raw")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                mode === "raw"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <FileCode2 className="h-3.5 w-3.5" />
              Markdown
            </button>
          </div>

          <button
            onClick={() => void handleSave()}
            disabled={saving}
            title="Speichern (Ctrl+S)"
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Speichert..." : "Speichern"}
          </button>

          <button
            onClick={() => {
              if (
                window.confirm(
                  `Notiz "${docBundle.document.path}" wirklich löschen?`,
                )
              ) {
                void onDeleteDocument(docBundle.document.path);
              }
            }}
            title="Notiz löschen"
            className="rounded-xl border border-zinc-800 p-1.5 text-zinc-500 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Compact In-Document Find & Replace Bar */}
      {findOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/75 px-5 py-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(e) => {
                setFindQuery(e.target.value);
                setActiveMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpToMatch(activeMatchIdx + (e.shiftKey ? -1 : 1));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setFindOpen(false);
                }
              }}
              placeholder="Suchen..."
              className="w-40 bg-transparent text-xs text-zinc-100 placeholder-zinc-600 outline-none"
            />
            <button
              onClick={() => setFindCaseSensitive((v) => !v)}
              title="Groß-/Kleinschreibung beachten"
              className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold transition ${
                findCaseSensitive
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              Aa
            </button>
          </div>

          <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-400">
            <span className="min-w-14 text-center">
              {findMatches.length === 0
                ? "0 / 0"
                : `${activeMatchIdx + 1} / ${findMatches.length}`}
            </span>
            <button
              onClick={() => jumpToMatch(activeMatchIdx - 1)}
              disabled={findMatches.length === 0}
              title="Vorheriger Treffer (Shift+Enter)"
              className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              onClick={() => jumpToMatch(activeMatchIdx + 1)}
              disabled={findMatches.length === 0}
              title="Nächster Treffer (Enter)"
              className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1">
            <Replace className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFindOpen(false);
                }
              }}
              placeholder="Ersetzen durch..."
              className="w-40 bg-transparent text-xs text-zinc-100 placeholder-zinc-600 outline-none"
            />
          </div>

          <button
            onClick={handleReplaceCurrent}
            disabled={!findQuery || findMatches.length === 0}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-40"
          >
            Ersetzen
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!findQuery || findMatches.length === 0}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            Alle ersetzen
          </button>

          <button
            onClick={() => setFindOpen(false)}
            title="Suchleiste schließen (Esc)"
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Block Zoom Breadcrumb Bar */}
      {zoomState.isZoomed && mode !== "raw" && (
        <div className="flex items-center justify-between gap-2 border-b border-indigo-500/30 bg-indigo-500/10 px-5 py-2 text-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-indigo-200">
            <ZoomIn className="mr-1 h-3.5 w-3.5 shrink-0 text-indigo-400" />
            <button
              onClick={() => setZoomBlockId(null)}
              className="rounded px-1.5 py-0.5 font-medium hover:bg-indigo-500/20"
            >
              Dokument
            </button>
            {zoomState.breadcrumbs.map((crumb, idx) => {
              const isCurrent = idx === zoomState.breadcrumbs.length - 1;
              const label =
                stripExplicitBlockIds(
                  crumb.plainText || crumb.rawContent,
                ).trim() || "(Block)";
              return (
                <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                  <span className="text-indigo-400/70">/</span>
                  {isCurrent ? (
                    <span className="max-w-xs truncate rounded bg-indigo-500/20 px-1.5 py-0.5 font-semibold text-indigo-100">
                      {label}
                    </span>
                  ) : (
                    <button
                      onClick={() => setZoomBlockId(crumb.id)}
                      className="max-w-44 truncate rounded px-1.5 py-0.5 hover:bg-indigo-500/20"
                    >
                      {label}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          <button
            onClick={() => setZoomBlockId(null)}
            className="shrink-0 rounded-lg border border-indigo-400/40 bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-medium text-indigo-100 hover:bg-indigo-500/30"
          >
            Zoom beenden
          </button>
        </div>
      )}

      {editorError && (
        <div className="mx-6 mt-3 flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-200">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {editorError}
          </span>
          <button
            onClick={() => setEditorError(null)}
            className="rounded p-0.5 hover:bg-rose-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Content + Optional Outline Panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-3xl">
            {/* Properties / Frontmatter Bar */}
            {!effectiveZenMode && !zoomState.isZoomed && (
              <div className="mb-6 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <Tag className="h-3 w-3 text-indigo-400" />
                  <span>Dokument-Properties & Tags</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {docBundle.document.tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-300"
                    >
                      <Hash className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                  {Object.entries(frontmatter)
                    .filter(([k]) => k !== "tags" && k !== "id")
                    .map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px]"
                      >
                        <span className="text-zinc-500">{k}:</span>
                        <span className="font-mono text-zinc-200">
                          {Array.isArray(v) ? v.join(", ") : String(v)}
                        </span>
                      </div>
                    ))}
                  <div className="flex items-center gap-1">
                    <input
                      value={newPropKey}
                      onChange={(e) => setNewPropKey(e.target.value)}
                      placeholder="key"
                      className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
                    />
                    <input
                      value={newPropVal}
                      onChange={(e) => setNewPropVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addFrontmatterProperty();
                      }}
                      placeholder="wert"
                      className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={addFrontmatterProperty}
                      className="rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-indigo-600 hover:text-white"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mode === "raw" ? (
              <textarea
                value={rawMarkdown}
                onChange={(e) => {
                  setRawMarkdown(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                className="h-[62vh] w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-indigo-500"
              />
            ) : mode === "preview" ? (
              <div className="space-y-4">
                {visibleIndices.map((idx) => {
                  const blk = blocks[idx];
                  const relativeDepth = Math.max(
                    0,
                    blk.depth - zoomState.rootDepth,
                  );
                  const isFindHit = matchingBlockIds.has(blk.id);
                  const isActiveHit = activeMatchBlockId === blk.id;
                  return (
                    <div
                      key={blk.id}
                      ref={(el) => {
                        blockWrapperRefs.current[blk.id] = el;
                      }}
                      className={
                        isActiveHit
                          ? "rounded-xl ring-1 ring-amber-400/70 bg-amber-500/5 px-2 py-1"
                          : isFindHit
                            ? "rounded-xl bg-amber-500/5 px-2 py-1"
                            : undefined
                      }
                    >
                      <PreviewBlock
                        block={blk}
                        relativeDepth={relativeDepth}
                        transclusions={transclusions}
                        onNavigate={onNavigate}
                        onToggleTask={() => cycleTaskInBlock(blk)}
                        loadHoverPreview={loadHoverPreview}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1.5">
                {visibleIndices.map((idx) => {
                  const blk = blocks[idx];
                  const hasChildren =
                    blocks[idx + 1] && blocks[idx + 1].depth > blk.depth;
                  const inlineRefs = extractBlockRefs(blk.rawContent);
                  const relativeDepth = Math.max(
                    0,
                    blk.depth - zoomState.rootDepth,
                  );
                  const isDragging = dragBlockId === blk.id;
                  const isDragOver =
                    dragOverBlockId === blk.id &&
                    dragBlockId !== null &&
                    dragBlockId !== blk.id;
                  const isFindHit = matchingBlockIds.has(blk.id);
                  const isActiveHit = activeMatchBlockId === blk.id;
                  const isMenuOpenForBlock = menu?.blockId === blk.id;

                  return (
                    <div
                      key={blk.id}
                      ref={(el) => {
                        blockWrapperRefs.current[blk.id] = el;
                      }}
                      style={{ marginLeft: `${relativeDepth * 24}px` }}
                      onDragOver={(e) => {
                        if (!dragBlockId || dragBlockId === blk.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverBlockId !== blk.id) {
                          setDragOverBlockId(blk.id);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverBlockId === blk.id) {
                          setDragOverBlockId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const src =
                          e.dataTransfer.getData("text/plain") || dragBlockId;
                        if (src) {
                          reorderBlockByIds(src, blk.id);
                        }
                        setDragBlockId(null);
                        setDragOverBlockId(null);
                      }}
                      className={`group relative rounded-xl border px-2 py-1 transition ${
                        isDragOver
                          ? "border-t-2 border-t-indigo-500 border-x-zinc-800 border-b-zinc-800 bg-indigo-500/10"
                          : isActiveHit
                            ? "border-amber-400/70 bg-amber-500/10"
                            : isFindHit
                              ? "border-amber-500/30 bg-amber-500/5"
                              : "border-transparent hover:border-zinc-800/90 hover:bg-zinc-900/35"
                      } ${isDragging ? "opacity-45" : ""}`}
                    >
                      {/* Hover / Focus Control Bar */}
                      <div className="mb-1 flex items-center justify-between gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                          <span
                            draggable
                            onDragStart={(e) => {
                              setDragBlockId(blk.id);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", blk.id);
                            }}
                            onDragEnd={() => {
                              setDragBlockId(null);
                              setDragOverBlockId(null);
                            }}
                            title="Block per Drag & Drop verschieben"
                            className="cursor-grab rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 active:cursor-grabbing"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>

                          {hasChildren && (
                            <button
                              onClick={() =>
                                updateBlock(blk.id, {
                                  collapsed: !blk.collapsed,
                                })
                              }
                              title={
                                blk.collapsed ? "Ausklappen" : "Einklappen"
                              }
                              className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
                            >
                              {blk.collapsed ? (
                                <ChevronRight className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}

                          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                            {blk.blockType}
                            {blk.headingLevel ? ` H${blk.headingLevel}` : ""}
                          </span>

                          <button
                            onClick={() => setZoomBlockId(blk.id)}
                            title="In diesen Block hineinzoomen (Hoisting)"
                            className="rounded p-0.5 hover:bg-indigo-500/20 hover:text-indigo-300"
                          >
                            <ZoomIn className="h-3 w-3" />
                          </button>

                          <button
                            onClick={() => moveBlock(idx, -1)}
                            title="Block nach oben"
                            className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => moveBlock(idx, 1)}
                            title="Block nach unten"
                            className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() =>
                              updateBlock(blk.id, {
                                depth: Math.max(0, blk.depth - 1),
                              })
                            }
                            title="Ausrücken (Shift+Tab)"
                            className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <Outdent className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() =>
                              updateBlock(blk.id, { depth: blk.depth + 1 })
                            }
                            title="Einrücken (Tab)"
                            className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <Indent className="h-3 w-3" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void handleCopyLazyBlockRef(blk)}
                            title="Lazy Block-ID in .md materialisieren & ((id)) kopieren"
                            className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-indigo-500/20 hover:text-indigo-300"
                          >
                            {copiedId === blk.id ? (
                              <>
                                <Check className="h-2.5 w-2.5 text-emerald-400" />
                                <span className="text-emerald-300">
                                  Kopiert
                                </span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-2.5 w-2.5" />
                                <span>
                                  {blk.hasExplicitId
                                    ? `^${blk.id}`
                                    : `((${blk.id}))`}
                                </span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => insertBlockAfter(idx, blk.depth)}
                            title="Block darunter einfügen"
                            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => removeBlock(idx)}
                            title="Block entfernen"
                            className="rounded p-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Block Body */}
                      <div className="flex items-start gap-2.5">
                        {blk.blockType === "listItem" && (
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                        )}
                        {blk.blockType === "taskItem" && (
                          <button
                            onClick={() => cycleTaskInBlock(blk)}
                            className="mt-1 shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-300 hover:border-indigo-400"
                          >
                            {blk.task?.status ?? "TODO"}
                          </button>
                        )}

                        {blk.blockType === "divider" ? (
                          <hr className="my-3 w-full border-zinc-800" />
                        ) : (
                          <textarea
                            ref={(el) => {
                              blockRefs.current[blk.id] = el;
                              autoResizeTextarea(el);
                            }}
                            value={blk.rawContent}
                            rows={1}
                            onFocus={() => setActiveBlockId(blk.id)}
                            onChange={(e) =>
                              handleContentChange(
                                blk,
                                e.target.value,
                                e.target.selectionStart ?? e.target.value.length,
                                e.target,
                              )
                            }
                            onKeyDown={(e) => {
                              // Autocomplete menu keyboard controls
                              if (isMenuOpenForBlock && menu) {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  setMenu(null);
                                  return;
                                }
                                if (activeMenuCount > 0) {
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setMenuIndex(
                                      (i) => (i + 1) % activeMenuCount,
                                    );
                                    return;
                                  }
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setMenuIndex(
                                      (i) =>
                                        (i - 1 + activeMenuCount) %
                                        activeMenuCount,
                                    );
                                    return;
                                  }
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    const safeIdx = Math.min(
                                      menuIndex,
                                      activeMenuCount - 1,
                                    );
                                    if (menu.kind === "slash") {
                                      const opt = filteredSlashOptions[safeIdx];
                                      if (opt) applySlashOption(blk, opt);
                                    } else if (menu.kind === "wiki") {
                                      const doc = filteredWikiDocs[safeIdx];
                                      if (doc) applyWikiSuggestion(blk, doc);
                                    } else if (menu.kind === "blockRef") {
                                      const cand = filteredBlockRefs[safeIdx];
                                      if (cand)
                                        applyBlockRefSuggestion(blk, cand);
                                    }
                                    return;
                                  }
                                }
                              }

                              // ArrowUp / ArrowDown navigation between visible blocks
                              const el = e.currentTarget;
                              if (
                                e.key === "ArrowUp" &&
                                !e.shiftKey &&
                                !e.altKey &&
                                !e.ctrlKey &&
                                !e.metaKey &&
                                el.selectionStart === 0 &&
                                el.selectionEnd === 0
                              ) {
                                e.preventDefault();
                                focusAdjacentVisibleBlock(idx, -1);
                                return;
                              }
                              if (
                                e.key === "ArrowDown" &&
                                !e.shiftKey &&
                                !e.altKey &&
                                !e.ctrlKey &&
                                !e.metaKey &&
                                el.selectionStart === el.value.length &&
                                el.selectionEnd === el.value.length
                              ) {
                                e.preventDefault();
                                focusAdjacentVisibleBlock(idx, 1);
                                return;
                              }

                              if (e.key === "Tab") {
                                e.preventDefault();
                                updateBlock(blk.id, {
                                  depth: e.shiftKey
                                    ? Math.max(0, blk.depth - 1)
                                    : blk.depth + 1,
                                });
                              } else if (
                                e.key === "Backspace" &&
                                blk.rawContent === "" &&
                                blocks.length > 1 &&
                                idx > 0
                              ) {
                                e.preventDefault();
                                const prevId = blocks[idx - 1].id;
                                removeBlock(idx);
                                setPendingFocus({
                                  blockId: prevId,
                                  position: "end",
                                });
                              } else if (
                                e.key === "Enter" &&
                                !e.shiftKey &&
                                blk.blockType !== "codeBlock" &&
                                blk.blockType !== "callout"
                              ) {
                                e.preventDefault();
                                insertBlockAfter(
                                  idx,
                                  blk.depth,
                                  blk.blockType === "listItem" ||
                                    blk.blockType === "taskItem"
                                    ? blk.blockType
                                    : "paragraph",
                                );
                              }
                            }}
                            placeholder="Tippe `/` für Blocktypen, `[[` für Wiki-Links oder `((` für Block-Refs..."
                            className={`w-full resize-none overflow-hidden bg-transparent outline-none placeholder-zinc-600 ${
                              blk.blockType === "heading"
                                ? blk.headingLevel === 1
                                  ? "text-2xl font-bold text-zinc-50"
                                  : blk.headingLevel === 2
                                    ? "text-xl font-semibold text-zinc-100"
                                    : "text-base font-semibold text-zinc-200"
                                : blk.blockType === "codeBlock"
                                  ? "rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 font-mono text-xs text-emerald-300"
                                  : blk.blockType === "callout"
                                    ? "rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm text-indigo-100"
                                    : blk.blockType === "quote"
                                      ? "border-l-2 border-indigo-500 pl-3 text-sm italic text-zinc-300"
                                      : "text-sm leading-relaxed text-zinc-200"
                            }`}
                          />
                        )}
                      </div>

                      {/* Keyboard-Driven Slash Command Menu */}
                      {isMenuOpenForBlock && menu.kind === "slash" && (
                        <div className="mt-1.5 rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                          <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] uppercase text-zinc-500">
                            <span>
                              Blocktyp wählen{" "}
                              {menu.query ? `• Filter: /${menu.query}` : ""}
                            </span>
                            <span className="font-mono">↑↓ Enter Esc</span>
                          </div>
                          {filteredSlashOptions.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-zinc-500">
                              Kein passender Blocktyp für „/{menu.query}“.
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                              {filteredSlashOptions.map((opt, optIdx) => {
                                const selected = optIdx === menuIndex;
                                return (
                                  <button
                                    key={opt.label}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setMenuIndex(optIdx)}
                                    onClick={() => applySlashOption(blk, opt)}
                                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                                      selected
                                        ? "bg-indigo-600/35 text-white ring-1 ring-indigo-500/50"
                                        : "text-zinc-200 hover:bg-zinc-800"
                                    }`}
                                  >
                                    {opt.type === "heading" ? (
                                      <Heading1 className="h-3.5 w-3.5 text-indigo-400" />
                                    ) : opt.type === "taskItem" ? (
                                      <CheckSquare className="h-3.5 w-3.5 text-emerald-400" />
                                    ) : opt.type === "listItem" ? (
                                      <List className="h-3.5 w-3.5 text-sky-400" />
                                    ) : opt.type === "codeBlock" ? (
                                      <Code2 className="h-3.5 w-3.5 text-amber-400" />
                                    ) : opt.type === "quote" ? (
                                      <Quote className="h-3.5 w-3.5 text-zinc-400" />
                                    ) : opt.type === "divider" ? (
                                      <Minus className="h-3.5 w-3.5 text-zinc-500" />
                                    ) : (
                                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                                    )}
                                    <span>{opt.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Keyboard-Driven Wiki-Link Autocomplete */}
                      {isMenuOpenForBlock && menu.kind === "wiki" && (
                        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
                          <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase text-zinc-500">
                            <span>
                              Wiki-Link einfügen{" "}
                              {menu.query ? `• Filter: ${menu.query}` : ""}
                            </span>
                            <span className="font-mono">↑↓ Enter Esc</span>
                          </div>
                          {filteredWikiDocs.length === 0 ? (
                            <div className="px-2.5 py-1.5 text-xs text-zinc-500">
                              Keine passende Notiz gefunden.
                            </div>
                          ) : (
                            filteredWikiDocs.map((d, dIdx) => {
                              const selected = dIdx === menuIndex;
                              return (
                                <button
                                  key={d.id}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onMouseEnter={() => setMenuIndex(dIdx)}
                                  onClick={() => applyWikiSuggestion(blk, d)}
                                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                    selected
                                      ? "bg-indigo-600/35 text-white ring-1 ring-indigo-500/50"
                                      : "text-zinc-200 hover:bg-zinc-800"
                                  }`}
                                >
                                  <span className="truncate font-medium">
                                    {d.title}
                                  </span>
                                  <span className="ml-2 shrink-0 text-[10px] text-zinc-500">
                                    {d.path}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}

                      {/* Keyboard-Driven Block-Ref Autocomplete */}
                      {isMenuOpenForBlock && menu.kind === "blockRef" && (
                        <div className="mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
                          <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase text-zinc-500">
                            <span>
                              Block-Referenz einfügen{" "}
                              {menu.query ? `• Filter: ${menu.query}` : ""}
                            </span>
                            <span className="font-mono">↑↓ Enter Esc</span>
                          </div>
                          {filteredBlockRefs.length === 0 ? (
                            <div className="px-2.5 py-1.5 text-xs text-zinc-500">
                              Kein passender Block gefunden.
                            </div>
                          ) : (
                            filteredBlockRefs.map((cand, cIdx) => {
                              const selected = cIdx === menuIndex;
                              return (
                                <button
                                  key={`${cand.blockId}-${cIdx}`}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onMouseEnter={() => setMenuIndex(cIdx)}
                                  onClick={() =>
                                    applyBlockRefSuggestion(blk, cand)
                                  }
                                  className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                    selected
                                      ? "bg-amber-500/25 text-white ring-1 ring-amber-400/50"
                                      : "text-zinc-200 hover:bg-zinc-800"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[10px] text-amber-300">
                                      (({cand.blockId}))
                                    </span>
                                    <span className="truncate text-[10px] text-zinc-500">
                                      {cand.isLocal
                                        ? "Dieses Dokument"
                                        : cand.docTitle}
                                    </span>
                                  </div>
                                  <span className="line-clamp-1 text-[11px] text-zinc-300">
                                    {cand.preview}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}

                      {/* Live Embedded Block Transclusions `((block-id))` */}
                      {inlineRefs.map((refId) => {
                        const target = transclusions[refId];
                        if (!target) return null;
                        return (
                          <div
                            key={refId}
                            onClick={() => onNavigate(target.docPath)}
                            className="mt-2 cursor-pointer rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 transition hover:border-amber-400/60"
                          >
                            <div className="mb-1 flex items-center justify-between text-[11px] text-amber-300">
                              <span className="flex items-center gap-1.5 font-semibold">
                                <Sparkles className="h-3 w-3" />
                                Live Block-Transklusion (({refId}))
                              </span>
                              <span className="text-zinc-400">
                                aus {target.docTitle} →
                              </span>
                            </div>
                            <p className="text-xs leading-relaxed text-zinc-200">
                              {target.block.plainText}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <button
                  onClick={() =>
                    insertBlockAfter(
                      zoomState.isZoomed ? zoomState.endIdx : blocks.length - 1,
                      zoomState.isZoomed ? zoomState.rootDepth + 1 : 0,
                    )
                  }
                  className="mt-3 flex items-center gap-1.5 rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-500 transition hover:border-indigo-500/50 hover:text-indigo-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Neuen Block anhängen
                </button>
              </div>
            )}

            {!effectiveZenMode && (
              <BacklinksPanel
                backlinks={backlinks}
                onNavigate={onNavigate}
                docId={docBundle.document.id}
                docTitle={docBundle.document.title}
                onMentionLinked={async () => {
                  await loadBacklinks(docBundle.document.id);
                  const fresh = await vaultApi
                    .getDocument(docBundle.document.path)
                    .catch(() => null);
                  if (fresh) await onSaved(fresh);
                }}
              />
            )}
          </div>
        </div>

        {/* Optional Outline Panel */}
        {showOutline && !effectiveZenMode && (
          <OutlinePanel
            blocks={blocks}
            activeBlockId={activeBlockId}
            onJumpToBlock={handleJumpToBlock}
            onClose={() => setShowOutline(false)}
          />
        )}
      </div>

      {/* History Modal */}
      <HistoryModal
        isOpen={historyOpen}
        docPath={docBundle.document.path}
        currentMarkdown={
          mode === "raw"
            ? rawMarkdown
            : dirty
              ? serializeBlocksToCleanMarkdown(blocks, frontmatter)
              : docBundle.rawMarkdown
        }
        onClose={() => setHistoryOpen(false)}
        onRestored={async (restoredDoc) => {
          await onSaved(restoredDoc);
        }}
      />
    </div>
  );
}

const CALLOUT_STYLES: Record<
  CalloutKind,
  {
    container: string;
    badge: string;
    title: string;
  }
> = {
  NOTE: {
    container: "border-indigo-500/35 bg-indigo-500/10 text-indigo-100",
    badge: "bg-indigo-500/25 text-indigo-200",
    title: "text-indigo-200",
  },
  INFO: {
    container: "border-sky-500/35 bg-sky-500/10 text-sky-100",
    badge: "bg-sky-500/25 text-sky-200",
    title: "text-sky-200",
  },
  TIP: {
    container: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
    badge: "bg-emerald-500/25 text-emerald-200",
    title: "text-emerald-200",
  },
  IMPORTANT: {
    container: "border-violet-500/35 bg-violet-500/10 text-violet-100",
    badge: "bg-violet-500/25 text-violet-200",
    title: "text-violet-200",
  },
  WARNING: {
    container: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    badge: "bg-amber-500/25 text-amber-200",
    title: "text-amber-200",
  },
  CAUTION: {
    container: "border-rose-500/40 bg-rose-500/10 text-rose-100",
    badge: "bg-rose-500/25 text-rose-200",
    title: "text-rose-200",
  },
};

function CalloutIcon({ kind }: { kind: CalloutKind }) {
  switch (kind) {
    case "TIP":
      return <Lightbulb className="h-3.5 w-3.5 text-emerald-400" />;
    case "IMPORTANT":
      return <Sparkles className="h-3.5 w-3.5 text-violet-400" />;
    case "WARNING":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
    case "CAUTION":
      return <Flame className="h-3.5 w-3.5 text-rose-400" />;
    case "INFO":
      return <Info className="h-3.5 w-3.5 text-sky-400" />;
    case "NOTE":
    default:
      return <Info className="h-3.5 w-3.5 text-indigo-400" />;
  }
}

function CodeBlockPreview({ block }: { block: Block }) {
  const [copied, setCopied] = useState(false);
  const lang = block.codeLang?.trim() || "text";

  const handleCopy = () => {
    void navigator.clipboard?.writeText(block.rawContent).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/60 px-3.5 py-1.5">
        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300">
          {lang}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-300">Kopiert</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Kopieren</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-emerald-300">
        {block.rawContent}
      </pre>
    </div>
  );
}

function WikiLinkPreviewChip({
  target,
  alias,
  onNavigate,
  loadHoverPreview,
}: {
  target: string;
  alias: string | null;
  onNavigate: (target: string) => void;
  loadHoverPreview: (target: string) => Promise<HoverDocPreview | "not_found">;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<HoverDocPreview | "not_found" | null>(
    null,
  );
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
      if (preview === null) {
        setLoading(true);
        void loadHoverPreview(target)
          .then(setPreview)
          .finally(() => setLoading(false));
      }
    }, 180);
  };

  const handleMouseLeave = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => onNavigate(target)}
        className="mx-0.5 inline rounded bg-indigo-500/15 px-1.5 py-0.5 font-medium text-indigo-300 underline decoration-indigo-500/40 underline-offset-2 hover:bg-indigo-500/25"
      >
        {alias ?? target}
      </button>

      {open && (
        <div className="pointer-events-none absolute left-0 bottom-full z-40 mb-2 w-72 rounded-xl border border-zinc-700/90 bg-zinc-900/95 p-3 text-left shadow-2xl backdrop-blur-xs">
          {loading ? (
            <div className="text-[11px] text-zinc-400">
              Lade Vorschau für „{target}“...
            </div>
          ) : preview === "not_found" || preview === null ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-indigo-300">
                {target}
              </div>
              <p className="text-[11px] text-zinc-400">
                Notiz existiert noch nicht — klicken zum Erstellen.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-zinc-100">
                  {preview.title}
                </span>
              </div>
              <div className="truncate font-mono text-[10px] text-zinc-500">
                {preview.path}
              </div>
              {preview.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {preview.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] text-indigo-300"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <p className="line-clamp-4 text-[11px] leading-relaxed text-zinc-300">
                {preview.snippet}
              </p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function PreviewBlock({
  block,
  relativeDepth,
  transclusions,
  onNavigate,
  onToggleTask,
  loadHoverPreview,
}: {
  block: Block;
  relativeDepth: number;
  transclusions: Record<string, BlockLookup>;
  onNavigate: (target: string) => void;
  onToggleTask: () => void;
  loadHoverPreview: (target: string) => Promise<HoverDocPreview | "not_found">;
}) {
  const inlineRefs = extractBlockRefs(block.rawContent);

  if (block.blockType === "divider") {
    return <hr className="my-4 border-zinc-800" />;
  }
  if (block.blockType === "codeBlock") {
    return (
      <div style={{ marginLeft: `${relativeDepth * 24}px` }}>
        <CodeBlockPreview block={block} />
      </div>
    );
  }
  if (block.blockType === "heading") {
    const cls =
      block.headingLevel === 1
        ? "text-2xl font-bold text-zinc-50 pt-2"
        : block.headingLevel === 2
          ? "text-xl font-semibold text-zinc-100 pt-2"
          : "text-base font-semibold text-zinc-200 pt-1";
    return (
      <div className={cls} style={{ marginLeft: `${relativeDepth * 24}px` }}>
        {renderRichText(block.rawContent, onNavigate, loadHoverPreview)}
      </div>
    );
  }

  return (
    <div style={{ marginLeft: `${relativeDepth * 24}px` }} className="space-y-2">
      {block.blockType === "callout" ? (
        (() => {
          const parsed = parseCalloutHeader(block.rawContent);
          const style = CALLOUT_STYLES[parsed.kind];
          return (
            <div className={`rounded-xl border p-4 text-sm ${style.container}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <CalloutIcon kind={parsed.kind} />
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${style.badge}`}
                >
                  {parsed.kind}
                </span>
                <span className={`font-semibold ${style.title}`}>
                  {parsed.title}
                </span>
              </div>
              {parsed.body && (
                <div className="space-y-1 text-sm leading-relaxed">
                  {parsed.body.split("\n").map((line, i) => (
                    <p key={i}>
                      {renderRichText(line, onNavigate, loadHoverPreview)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })()
      ) : block.blockType === "quote" ? (
        <blockquote className="border-l-2 border-indigo-500 pl-4 text-sm italic text-zinc-300">
          {renderRichText(block.rawContent, onNavigate, loadHoverPreview)}
        </blockquote>
      ) : block.blockType === "taskItem" ? (
        <div className="flex items-start gap-2.5 text-sm text-zinc-200">
          <button
            onClick={onToggleTask}
            className="mt-0.5 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-300"
          >
            {block.task?.status ?? "TODO"}
          </button>
          <span
            className={
              block.task?.status === "DONE" ? "text-zinc-500 line-through" : ""
            }
          >
            {renderRichText(block.rawContent, onNavigate, loadHoverPreview)}
          </span>
        </div>
      ) : block.blockType === "listItem" ? (
        <div className="flex items-start gap-2.5 text-sm text-zinc-200">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
          <div>
            {renderRichText(block.rawContent, onNavigate, loadHoverPreview)}
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-zinc-200">
          {renderRichText(block.rawContent, onNavigate, loadHoverPreview)}
        </p>
      )}

      {inlineRefs.map((refId) => {
        const target = transclusions[refId];
        if (!target) return null;
        return (
          <div
            key={refId}
            onClick={() => onNavigate(target.docPath)}
            className="cursor-pointer rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 transition hover:border-amber-400/60"
          >
            <div className="mb-1 flex items-center justify-between text-[11px] text-amber-300">
              <span className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="h-3 w-3" />
                Live Block-Transklusion (({refId}))
              </span>
              <span className="text-zinc-400">aus {target.docTitle} →</span>
            </div>
            <p className="text-xs leading-relaxed text-zinc-200">
              {target.block.plainText}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function renderRichText(
  text: string,
  onNavigate: (target: string) => void,
  loadHoverPreview: (target: string) => Promise<HoverDocPreview | "not_found">,
): React.ReactNode {
  const cleaned = stripExplicitBlockIds(text);
  const tokens = parseInlineTokens(cleaned);

  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case "wikiLink":
        return (
          <WikiLinkPreviewChip
            key={idx}
            target={tok.target}
            alias={tok.alias}
            onNavigate={onNavigate}
            loadHoverPreview={loadHoverPreview}
          />
        );
      case "blockRef":
        return (
          <span
            key={idx}
            className="mx-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs text-amber-300"
          >
            (({tok.blockId}))
          </span>
        );
      case "bold":
        return (
          <strong key={idx} className="font-semibold text-zinc-50">
            {tok.text}
          </strong>
        );
      case "italic":
        return (
          <em key={idx} className="italic text-zinc-100">
            {tok.text}
          </em>
        );
      case "strike":
        return (
          <del key={idx} className="text-zinc-500 line-through">
            {tok.text}
          </del>
        );
      case "code":
        return (
          <code
            key={idx}
            className="mx-0.5 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[12px] text-emerald-300"
          >
            {tok.text}
          </code>
        );
      case "externalLink":
        return (
          <a
            key={idx}
            href={tok.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-0.5 inline-flex items-center gap-0.5 text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
          >
            <span>{tok.label}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      case "text":
      default:
        return <span key={idx}>{tok.text}</span>;
    }
  });
}
