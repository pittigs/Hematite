import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy,
  Download, Eye, FileCode2, FileDown, GripVertical, Hash, History, ImagePlus,
  Indent, ListTree, Maximize2, Minimize2, Outdent, Pencil, PenLine, Plus,
  Redo2, Save, Search, Tag, Trash2, Undo2, X, ZoomIn,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type {
  BacklinkItem, Block, BlockLookup, BlockType, DocumentSummary,
  DocumentWithBlocks, SearchResult,
} from "../types/vault";
import { renderDocumentToStandaloneHtml, stripExplicitBlockIds } from "../utils/markdownRich";
import { BacklinksPanel } from "./BacklinksPanel";
import { HistoryModal } from "./HistoryModal";
import { OutlinePanel } from "./OutlinePanel";
import { AutocompleteMenu } from "./editor/AutocompleteMenu";
import { FindReplaceBar } from "./editor/FindReplaceBar";
import { AssetImagePreview, PreviewBlock, TransclusionCard } from "./editor/PreviewBlock";
import {
  type AutocompleteMenuState, type BlockRefCandidate, type HoverDocPreview,
  MAX_HISTORY, type PendingFocus, type SlashOption,
  applyInlineInsertion, autoResizeTextarea, buildBlockRefCandidates,
  buildHoverPreviewFromDoc, buildNextTaskPatch, buildSlashOptionPatch,
  cloneBlocks, computeFindMatches, computeFocusRange,
  computeVisibleBlockIndices, computeZoomState, createNewBlock,
  detectAutocomplete, extractBlockRefs, extractImageEmbeds, fileToBase64,
  filterSlashOptions, filterWikiDocs, getBlockTextareaClassName,
  getClipboardImageFile, moveBlockInList, reorderBlockList,
  replaceAllInBlocks, replaceAllOccurrences, replaceMatchInBlocks,
  serializeBlocksToCleanMarkdown, slugifyFilename, triggerFileDownload,
} from "./editor/editorHelpers";

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

export function HybridEditor({
  docBundle, allDocuments, onSaved, onNavigate,
  onDeleteDocument, onRenameDocument, isZenMode, onToggleZenMode,
}: HybridEditorProps) {
  const [mode, setMode] = useState<"hybrid" | "preview" | "raw">("hybrid");
  const [blocks, setBlocks] = useState<Block[]>(docBundle.blocks);
  const [rawMarkdown, setRawMarkdown] = useState(docBundle.rawMarkdown);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [transclusions, setTransclusions] = useState<Record<string, BlockLookup>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [undoStack, setUndoStack] = useState<Block[][]>([]);
  const [redoStack, setRedoStack] = useState<Block[][]>([]);
  const blocksRef = useRef<Block[]>(docBundle.blocks);
  blocksRef.current = blocks;
  const lastEditMetaRef = useRef<{ blockId: string; ts: number } | null>(null);
  const lastDocIdRef = useRef<string>(docBundle.document.id);

  const [menu, setMenu] = useState<AutocompleteMenuState | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [remoteBlockRefs, setRemoteBlockRefs] = useState<SearchResult[]>([]);

  const [zoomBlockId, setZoomBlockId] = useState<string | null>(null);
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [isDraggingImageFile, setIsDraggingImageFile] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const [showOutline, setShowOutline] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localZenMode, setLocalZenMode] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const [newPropKey, setNewPropKey] = useState("");
  const [newPropVal, setNewPropVal] = useState("");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(docBundle.document.frontmatter);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(docBundle.document.path);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);

  const blockRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const blockWrapperRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hoverDocCacheRef = useRef<Record<string, HoverDocPreview | "not_found">>({});

  const effectiveZenMode = isZenMode ?? localZenMode;
  const handleToggleZen = useCallback(() => {
    if (onToggleZenMode) onToggleZenMode();
    else setLocalZenMode((v) => !v);
  }, [onToggleZenMode]);

  const loadBacklinks = useCallback(async (docId: string) => {
    try {
      setBacklinks(await vaultApi.getBacklinks(docId));
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
      setZoomBlockId((curr) =>
        curr && docBundle.blocks.some((b) => b.id === curr) ? curr : null,
      );
    }
    void loadBacklinks(docBundle.document.id);
  }, [docBundle, loadBacklinks]);

  // Auto-resize all visible block textareas on render/updates
  useLayoutEffect(() => {
    if (mode !== "hybrid") return;
    for (const el of Object.values(blockRefs.current)) autoResizeTextarea(el);
  }, [blocks, mode, zoomBlockId, showOutline, effectiveZenMode]);

  // Focus newly inserted or targeted block textarea
  useEffect(() => {
    if (!pendingFocus) return;
    const el = blockRefs.current[pendingFocus.blockId];
    if (!el) return;
    el.focus();
    const { start, end } = computeFocusRange(el.value.length, pendingFocus);
    el.setSelectionRange(start, end);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setActiveBlockId(pendingFocus.blockId);
    setPendingFocus(null);
  }, [blocks, pendingFocus, zoomBlockId, mode]);

  // Resolve `((block-id))` references inside blocks for live transclusion
  useEffect(() => {
    const refIds = new Set<string>();
    for (const blk of blocks) {
      for (const refId of extractBlockRefs(blk.rawContent)) refIds.add(refId);
    }
    if (refIds.size === 0) {
      setTransclusions({});
      return;
    }
    let cancelled = false;
    Promise.all(
      Array.from(refIds).map(async (id) => [id, await vaultApi.getBlockById(id).catch(() => null)] as const),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, BlockLookup> = {};
      for (const [id, val] of entries) {
        if (val) map[id] = val;
      }
      setTransclusions(map);
    });
    return () => { cancelled = true; };
  }, [blocks]);

  // Fetch cross-vault block candidates when `((` autocomplete has a query
  useEffect(() => {
    if (!menu || menu.kind !== "blockRef" || menu.query.trim().length < 2) {
      setRemoteBlockRefs([]);
      return;
    }
    let cancelled = false;
    const q = menu.query.trim();
    const timer = window.setTimeout(() => {
      vaultApi.searchVault(q, 10)
        .then((res) => { if (!cancelled) setRemoteBlockRefs(res.results); })
        .catch(() => { if (!cancelled) setRemoteBlockRefs([]); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [menu]);

  // Bounded Undo/Redo block commit
  const commitBlocks = useCallback(
    (nextBlocks: Block[], options?: { coalesceBlockId?: string; skipHistory?: boolean }) => {
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
      setRedoStack((prevRedo) => [...prevRedo.slice(-(MAX_HISTORY - 1)), currentSnapshot]);
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
      setUndoStack((prevUndo) => [...prevUndo.slice(-(MAX_HISTORY - 1)), currentSnapshot]);
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
          ? await vaultApi.saveMarkdownDocument(docBundle.document.path, rawMarkdown)
          : await vaultApi.saveDocumentBlocks(
              docBundle.document.path,
              { ...docBundle.document, frontmatter },
              blocksRef.current,
            );
      setDirty(false);
      await onSaved(updated);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }, [docBundle.document, frontmatter, mode, onSaved, rawMarkdown]);

  // Global keyboard shortcuts: Ctrl+S, Ctrl+F, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (!saving) void handleSave();
      } else if (key === "f") {
        e.preventDefault();
        setFindOpen(true);
        window.requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
      } else if (mode !== "raw" && (e.target as HTMLElement | null)?.tagName !== "INPUT") {
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((key === "z" && e.shiftKey) || key === "y") {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleSave, handleUndo, mode, saving]);

  // Debounced Auto-Save (1.5s) & beforeunload protection
  useEffect(() => {
    if (!autoSave || !dirty || saving) return;
    const timer = window.setTimeout(() => void handleSave(), 1500);
    return () => window.clearTimeout(timer);
  }, [autoSave, dirty, saving, handleSave]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Derived zoom, visibility, autocomplete & search memos
  const zoomState = useMemo(() => computeZoomState(blocks, zoomBlockId), [blocks, zoomBlockId]);
  const visibleIndices = useMemo(
    () => computeVisibleBlockIndices(blocks, zoomState, mode),
    [blocks, zoomState, mode],
  );
  const filteredSlashOptions = useMemo(() => filterSlashOptions(menu), [menu]);
  const filteredWikiDocs = useMemo(() => filterWikiDocs(menu, allDocuments), [allDocuments, menu]);
  const filteredBlockRefs = useMemo(
    () => buildBlockRefCandidates(menu, blocks, docBundle.document.title, docBundle.document.path, remoteBlockRefs),
    [blocks, docBundle.document.path, docBundle.document.title, menu, remoteBlockRefs],
  );

  const activeMenuCount =
    menu?.kind === "slash" ? filteredSlashOptions.length
      : menu?.kind === "wiki" ? filteredWikiDocs.length
        : menu?.kind === "blockRef" ? filteredBlockRefs.length : 0;

  useEffect(() => { setMenuIndex(0); }, [menu?.kind, menu?.blockId, menu?.query]);

  const findMatches = useMemo(
    () => computeFindMatches(findOpen, findQuery, mode, rawMarkdown, blocks, findCaseSensitive),
    [blocks, findCaseSensitive, findOpen, findQuery, mode, rawMarkdown],
  );

  useEffect(() => {
    if (findMatches.length === 0 || activeMatchIdx >= findMatches.length) setActiveMatchIdx(0);
  }, [activeMatchIdx, findMatches.length]);

  const jumpToMatch = useCallback((idx: number) => {
    if (findMatches.length === 0) return;
    const safeIdx = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
    setActiveMatchIdx(safeIdx);
    const match = findMatches[safeIdx];
    if (!match.blockId) return;
    if (
      zoomBlockId && match.blockIndex !== undefined &&
      (match.blockIndex < zoomState.startIdx || match.blockIndex > zoomState.endIdx)
    ) {
      setZoomBlockId(null);
    }
    if (mode === "hybrid") {
      setPendingFocus({ blockId: match.blockId, position: match.start, selectionEnd: match.end });
    } else {
      blockWrapperRefs.current[match.blockId]?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [findMatches, mode, zoomBlockId, zoomState.endIdx, zoomState.startIdx]);

  const handleReplaceCurrent = () => {
    if (!findQuery || findMatches.length === 0) return;
    const match = findMatches[activeMatchIdx] ?? findMatches[0];
    if (mode === "raw") {
      setRawMarkdown(rawMarkdown.slice(0, match.start) + replaceQuery + rawMarkdown.slice(match.end));
      setDirty(true);
    } else if (match.blockId) {
      commitBlocks(replaceMatchInBlocks(blocksRef.current, match, replaceQuery));
    }
  };

  const handleReplaceAll = () => {
    if (!findQuery || findMatches.length === 0) return;
    if (mode === "raw") {
      setRawMarkdown(replaceAllOccurrences(rawMarkdown, findQuery, replaceQuery, findCaseSensitive));
      setDirty(true);
    } else {
      commitBlocks(replaceAllInBlocks(blocksRef.current, findQuery, replaceQuery, findCaseSensitive));
    }
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
      if (dirty) await handleSave();
      await onRenameDocument(docBundle.document.path, target);
      setRenaming(false);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Umbenennen fehlgeschlagen.");
    }
  };

  const updateBlock = useCallback(
    (blockId: string, patch: Partial<Block>, options?: { coalesceBlockId?: string; skipHistory?: boolean }) => {
      commitBlocks(
        blocksRef.current.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
        options,
      );
    },
    [commitBlocks],
  );

  // Image Upload, Paste & Drop (#34)
  const uploadImageFile = useCallback(async (file: File): Promise<string | null> => {
    setUploadingImage(true);
    setEditorError(null);
    try {
      const base64 = await fileToBase64(file);
      return await vaultApi.saveAsset(file.name?.trim() || "pasted.png", base64);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Bild-Upload fehlgeschlagen.");
      return null;
    } finally {
      setUploadingImage(false);
    }
  }, []);

  const insertImageBlock = useCallback(
    (relPath: string) => {
      const embed = `![[${relPath}]]`;
      if (mode === "raw") {
        setRawMarkdown((prev) =>
          prev.trim().length > 0 ? `${prev.trimEnd()}\n\n${embed}\n` : `${embed}\n`,
        );
        setDirty(true);
        return;
      }
      const current = blocksRef.current;
      const activeIdx = activeBlockId ? current.findIndex((b) => b.id === activeBlockId) : -1;
      const afterIdx = activeIdx >= 0 ? activeIdx : zoomState.isZoomed ? zoomState.endIdx : current.length - 1;
      const depth = activeIdx >= 0 ? current[activeIdx].depth : zoomState.isZoomed ? zoomState.rootDepth + 1 : 0;
      const newBlock = createNewBlock(docBundle.document.id, afterIdx, depth, "paragraph", embed);
      const next = [...current];
      next.splice(afterIdx + 1, 0, newBlock);
      commitBlocks(next);
      if (mode === "hybrid") setPendingFocus({ blockId: newBlock.id, position: "end" });
    },
    [activeBlockId, commitBlocks, docBundle.document.id, mode, zoomState.endIdx, zoomState.isZoomed, zoomState.rootDepth],
  );

  const handlePasteInBlock = useCallback(
    async (blockId: string, e: ClipboardEvent<HTMLTextAreaElement>) => {
      const imgFile = getClipboardImageFile(e.clipboardData);
      if (!imgFile) return;
      e.preventDefault();
      const relPath = await uploadImageFile(imgFile);
      if (!relPath) return;
      const latest = blocksRef.current.find((b) => b.id === blockId);
      if (!latest) return;
      const embed = `![[${relPath}]]`;
      const nextContent = latest.rawContent.trim().length === 0 ? embed : `${latest.rawContent}\n${embed}`;
      updateBlock(blockId, { rawContent: nextContent, plainText: nextContent });
      setPendingFocus({ blockId, position: "end" });
    },
    [updateBlock, uploadImageFile],
  );

  const handlePasteInRaw = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const imgFile = getClipboardImageFile(e.clipboardData);
      if (!imgFile) return;
      e.preventDefault();
      const start = e.currentTarget.selectionStart ?? rawMarkdown.length;
      const end = e.currentTarget.selectionEnd ?? rawMarkdown.length;
      const relPath = await uploadImageFile(imgFile);
      if (!relPath) return;
      setRawMarkdown((prev) => `${prev.slice(0, start)}![[${relPath}]]${prev.slice(end)}`);
      setDirty(true);
    },
    [rawMarkdown.length, uploadImageFile],
  );

  const handleImageFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const relPath = await uploadImageFile(file);
      if (!relPath) return;
      if (mode === "hybrid" && activeBlockId) {
        const activeBlk = blocksRef.current.find((b) => b.id === activeBlockId);
        if (activeBlk && activeBlk.blockType !== "divider" && activeBlk.rawContent.trim() === "") {
          const embed = `![[${relPath}]]`;
          updateBlock(activeBlk.id, { rawContent: embed, plainText: embed });
          setPendingFocus({ blockId: activeBlk.id, position: "end" });
          return;
        }
      }
      insertImageBlock(relPath);
    },
    [activeBlockId, insertImageBlock, mode, updateBlock, uploadImageFile],
  );

  const handleContainerDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (dragBlockId || !Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDraggingImageFile) setIsDraggingImageFile(true);
  }, [dragBlockId, isDraggingImageFile]);

  const handleContainerDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (isDraggingImageFile && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingImageFile(false);
    }
  }, [isDraggingImageFile]);

  const handleContainerDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    if (dragBlockId) return;
    const imageFiles = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setIsDraggingImageFile(false);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    for (const file of imageFiles) {
      const relPath = await uploadImageFile(file);
      if (relPath) insertImageBlock(relPath);
    }
  }, [dragBlockId, insertImageBlock, uploadImageFile]);

  // Block operations
  const handleContentChange = (block: Block, value: string, cursorPos: number, el: HTMLTextAreaElement) => {
    autoResizeTextarea(el);
    updateBlock(block.id, { rawContent: value, plainText: value }, { coalesceBlockId: block.id });
    setMenu(detectAutocomplete(block.id, value, cursorPos));
  };

  const applySlashOption = (block: Block, opt: SlashOption) => {
    updateBlock(block.id, buildSlashOptionPatch(opt));
    setMenu(null);
    if (opt.type !== "divider") setPendingFocus({ blockId: block.id, position: "end" });
  };

  const applyWikiSuggestion = (block: Block, doc: DocumentSummary) => {
    if (!menu || menu.kind !== "wiki") return;
    const { nextValue, nextCursor } = applyInlineInsertion(block.rawContent, menu.triggerStart, menu.triggerEnd, `[[${doc.title}]]`);
    updateBlock(block.id, { rawContent: nextValue, plainText: nextValue });
    setMenu(null);
    setPendingFocus({ blockId: block.id, position: nextCursor });
  };

  const applyBlockRefSuggestion = (block: Block, candidate: BlockRefCandidate) => {
    if (!menu || menu.kind !== "blockRef") return;
    const { nextValue, nextCursor } = applyInlineInsertion(block.rawContent, menu.triggerStart, menu.triggerEnd, `((${candidate.blockId}))`);
    updateBlock(block.id, { rawContent: nextValue, plainText: nextValue });
    setMenu(null);
    setPendingFocus({ blockId: block.id, position: nextCursor });
  };

  const insertBlockAfter = (index: number, depth = 0, blockType: BlockType = "paragraph") => {
    const newBlock = createNewBlock(docBundle.document.id, index, depth, blockType);
    const next = [...blocksRef.current];
    next.splice(index + 1, 0, newBlock);
    commitBlocks(next);
    setPendingFocus({ blockId: newBlock.id, position: "start" });
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const next = moveBlockInList(blocksRef.current, index, dir);
    if (next) commitBlocks(next);
  };

  const reorderBlockByIds = (sourceId: string, targetId: string) => {
    const next = reorderBlockList(blocksRef.current, sourceId, targetId);
    if (next) commitBlocks(next);
  };

  const removeBlock = (index: number) => {
    if (blocksRef.current.length <= 1) return;
    const removed = blocksRef.current[index];
    if (removed && zoomBlockId === removed.id) setZoomBlockId(null);
    commitBlocks(blocksRef.current.filter((_, idx) => idx !== index));
  };

  const handleCopyLazyBlockRef = async (block: Block) => {
    if (dirty) await handleSave();
    const materializedId = await vaultApi.materializeBlockId(docBundle.document.path, block.id);
    updateBlock(block.id, { hasExplicitId: true }, { skipHistory: true });
    await navigator.clipboard?.writeText(`((${materializedId}))`).catch(() => {});
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

  const cycleTaskInBlock = (blk: Block) => updateBlock(blk.id, buildNextTaskPatch(blk));

  const handleJumpToBlock = useCallback((blockId: string) => {
    const targetIdx = blocksRef.current.findIndex((b) => b.id === blockId);
    if (targetIdx === -1) return;
    if (zoomState.isZoomed && (targetIdx < zoomState.startIdx || targetIdx > zoomState.endIdx)) {
      setZoomBlockId(null);
    }
    setActiveBlockId(blockId);
    if (mode === "raw") {
      setMode("hybrid");
      setPendingFocus({ blockId, position: "end" });
    } else if (mode === "hybrid") {
      setPendingFocus({ blockId, position: "end" });
    } else {
      blockWrapperRefs.current[blockId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [mode, zoomState.endIdx, zoomState.isZoomed, zoomState.startIdx]);

  const handleExportCleanMarkdown = () => {
    const sourceMd =
      mode === "raw" ? rawMarkdown
        : dirty ? serializeBlocksToCleanMarkdown(blocks, frontmatter)
          : docBundle.rawMarkdown;
    const name = `${slugifyFilename(docBundle.document.title || docBundle.document.path)}.md`;
    triggerFileDownload(name, stripExplicitBlockIds(sourceMd), "text/markdown;charset=utf-8");
  };

  const handleExportHtml = () => {
    const html = renderDocumentToStandaloneHtml(docBundle.document.title || docBundle.document.path, blocks);
    const name = `${slugifyFilename(docBundle.document.title || docBundle.document.path)}.html`;
    triggerFileDownload(name, html, "text/html;charset=utf-8");
  };

  const focusAdjacentVisibleBlock = (currentBlockIdx: number, direction: -1 | 1) => {
    const posInVisible = visibleIndices.indexOf(currentBlockIdx);
    if (posInVisible === -1) return;
    for (let cursor = posInVisible + direction; cursor >= 0 && cursor < visibleIndices.length; cursor += direction) {
      const candidate = blocks[visibleIndices[cursor]];
      if (candidate && candidate.blockType !== "divider") {
        setPendingFocus({ blockId: candidate.id, position: direction === -1 ? "end" : "start" });
        return;
      }
    }
  };

  const handleBlockKeyDown = (blk: Block, idx: number, e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (menu?.blockId === blk.id) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
      if (activeMenuCount > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMenuIndex((i) => (i + 1) % activeMenuCount);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMenuIndex((i) => (i - 1 + activeMenuCount) % activeMenuCount);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const safeIdx = Math.min(menuIndex, activeMenuCount - 1);
          if (menu.kind === "slash" && filteredSlashOptions[safeIdx]) {
            applySlashOption(blk, filteredSlashOptions[safeIdx]);
          } else if (menu.kind === "wiki" && filteredWikiDocs[safeIdx]) {
            applyWikiSuggestion(blk, filteredWikiDocs[safeIdx]);
          } else if (menu.kind === "blockRef" && filteredBlockRefs[safeIdx]) {
            applyBlockRefSuggestion(blk, filteredBlockRefs[safeIdx]);
          }
          return;
        }
      }
    }

    const el = e.currentTarget;
    const noMod = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.key === "ArrowUp" && noMod && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      focusAdjacentVisibleBlock(idx, -1);
    } else if (e.key === "ArrowDown" && noMod && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      e.preventDefault();
      focusAdjacentVisibleBlock(idx, 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      updateBlock(blk.id, { depth: e.shiftKey ? Math.max(0, blk.depth - 1) : blk.depth + 1 });
    } else if (e.key === "Backspace" && blk.rawContent === "" && blocks.length > 1 && idx > 0) {
      e.preventDefault();
      const prevId = blocks[idx - 1].id;
      removeBlock(idx);
      setPendingFocus({ blockId: prevId, position: "end" });
    } else if (e.key === "Enter" && !e.shiftKey && blk.blockType !== "codeBlock" && blk.blockType !== "callout") {
      e.preventDefault();
      insertBlockAfter(
        idx,
        blk.depth,
        blk.blockType === "listItem" || blk.blockType === "taskItem" ? blk.blockType : "paragraph",
      );
    }
  };

  const loadHoverPreview = useCallback(async (target: string): Promise<HoverDocPreview | "not_found"> => {
    const key = target.trim().toLowerCase();
    const cached = hoverDocCacheRef.current[key];
    if (cached) return cached;
    try {
      const doc = await vaultApi.getDocument(target);
      return (hoverDocCacheRef.current[key] = doc ? buildHoverPreviewFromDoc(doc) : "not_found");
    } catch {
      return (hoverDocCacheRef.current[key] = "not_found");
    }
  }, []);

  const matchingBlockIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of findMatches) {
      if (m.blockId) set.add(m.blockId);
    }
    return set;
  }, [findMatches]);
  const activeMatchBlockId = findMatches[activeMatchIdx]?.blockId ?? null;

  return (
    <div
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={(e) => void handleContainerDrop(e)}
      className={`relative flex h-full flex-col overflow-hidden bg-zinc-950 ${
        isDraggingImageFile ? "ring-2 ring-inset ring-indigo-500/70" : ""
      }`}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleImageFileSelect(e)}
      />

      {isDraggingImageFile && (
        <div className="pointer-events-none absolute inset-4 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400 bg-zinc-950/85 backdrop-blur-xs">
          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-5 py-3 text-sm font-medium text-indigo-200 shadow-xl">
            <ImagePlus className="h-5 w-5 text-indigo-300" />
            <span>Bild hier ablegen, um es in assets/ einzubetten</span>
          </div>
        </div>
      )}

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
                    if (e.key === "Escape") { setRenaming(false); setRenameValue(docBundle.document.path); }
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
                  onClick={() => { setRenaming(false); setRenameValue(docBundle.document.path); }}
                  title="Abbrechen"
                  className="rounded-lg bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setRenameValue(docBundle.document.path); setRenaming(true); }}
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
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">Ungespeichert</span>
            ) : (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Gespeichert</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {mode !== "raw" && (
            <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
              <button onClick={handleUndo} disabled={undoStack.length === 0} title="Rückgängig (Ctrl+Z)" className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30">
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleRedo} disabled={redoStack.length === 0} title="Wiederholen (Ctrl+Shift+Z / Ctrl+Y)" className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30">
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            title="Bild einfügen (Upload nach assets/)"
            className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{uploadingImage ? "Lädt..." : "Bild einfügen"}</span>
          </button>

          <button
            onClick={() => {
              setFindOpen((prev) => {
                const next = !prev;
                if (next) window.requestAnimationFrame(() => findInputRef.current?.focus());
                return next;
              });
            }}
            title="Suchen & Ersetzen (Ctrl+F)"
            className={`rounded-xl border p-1.5 transition ${findOpen ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setShowOutline((v) => !v)}
            title="Gliederung & Dokumentstatistik umschalten"
            className={`flex items-center gap-1 rounded-xl border px-2 py-1.5 text-[11px] font-medium transition ${showOutline ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
          >
            <ListTree className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Gliederung</span>
          </button>

          <button
            onClick={() => setHistoryOpen(true)}
            title="Versionsverlauf (Snapshots)"
            className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Verlauf</span>
          </button>

          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
            <button onClick={handleExportCleanMarkdown} title="Sauberes Markdown (.md ohne ^block-id) exportieren" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100">
              <FileDown className="h-3.5 w-3.5" />
              <span>.md</span>
            </button>
            <button onClick={handleExportHtml} title="Eigenständiges HTML (.html) exportieren" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100">
              <Download className="h-3.5 w-3.5" />
              <span>.html</span>
            </button>
          </div>

          <button
            onClick={handleToggleZen}
            title={effectiveZenMode ? "Zen-Modus beenden" : "Zen-Modus (Fokusansicht)"}
            className={`rounded-xl border p-1.5 transition ${effectiveZenMode ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
          >
            {effectiveZenMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          <button
            onClick={() => setAutoSave((v) => !v)}
            title="Automatisches Speichern nach 1,5 Sekunden umschalten"
            className={`rounded-xl border px-2.5 py-1 text-[11px] font-medium transition ${autoSave ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}
          >
            Auto-Save: {autoSave ? "An" : "Aus"}
          </button>

          <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
            <button onClick={() => setMode("hybrid")} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${mode === "hybrid" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>
              <PenLine className="h-3.5 w-3.5" />Hybrid-Editor
            </button>
            <button onClick={() => setMode("preview")} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${mode === "preview" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>
              <Eye className="h-3.5 w-3.5" />Leseansicht
            </button>
            <button onClick={() => setMode("raw")} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${mode === "raw" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>
              <FileCode2 className="h-3.5 w-3.5" />Markdown
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
              if (window.confirm(`Notiz "${docBundle.document.path}" wirklich löschen?`)) {
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

      {findOpen && (
        <FindReplaceBar
          findInputRef={findInputRef}
          findQuery={findQuery}
          onFindQueryChange={(val) => { setFindQuery(val); setActiveMatchIdx(0); }}
          replaceQuery={replaceQuery}
          onReplaceQueryChange={setReplaceQuery}
          caseSensitive={findCaseSensitive}
          onToggleCaseSensitive={() => setFindCaseSensitive((v) => !v)}
          matchCount={findMatches.length}
          activeMatchIdx={activeMatchIdx}
          onPrevMatch={() => jumpToMatch(activeMatchIdx - 1)}
          onNextMatch={() => jumpToMatch(activeMatchIdx + 1)}
          onReplaceCurrent={handleReplaceCurrent}
          onReplaceAll={handleReplaceAll}
          onClose={() => setFindOpen(false)}
        />
      )}

      {zoomState.isZoomed && mode !== "raw" && (
        <div className="flex items-center justify-between gap-2 border-b border-indigo-500/30 bg-indigo-500/10 px-5 py-2 text-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-indigo-200">
            <ZoomIn className="mr-1 h-3.5 w-3.5 shrink-0 text-indigo-400" />
            <button onClick={() => setZoomBlockId(null)} className="rounded px-1.5 py-0.5 font-medium hover:bg-indigo-500/20">
              Dokument
            </button>
            {zoomState.breadcrumbs.map((crumb, idx) => {
              const isCurrent = idx === zoomState.breadcrumbs.length - 1;
              const label = stripExplicitBlockIds(crumb.plainText || crumb.rawContent).trim() || "(Block)";
              return (
                <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                  <span className="text-indigo-400/70">/</span>
                  {isCurrent ? (
                    <span className="max-w-xs truncate rounded bg-indigo-500/20 px-1.5 py-0.5 font-semibold text-indigo-100">{label}</span>
                  ) : (
                    <button onClick={() => setZoomBlockId(crumb.id)} className="max-w-44 truncate rounded px-1.5 py-0.5 hover:bg-indigo-500/20">{label}</button>
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
          <button onClick={() => setEditorError(null)} className="rounded p-0.5 hover:bg-rose-500/20">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Content + Optional Outline Panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-3xl">
            {!effectiveZenMode && !zoomState.isZoomed && (
              <div className="mb-6 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <Tag className="h-3 w-3 text-indigo-400" />
                  <span>Dokument-Properties & Tags</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {docBundle.document.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-300">
                      <Hash className="h-3 w-3" />{tag}
                    </span>
                  ))}
                  {Object.entries(frontmatter)
                    .filter(([k]) => k !== "tags" && k !== "id")
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px]">
                        <span className="text-zinc-500">{k}:</span>
                        <span className="font-mono text-zinc-200">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
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
                      onKeyDown={(e) => { if (e.key === "Enter") addFrontmatterProperty(); }}
                      placeholder="wert"
                      className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
                    />
                    <button onClick={addFrontmatterProperty} className="rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-indigo-600 hover:text-white">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mode === "raw" ? (
              <textarea
                value={rawMarkdown}
                onChange={(e) => { setRawMarkdown(e.target.value); setDirty(true); }}
                onPaste={(e) => void handlePasteInRaw(e)}
                spellCheck={false}
                className="h-[62vh] w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-indigo-500"
              />
            ) : mode === "preview" ? (
              <div className="space-y-4">
                {visibleIndices.map((idx) => {
                  const blk = blocks[idx];
                  const relativeDepth = Math.max(0, blk.depth - zoomState.rootDepth);
                  const isFindHit = matchingBlockIds.has(blk.id);
                  const isActiveHit = activeMatchBlockId === blk.id;
                  return (
                    <div
                      key={blk.id}
                      ref={(el) => { blockWrapperRefs.current[blk.id] = el; }}
                      className={
                        isActiveHit ? "rounded-xl bg-amber-500/5 px-2 py-1 ring-1 ring-amber-400/70"
                          : isFindHit ? "rounded-xl bg-amber-500/5 px-2 py-1" : undefined
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
                  const hasChildren = blocks[idx + 1] && blocks[idx + 1].depth > blk.depth;
                  const inlineRefs = extractBlockRefs(blk.rawContent);
                  const inlineImages = extractImageEmbeds(blk.rawContent);
                  const relativeDepth = Math.max(0, blk.depth - zoomState.rootDepth);
                  const isDragging = dragBlockId === blk.id;
                  const isDragOver = dragOverBlockId === blk.id && dragBlockId !== null && dragBlockId !== blk.id;
                  const isFindHit = matchingBlockIds.has(blk.id);
                  const isActiveHit = activeMatchBlockId === blk.id;
                  const isMenuOpenForBlock = menu?.blockId === blk.id;

                  return (
                    <div
                      key={blk.id}
                      ref={(el) => { blockWrapperRefs.current[blk.id] = el; }}
                      style={{ marginLeft: `${relativeDepth * 24}px` }}
                      onDragOver={(e) => {
                        if (!dragBlockId || dragBlockId === blk.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverBlockId !== blk.id) setDragOverBlockId(blk.id);
                      }}
                      onDragLeave={() => { if (dragOverBlockId === blk.id) setDragOverBlockId(null); }}
                      onDrop={(e) => {
                        if (!dragBlockId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const src = e.dataTransfer.getData("text/plain") || dragBlockId;
                        if (src) reorderBlockByIds(src, blk.id);
                        setDragBlockId(null);
                        setDragOverBlockId(null);
                      }}
                      className={`group relative rounded-xl border px-2 py-1 transition ${
                        isDragOver
                          ? "border-x-zinc-800 border-b-zinc-800 border-t-2 border-t-indigo-500 bg-indigo-500/10"
                          : isActiveHit ? "border-amber-400/70 bg-amber-500/10"
                            : isFindHit ? "border-amber-500/30 bg-amber-500/5"
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
                            onDragEnd={() => { setDragBlockId(null); setDragOverBlockId(null); }}
                            title="Block per Drag & Drop verschieben"
                            className="cursor-grab rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 active:cursor-grabbing"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>

                          {hasChildren && (
                            <button
                              onClick={() => updateBlock(blk.id, { collapsed: !blk.collapsed })}
                              title={blk.collapsed ? "Ausklappen" : "Einklappen"}
                              className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
                            >
                              {blk.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}

                          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                            {blk.blockType}{blk.headingLevel ? ` H${blk.headingLevel}` : ""}
                          </span>
                          <button onClick={() => setZoomBlockId(blk.id)} title="In diesen Block hineinzoomen (Hoisting)" className="rounded p-0.5 hover:bg-indigo-500/20 hover:text-indigo-300">
                            <ZoomIn className="h-3 w-3" />
                          </button>
                          <button onClick={() => moveBlock(idx, -1)} title="Block nach oben" className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200">
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button onClick={() => moveBlock(idx, 1)} title="Block nach unten" className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200">
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          <button onClick={() => updateBlock(blk.id, { depth: Math.max(0, blk.depth - 1) })} title="Ausrücken (Shift+Tab)" className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200">
                            <Outdent className="h-3 w-3" />
                          </button>
                          <button onClick={() => updateBlock(blk.id, { depth: blk.depth + 1 })} title="Einrücken (Tab)" className="rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200">
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
                              <><Check className="h-2.5 w-2.5 text-emerald-400" /><span className="text-emerald-300">Kopiert</span></>
                            ) : (
                              <><Copy className="h-2.5 w-2.5" /><span>{blk.hasExplicitId ? `^${blk.id}` : `((${blk.id}))`}</span></>
                            )}
                          </button>
                          <button onClick={() => insertBlockAfter(idx, blk.depth)} title="Block darunter einfügen" className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => removeBlock(idx)} title="Block entfernen" className="rounded p-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300">
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
                            ref={(el) => { blockRefs.current[blk.id] = el; autoResizeTextarea(el); }}
                            value={blk.rawContent}
                            rows={1}
                            onFocus={() => setActiveBlockId(blk.id)}
                            onPaste={(e) => void handlePasteInBlock(blk.id, e)}
                            onChange={(e) =>
                              handleContentChange(blk, e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)
                            }
                            onKeyDown={(e) => handleBlockKeyDown(blk, idx, e)}
                            placeholder="Tippe `/` für Blocktypen, `[[` für Wiki-Links, `((` für Block-Refs oder füge Bilder per Strg+V ein..."
                            className={getBlockTextareaClassName(blk)}
                          />
                        )}
                      </div>

                      {isMenuOpenForBlock && menu && (
                        <AutocompleteMenu
                          menu={menu}
                          menuIndex={menuIndex}
                          onSelectIndex={setMenuIndex}
                          slashOptions={filteredSlashOptions}
                          wikiDocs={filteredWikiDocs}
                          blockRefs={filteredBlockRefs}
                          onApplySlash={(opt) => applySlashOption(blk, opt)}
                          onApplyWiki={(doc) => applyWikiSuggestion(blk, doc)}
                          onApplyBlockRef={(cand) => applyBlockRefSuggestion(blk, cand)}
                        />
                      )}

                      {inlineImages.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {inlineImages.map((img, imgIdx) => (
                            <AssetImagePreview key={`${img.path}-${imgIdx}`} path={img.path} alt={img.alt} compact />
                          ))}
                        </div>
                      )}

                      {inlineRefs.map((refId) => {
                        const target = transclusions[refId];
                        return target ? (
                          <TransclusionCard key={refId} refId={refId} target={target} onNavigate={onNavigate} compact />
                        ) : null;
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
                  const fresh = await vaultApi.getDocument(docBundle.document.path).catch(() => null);
                  if (fresh) await onSaved(fresh);
                }}
              />
            )}
          </div>
        </div>

        {showOutline && !effectiveZenMode && (
          <OutlinePanel
            blocks={blocks}
            activeBlockId={activeBlockId}
            onJumpToBlock={handleJumpToBlock}
            onClose={() => setShowOutline(false)}
          />
        )}
      </div>

      <HistoryModal
        isOpen={historyOpen}
        docPath={docBundle.document.path}
        currentMarkdown={
          mode === "raw" ? rawMarkdown
            : dirty ? serializeBlocksToCleanMarkdown(blocks, frontmatter)
              : docBundle.rawMarkdown
        }
        onClose={() => setHistoryOpen(false)}
        onRestored={async (restoredDoc) => { await onSaved(restoredDoc); }}
      />
    </div>
  );
}
