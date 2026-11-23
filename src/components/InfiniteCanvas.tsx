import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FilePlus,
  FilePlus2,
  FileText,
  GitCommitHorizontal,
  GripVertical,
  Layers,
  Magnet,
  Maximize2,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type {
  BlockLookup,
  CanvasData,
  CanvasNode,
  DocumentSummary,
} from "../types/vault";

interface InfiniteCanvasProps {
  canvasPath: string;
  documents: DocumentSummary[];
  onOpenDocument: (docPath: string) => void;
  onCanvasListChanged?: () => Promise<void>;
  onSelectCanvas?: (path: string) => void;
}

const COLOR_KEYS = ["zinc", "indigo", "emerald", "amber", "cyan"] as const;
type CardColorKey = (typeof COLOR_KEYS)[number];

const NODE_COLORS: Record<string, string> = {
  indigo: "border-indigo-500/50 bg-indigo-950/40",
  emerald: "border-emerald-500/50 bg-emerald-950/40",
  amber: "border-amber-500/50 bg-amber-950/40",
  cyan: "border-cyan-500/50 bg-cyan-950/40",
  zinc: "border-zinc-700 bg-zinc-900/90",
};

const COLOR_DOT_STYLES: Record<CardColorKey, string> = {
  zinc: "bg-zinc-400",
  indigo: "bg-indigo-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  cyan: "bg-cyan-400",
};

const SVG_THEME: Record<
  string,
  { fill: string; stroke: string; accent: string }
> = {
  indigo: { fill: "#1e1b4b", stroke: "#6366f1", accent: "#818cf8" },
  emerald: { fill: "#064e3b", stroke: "#10b981", accent: "#34d399" },
  amber: { fill: "#451a03", stroke: "#f59e0b", accent: "#fbbf24" },
  cyan: { fill: "#083344", stroke: "#06b6d4", accent: "#22d3ee" },
  zinc: { fill: "#18181b", stroke: "#3f3f46", accent: "#a1a1aa" },
};

const GRID_STEP = 20;
const MAX_HISTORY = 50;

function cloneCanvas(data: CanvasData): CanvasData {
  return {
    path: data.path,
    nodes: data.nodes.map((n) => ({ ...n })),
    edges: data.edges.map((e) => ({ ...e })),
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapTextLines(text: string, maxChars: number, maxLines: number): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
      }
      if (lines.length >= maxLines) break;
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

export function InfiniteCanvas({
  canvasPath,
  documents,
  onOpenDocument,
  onCanvasListChanged,
  onSelectCanvas,
}: InfiniteCanvasProps) {
  const [canvas, setCanvas] = useState<CanvasData | null>(null);
  const [historyPast, setHistoryPast] = useState<CanvasData[]>([]);
  const [historyFuture, setHistoryFuture] = useState<CanvasData[]>([]);
  const [blockCache, setBlockCache] = useState<Record<string, BlockLookup>>({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [selectedDocToAdd, setSelectedDocToAdd] = useState("");
  const [convertingNodeId, setConvertingNodeId] = useState<string | null>(null);
  const [creatingCanvas, setCreatingCanvas] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState("");
  const [boardSize, setBoardSize] = useState({ width: 960, height: 640 });

  const boardRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const beforeEditCanvasRef = useRef<CanvasData | null>(null);
  const canvasRef = useRef<CanvasData | null>(null);

  const dragState = useRef<{
    type: "none" | "pan" | "node";
    nodeId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    beforeCanvas?: CanvasData;
    moved?: boolean;
  }>({ type: "none", startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    canvasRef.current = canvas;
  }, [canvas]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoardSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvas !== null]);

  const showNotice = useCallback((msg: string) => {
    setSavedNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setSavedNotice(null);
      noticeTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    let active = true;
    setSelectedEdgeId(null);
    setConnectSource(null);
    setHistoryPast([]);
    setHistoryFuture([]);
    vaultApi.getCanvas(canvasPath).then(async (data) => {
      if (!active) return;
      setCanvas(data);
      const cache: Record<string, BlockLookup> = {};
      for (const node of data.nodes) {
        if (node.refBlockId) {
          const blk = await vaultApi.getBlockById(node.refBlockId);
          if (blk) cache[node.refBlockId] = blk;
        }
      }
      if (active) setBlockCache(cache);
    });
    return () => {
      active = false;
    };
  }, [canvasPath]);

  useEffect(() => {
    if (documents.length > 0 && !selectedDocToAdd) {
      setSelectedDocToAdd(documents[0].path);
    }
  }, [documents, selectedDocToAdd]);

  const handleSave = useCallback(
    async (nextCanvas?: CanvasData) => {
      const target = nextCanvas ?? canvasRef.current;
      if (!target) return;
      await vaultApi.saveCanvas(target);
      showNotice("Gespeichert in " + target.path);
    },
    [showNotice],
  );

  const pushHistorySnapshot = useCallback((snapshot: CanvasData) => {
    setHistoryPast((prev) => [...prev.slice(-(MAX_HISTORY - 1)), cloneCanvas(snapshot)]);
    setHistoryFuture([]);
  }, []);

  const commitCanvasChange = useCallback(
    (next: CanvasData, autoSave = true) => {
      const prev = canvasRef.current;
      if (prev) {
        pushHistorySnapshot(prev);
      }
      setCanvas(next);
      if (autoSave) {
        void handleSave(next);
      }
    },
    [handleSave, pushHistorySnapshot],
  );

  const handleUndo = useCallback(() => {
    const current = canvasRef.current;
    if (!current || historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast((prev) => prev.slice(0, -1));
    setHistoryFuture((prev) => [...prev.slice(-(MAX_HISTORY - 1)), cloneCanvas(current)]);
    setCanvas(previous);
    setSelectedEdgeId((edgeId) =>
      edgeId && previous.edges.some((e) => e.id === edgeId) ? edgeId : null,
    );
    void handleSave(previous);
  }, [historyPast, handleSave]);

  const handleRedo = useCallback(() => {
    const current = canvasRef.current;
    if (!current || historyFuture.length === 0) return;
    const next = historyFuture[historyFuture.length - 1];
    setHistoryFuture((prev) => prev.slice(0, -1));
    setHistoryPast((prev) => [...prev.slice(-(MAX_HISTORY - 1)), cloneCanvas(current)]);
    setCanvas(next);
    setSelectedEdgeId((edgeId) =>
      edgeId && next.edges.some((e) => e.id === edgeId) ? edgeId : null,
    );
    void handleSave(next);
  }, [historyFuture, handleSave]);

  const deleteEdge = useCallback(
    (edgeId: string) => {
      const current = canvasRef.current;
      if (!current) return;
      const next: CanvasData = {
        ...current,
        edges: current.edges.filter((e) => e.id !== edgeId),
      };
      setSelectedEdgeId(null);
      commitCanvasChange(next, true);
    },
    [commitCanvasChange],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (isEditingField) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedEdgeId
      ) {
        e.preventDefault();
        deleteEdge(selectedEdgeId);
      } else if (e.key === "Escape") {
        setSelectedEdgeId(null);
        setConnectSource(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo, selectedEdgeId, deleteEdge]);

  const snapCoord = (value: number) =>
    snapToGrid ? Math.round(value / GRID_STEP) * GRID_STEP : Math.round(value);

  const addTextNode = () => {
    if (!canvas) return;
    const newNode: CanvasNode = {
      id: `node-${Date.now()}`,
      nodeType: "text",
      x: snapCoord((160 - pan.x) / zoom),
      y: snapCoord((120 - pan.y) / zoom),
      width: 260,
      height: 150,
      title: "Neue Ideen-Karte",
      text: "Doppelklick oder direkt bearbeiten...",
      refDocPath: null,
      refBlockId: null,
      color: "zinc",
    };
    const next = { ...canvas, nodes: [...canvas.nodes, newNode] };
    commitCanvasChange(next, true);
  };

  const addDocEmbedNode = () => {
    if (!canvas || !selectedDocToAdd) return;
    const doc = documents.find((d) => d.path === selectedDocToAdd);
    const newNode: CanvasNode = {
      id: `node-${Date.now()}`,
      nodeType: "doc_embed",
      x: snapCoord((220 - pan.x) / zoom),
      y: snapCoord((160 - pan.y) / zoom),
      width: 280,
      height: 155,
      title: doc?.title ?? selectedDocToAdd,
      text: `Eingebettete Notiz (${doc?.blockCount ?? 0} Blöcke)`,
      refDocPath: selectedDocToAdd,
      refBlockId: null,
      color: "indigo",
    };
    const next = { ...canvas, nodes: [...canvas.nodes, newNode] };
    commitCanvasChange(next, true);
  };

  const deleteNode = (id: string) => {
    if (!canvas) return;
    const next: CanvasData = {
      ...canvas,
      nodes: canvas.nodes.filter((n) => n.id !== id),
      edges: canvas.edges.filter((e) => e.fromNode !== id && e.toNode !== id),
    };
    if (
      selectedEdgeId &&
      !next.edges.some((e) => e.id === selectedEdgeId)
    ) {
      setSelectedEdgeId(null);
    }
    commitCanvasChange(next, true);
  };

  const updateNodeColor = (id: string, color: CardColorKey) => {
    if (!canvas) return;
    const existing = canvas.nodes.find((n) => n.id === id);
    if (!existing || existing.color === color) return;
    const next: CanvasData = {
      ...canvas,
      nodes: canvas.nodes.map((n) => (n.id === id ? { ...n, color } : n)),
    };
    commitCanvasChange(next, true);
  };

  const beginInlineEdit = () => {
    if (canvas && !beforeEditCanvasRef.current) {
      beforeEditCanvasRef.current = cloneCanvas(canvas);
    }
  };

  const finishInlineEdit = () => {
    const before = beforeEditCanvasRef.current;
    beforeEditCanvasRef.current = null;
    const current = canvasRef.current;
    if (!before || !current) return;
    if (JSON.stringify(before) !== JSON.stringify(current)) {
      pushHistorySnapshot(before);
      void handleSave(current);
    }
  };

  const handleConnectClick = (nodeId: string) => {
    if (!canvas) return;
    if (!connectSource) {
      setConnectSource(nodeId);
      return;
    }
    if (connectSource !== nodeId) {
      const next: CanvasData = {
        ...canvas,
        edges: [
          ...canvas.edges,
          {
            id: `edge-${Date.now()}`,
            fromNode: connectSource,
            toNode: nodeId,
            fromSide: "right",
            toSide: "left",
            label: "verknüpft",
            color: "indigo",
          },
        ],
      };
      commitCanvasChange(next, true);
    }
    setConnectSource(null);
  };

  const handleConvertTextToNote = async (node: CanvasNode) => {
    if (!canvas || node.nodeType !== "text" || convertingNodeId) return;
    const title = (node.title ?? "").trim() || "Canvas Notiz";
    const text = node.text ?? "";
    setConvertingNodeId(node.id);
    try {
      const created = await vaultApi.createDocument(title, title);
      const docPath = created.document.path;
      await vaultApi.saveMarkdownDocument(docPath, `# ${title}\n\n${text}`);
      const current = canvasRef.current ?? canvas;
      const next: CanvasData = {
        ...current,
        nodes: current.nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                nodeType: "doc_embed",
                title: created.document.title || title,
                refDocPath: docPath,
                text: text.trim()
                  ? text.trim().slice(0, 120)
                  : "Eingebettete Notiz",
                color: n.color && n.color !== "zinc" ? n.color : "indigo",
              }
            : n,
        ),
      };
      commitCanvasChange(next, false);
      await vaultApi.saveCanvas(next);
      await onCanvasListChanged?.();
      showNotice(`Notiz erstellt: ${docPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(`Fehler beim Konvertieren: ${msg}`);
    } finally {
      setConvertingNodeId(null);
    }
  };

  const handleCreateCanvas = async () => {
    const trimmed = newCanvasName.trim();
    if (!trimmed) return;
    const relPath = trimmed.endsWith(".canvas")
      ? trimmed
      : `${trimmed}.canvas`;
    try {
      const created = await vaultApi.createCanvas(relPath);
      setCreatingCanvas(false);
      setNewCanvasName("");
      await onCanvasListChanged?.();
      onSelectCanvas?.(created.path);
      showNotice(`Neues Canvas erstellt: ${created.path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(`Canvas-Erstellung fehlgeschlagen: ${msg}`);
    }
  };

  const handleDeleteCanvas = async () => {
    if (!canvas) return;
    const confirmed = window.confirm(
      `Canvas "${canvas.path}" wirklich dauerhaft löschen?`,
    );
    if (!confirmed) return;
    try {
      const deletedPath = canvas.path;
      await vaultApi.deleteCanvas(deletedPath);
      await onCanvasListChanged?.();
      showNotice(`Canvas gelöscht: ${deletedPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(`Löschen fehlgeschlagen: ${msg}`);
    }
  };

  const handleFitToView = useCallback(() => {
    if (!canvas || canvas.nodes.length === 0) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    const vw = boardSize.width;
    const vh = boardSize.height;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of canvas.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    const bboxW = Math.max(100, maxX - minX);
    const bboxH = Math.max(100, maxY - minY);
    const pad = 64;
    const nextZoom = Math.min(
      1.6,
      Math.max(0.35, Math.min((vw - pad * 2) / bboxW, (vh - pad * 2) / bboxH)),
    );
    const nextPanX = (vw - bboxW * nextZoom) / 2 - minX * nextZoom;
    const nextPanY = (vh - bboxH * nextZoom) / 2 - minY * nextZoom;
    setZoom(nextZoom);
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) });
  }, [canvas, boardSize]);

  const handleExportSvg = () => {
    if (!canvas) return;
    const pad = 48;
    let minX = 0;
    let minY = 0;
    let maxX = 800;
    let maxY = 500;

    if (canvas.nodes.length > 0) {
      minX = Math.min(...canvas.nodes.map((n) => n.x));
      minY = Math.min(...canvas.nodes.map((n) => n.y));
      maxX = Math.max(...canvas.nodes.map((n) => n.x + n.width));
      maxY = Math.max(...canvas.nodes.map((n) => n.y + n.height));
    }

    const vbX = Math.floor(minX - pad);
    const vbY = Math.floor(minY - pad);
    const vbW = Math.ceil(Math.max(200, maxX - minX + pad * 2));
    const vbH = Math.ceil(Math.max(200, maxY - minY + pad * 2));

    const edgeMarkup = canvas.edges
      .map((edge) => {
        const from = canvas.nodes.find((n) => n.id === edge.fromNode);
        const to = canvas.nodes.find((n) => n.id === edge.toNode);
        if (!from || !to) return "";
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const mx = (x1 + x2) / 2;
        const label = edge.label
          ? `<text x="${mx}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" fill="#a1a1aa" font-family="Inter, sans-serif" font-size="11">${escapeXml(edge.label)}</text>`
          : "";
        return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" stroke="#6366f1" stroke-width="2" fill="none" marker-end="url(#canvas-arrow)" />${label}`;
      })
      .join("\n    ");

    const nodeMarkup = canvas.nodes
      .map((node) => {
        const theme = SVG_THEME[node.color ?? "zinc"] ?? SVG_THEME.zinc;
        const liveBlock = node.refBlockId
          ? blockCache[node.refBlockId]
          : undefined;
        const title = escapeXml(node.title ?? "Karte");
        const bodyRaw = liveBlock
          ? liveBlock.block.plainText
          : node.text ?? "";
        const maxChars = Math.max(18, Math.floor((node.width - 28) / 6.8));
        const maxLines = Math.max(2, Math.floor((node.height - 56) / 16));
        const lines = wrapTextLines(bodyRaw, maxChars, maxLines);
        const bodyTspans = lines
          .map(
            (line, i) =>
              `<tspan x="${node.x + 14}" dy="${i === 0 ? 0 : 16}">${escapeXml(line)}</tspan>`,
          )
          .join("");

        return `<g>
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="14" fill="${theme.fill}" stroke="${theme.stroke}" stroke-width="1.5" />
      <line x1="${node.x + 12}" y1="${node.y + 34}" x2="${node.x + node.width - 12}" y2="${node.y + 34}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
      <text x="${node.x + 14}" y="${node.y + 22}" fill="#f4f4f5" font-family="Inter, sans-serif" font-size="12" font-weight="600">${title}</text>
      <text x="${node.x + 14}" y="${node.y + 54}" fill="#d4d4d8" font-family="Inter, sans-serif" font-size="11">${bodyTspans}</text>
    </g>`;
      })
      .join("\n    ");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}" height="${vbH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
  <defs>
    <marker id="canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" />
    </marker>
  </defs>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#09090b" />
  <g>
    ${edgeMarkup}
  </g>
  <g>
    ${nodeMarkup}
  </g>
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const baseName = canvas.path
      .split("/")
      .pop()
      ?.replace(/\.canvas$/i, "") || "oxidevault-canvas";
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice(`SVG exportiert: ${baseName}.svg`);
  };

  const selectedEdge = useMemo(
    () => canvas?.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [canvas, selectedEdgeId],
  );

  // Minimap geometry calculation
  const minimap = useMemo(() => {
    const mapW = 184;
    const mapH = 114;
    const vpX = -pan.x / zoom;
    const vpY = -pan.y / zoom;
    const vpW = boardSize.width / zoom;
    const vpH = boardSize.height / zoom;

    let minX = vpX;
    let minY = vpY;
    let maxX = vpX + vpW;
    let maxY = vpY + vpH;

    if (canvas) {
      for (const n of canvas.nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      }
    }

    const pad = 80;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const scale = Math.min(mapW / worldW, mapH / worldH);
    const offsetX = (mapW - worldW * scale) / 2;
    const offsetY = (mapH - worldH * scale) / 2;

    const toMiniX = (wx: number) => offsetX + (wx - minX) * scale;
    const toMiniY = (wy: number) => offsetY + (wy - minY) * scale;

    return {
      mapW,
      mapH,
      minX,
      minY,
      scale,
      offsetX,
      offsetY,
      toMiniX,
      toMiniY,
      vpRect: {
        x: toMiniX(vpX),
        y: toMiniY(vpY),
        w: vpW * scale,
        h: vpH * scale,
      },
    };
  }, [canvas, pan, zoom, boardSize]);

  if (!canvas) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        Lade Infinite Whiteboard...
      </div>
    );
  }

  const gridSpacing = (snapToGrid ? GRID_STEP : 24) * zoom;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* Toolbar */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-zinc-100">
            Infinite Whiteboard
          </span>
          <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
            {canvas.path}
          </span>

          {creatingCanvas ? (
            <div className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-zinc-900 px-2 py-0.5">
              <input
                type="text"
                value={newCanvasName}
                onChange={(e) => setNewCanvasName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateCanvas();
                  if (e.key === "Escape") {
                    setCreatingCanvas(false);
                    setNewCanvasName("");
                  }
                }}
                placeholder="board-name.canvas"
                autoFocus
                className="w-36 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none"
              />
              <button
                onClick={() => void handleCreateCanvas()}
                className="rounded p-0.5 text-emerald-400 hover:bg-emerald-500/20"
                title="Canvas erstellen"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  setCreatingCanvas(false);
                  setNewCanvasName("");
                }}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800"
                title="Abbrechen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingCanvas(true)}
              className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              title="Neues Canvas erstellen"
            >
              <FilePlus className="h-3.5 w-3.5 text-cyan-400" />
              Neu
            </button>
          )}

          <button
            onClick={() => void handleDeleteCanvas()}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300"
            title="Aktives Canvas löschen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {savedNotice && (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] text-emerald-300">
              {savedNotice}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900">
            <button
              onClick={handleUndo}
              disabled={historyPast.length === 0}
              title="Rückgängig (Strg+Z)"
              className="rounded-l-lg px-2 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <div className="h-4 w-px bg-zinc-800" />
            <button
              onClick={handleRedo}
              disabled={historyFuture.length === 0}
              title="Wiederholen (Strg+Umschalt+Z)"
              className="rounded-r-lg px-2 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Snap-to-Grid */}
          <button
            onClick={() => setSnapToGrid((v) => !v)}
            title="Am 20px-Raster ausrichten"
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              snapToGrid
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Magnet className="h-3.5 w-3.5" />
            Raster
          </button>

          {/* Add Text Card */}
          <button
            onClick={addTextNode}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5 text-cyan-400" />
            Text-Karte
          </button>

          {/* Embed Note */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1">
            <select
              value={selectedDocToAdd}
              onChange={(e) => setSelectedDocToAdd(e.target.value)}
              className="max-w-40 bg-transparent text-xs text-zinc-200 outline-none"
            >
              {documents.map((d) => (
                <option key={d.path} value={d.path} className="bg-zinc-900">
                  {d.title}
                </option>
              ))}
            </select>
            <button
              onClick={addDocEmbedNode}
              className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
            >
              + Notiz einbetten
            </button>
          </div>

          {/* Fit to View */}
          <button
            onClick={handleFitToView}
            title="Alle Karten einpassen"
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Einpassen
          </button>

          {/* SVG Export */}
          <button
            onClick={handleExportSvg}
            title="Als Vektor-SVG exportieren"
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            SVG
          </button>

          {/* Save */}
          <button
            onClick={() => void handleSave()}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Save className="h-3.5 w-3.5" />
            Speichern
          </button>
        </div>
      </div>

      {/* Board Surface */}
      <div
        ref={boardRef}
        className="relative flex-1 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(113,113,122,0.28) 1px, transparent 1px)",
          backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedEdgeId(null);
            dragState.current = {
              type: "pan",
              startX: e.clientX,
              startY: e.clientY,
              origX: pan.x,
              origY: pan.y,
            };
          }
        }}
        onMouseMove={(e) => {
          if (dragState.current.type === "pan") {
            setPan({
              x:
                dragState.current.origX +
                (e.clientX - dragState.current.startX),
              y:
                dragState.current.origY +
                (e.clientY - dragState.current.startY),
            });
          } else if (
            dragState.current.type === "node" &&
            dragState.current.nodeId &&
            canvas
          ) {
            const dx = (e.clientX - dragState.current.startX) / zoom;
            const dy = (e.clientY - dragState.current.startY) / zoom;
            const nid = dragState.current.nodeId;
            const nextX = snapCoord(dragState.current.origX + dx);
            const nextY = snapCoord(dragState.current.origY + dy);
            if (
              nextX !== dragState.current.origX ||
              nextY !== dragState.current.origY
            ) {
              dragState.current.moved = true;
            }
            setCanvas({
              ...canvas,
              nodes: canvas.nodes.map((n) =>
                n.id === nid ? { ...n, x: nextX, y: nextY } : n,
              ),
            });
          }
        }}
        onMouseUp={() => {
          if (
            dragState.current.type === "node" &&
            dragState.current.moved &&
            dragState.current.beforeCanvas &&
            canvasRef.current
          ) {
            pushHistorySnapshot(dragState.current.beforeCanvas);
            void handleSave(canvasRef.current);
          }
          dragState.current.type = "none";
          dragState.current.beforeCanvas = undefined;
          dragState.current.moved = false;
        }}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.08 : 0.92;
          setZoom((z) => Math.min(2.2, Math.max(0.35, z * factor)));
        }}
      >
        {/* Floating Edge Editor Toolbar */}
        {selectedEdge && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-indigo-500/40 bg-zinc-900/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-xs"
          >
            <span className="font-medium text-indigo-300">Kante:</span>
            <input
              type="text"
              value={selectedEdge.label ?? ""}
              onFocus={beginInlineEdit}
              onChange={(e) => {
                const val = e.target.value;
                setCanvas((prev) =>
                  prev
                    ? {
                        ...prev,
                        edges: prev.edges.map((ed) =>
                          ed.id === selectedEdge.id
                            ? { ...ed, label: val || null }
                            : ed,
                        ),
                      }
                    : prev,
                );
              }}
              onBlur={finishInlineEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  finishInlineEdit();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  setSelectedEdgeId(null);
                }
              }}
              placeholder="Beschriftung..."
              className="w-40 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-400"
            />
            <button
              onClick={() => deleteEdge(selectedEdge.id)}
              className="flex items-center gap-1 rounded-lg bg-rose-600/80 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
              title="Kante löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Löschen
            </button>
            <button
              onClick={() => setSelectedEdgeId(null)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="Schließen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
          className="pointer-events-none absolute inset-0"
        >
          {/* SVG Edges */}
          <svg className="h-[4000px] w-[4000px] overflow-visible">
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" />
              </marker>
              <marker
                id="arrow-selected"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
              </marker>
            </defs>
            {canvas.edges.map((edge) => {
              const from = canvas.nodes.find((n) => n.id === edge.fromNode);
              const to = canvas.nodes.find((n) => n.id === edge.toNode);
              if (!from || !to) return null;
              const x1 = from.x + from.width;
              const y1 = from.y + from.height / 2;
              const x2 = to.x;
              const y2 = to.y + to.height / 2;
              const mx = (x1 + x2) / 2;
              const isSelected = selectedEdgeId === edge.id;
              const pathD = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
              return (
                <g key={edge.id}>
                  {/* Wide transparent hit area for reliable edge selection */}
                  <path
                    d={pathD}
                    stroke="transparent"
                    strokeWidth="14"
                    fill="none"
                    className="pointer-events-auto cursor-pointer"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId(edge.id);
                    }}
                  />
                  <path
                    d={pathD}
                    stroke={isSelected ? "#38bdf8" : "#6366f1"}
                    strokeWidth={isSelected ? "3" : "2"}
                    fill="none"
                    markerEnd={
                      isSelected ? "url(#arrow-selected)" : "url(#arrow)"
                    }
                    className="pointer-events-none"
                  />
                  {edge.label && (
                    <text
                      x={mx}
                      y={(y1 + y2) / 2 - 8}
                      textAnchor="middle"
                      fill={isSelected ? "#7dd3fc" : "#a1a1aa"}
                      fontSize="11"
                      fontWeight={isSelected ? "600" : "400"}
                      className="pointer-events-auto cursor-pointer select-none"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEdgeId(edge.id);
                      }}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Cards */}
          {canvas.nodes.map((node) => {
            const colorCls =
              NODE_COLORS[node.color ?? "zinc"] ?? NODE_COLORS.zinc;
            const liveBlock = node.refBlockId
              ? blockCache[node.refBlockId]
              : undefined;
            const isConnectingFrom = connectSource === node.id;
            const activeColor = node.color ?? "zinc";

            return (
              <div
                key={node.id}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  minHeight: node.height,
                }}
                className={`pointer-events-auto absolute flex flex-col rounded-2xl border p-3.5 shadow-xl backdrop-blur-xs transition-shadow ${colorCls} ${
                  isConnectingFrom ? "ring-2 ring-indigo-400" : ""
                }`}
              >
                {/* Card Header (Drag Handle + Editable Title + Actions) */}
                <div
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    dragState.current = {
                      type: "node",
                      nodeId: node.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      origX: node.x,
                      origY: node.y,
                      beforeCanvas: cloneCanvas(canvas),
                      moved: false,
                    };
                  }}
                  className="mb-2 flex cursor-move items-center justify-between gap-1.5 border-b border-white/10 pb-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    {node.nodeType === "block_embed" ? (
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    )}
                    <input
                      type="text"
                      value={node.title ?? ""}
                      placeholder="Kartentitel..."
                      onMouseDown={(e) => e.stopPropagation()}
                      onFocus={beginInlineEdit}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCanvas({
                          ...canvas,
                          nodes: canvas.nodes.map((n) =>
                            n.id === node.id ? { ...n, title: val } : n,
                          ),
                        });
                      }}
                      onBlur={finishInlineEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-semibold text-zinc-100 placeholder-zinc-500 outline-none focus:bg-white/10"
                    />
                  </div>

                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {node.nodeType === "text" && (
                      <button
                        onClick={() => void handleConvertTextToNote(node)}
                        disabled={convertingNodeId === node.id}
                        title="Text-Karte in Markdown-Notiz umwandeln"
                        className="rounded p-1 text-zinc-400 transition hover:bg-emerald-500/20 hover:text-emerald-300 disabled:opacity-40"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleConnectClick(node.id)}
                      title={
                        connectSource
                          ? "Hierher verbinden"
                          : "Kante von hier ziehen"
                      }
                      className={`rounded p-1 transition ${
                        connectSource
                          ? "bg-indigo-500/30 text-indigo-200"
                          : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                      }`}
                    >
                      <GitCommitHorizontal className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteNode(node.id)}
                      title="Karte löschen"
                      className="rounded p-1 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Card Body */}
                {liveBlock ? (
                  <div className="flex-1 space-y-2 text-xs text-zinc-300">
                    <p className="leading-relaxed">{liveBlock.block.plainText}</p>
                    <button
                      onClick={() => onOpenDocument(liveBlock.docPath)}
                      className="text-[11px] font-medium text-indigo-300 hover:underline"
                    >
                      Quelle: {liveBlock.docTitle} (({liveBlock.block.id})) →
                    </button>
                  </div>
                ) : node.nodeType === "doc_embed" && node.refDocPath ? (
                  <div className="flex-1 space-y-2 text-xs text-zinc-300">
                    <p>{node.text}</p>
                    <button
                      onClick={() => onOpenDocument(node.refDocPath!)}
                      className="text-[11px] font-medium text-indigo-300 hover:underline"
                    >
                      Notiz öffnen →
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={node.text ?? ""}
                    onMouseDown={(e) => e.stopPropagation()}
                    onFocus={beginInlineEdit}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCanvas({
                        ...canvas,
                        nodes: canvas.nodes.map((n) =>
                          n.id === node.id ? { ...n, text: val } : n,
                        ),
                      });
                    }}
                    onBlur={finishInlineEdit}
                    className="w-full flex-1 resize-none bg-transparent text-xs leading-relaxed text-zinc-200 outline-none"
                  />
                )}

                {/* Card Footer: 5 Quick Color Dots + Optional Convert Hint */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  className="mt-2 flex items-center justify-between border-t border-white/5 pt-2"
                >
                  <div className="flex items-center gap-1.5">
                    {COLOR_KEYS.map((col) => (
                      <button
                        key={col}
                        onClick={() => updateNodeColor(node.id, col)}
                        title={`Farbe: ${col}`}
                        className={`h-3 w-3 rounded-full transition ${COLOR_DOT_STYLES[col]} ${
                          activeColor === col
                            ? "scale-110 ring-2 ring-white/80 ring-offset-1 ring-offset-zinc-900"
                            : "opacity-60 hover:opacity-100"
                        }`}
                      />
                    ))}
                  </div>
                  {node.nodeType === "text" && (
                    <button
                      onClick={() => void handleConvertTextToNote(node)}
                      disabled={convertingNodeId === node.id}
                      className="text-[10px] font-medium text-emerald-400/90 hover:text-emerald-300 hover:underline disabled:opacity-40"
                    >
                      {convertingNodeId === node.id ? "Erstelle..." : "→ Notiz"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom-Left Live Minimap */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 left-4 z-20 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/90 p-1.5 shadow-xl backdrop-blur-xs"
        >
          <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-zinc-500">
            <span>Minimap</span>
            <span className="font-mono">{canvas.nodes.length} Karten</span>
          </div>
          <svg
            width={minimap.mapW}
            height={minimap.mapH}
            className="cursor-pointer rounded-lg bg-zinc-950/90"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left;
              const my = e.clientY - rect.top;
              const targetWorldX =
                minimap.minX + (mx - minimap.offsetX) / minimap.scale;
              const targetWorldY =
                minimap.minY + (my - minimap.offsetY) / minimap.scale;
              setPan({
                x: Math.round(boardSize.width / 2 - targetWorldX * zoom),
                y: Math.round(boardSize.height / 2 - targetWorldY * zoom),
              });
            }}
          >
            {/* Minimap Edges */}
            {canvas.edges.map((edge) => {
              const from = canvas.nodes.find((n) => n.id === edge.fromNode);
              const to = canvas.nodes.find((n) => n.id === edge.toNode);
              if (!from || !to) return null;
              return (
                <line
                  key={edge.id}
                  x1={minimap.toMiniX(from.x + from.width / 2)}
                  y1={minimap.toMiniY(from.y + from.height / 2)}
                  x2={minimap.toMiniX(to.x + to.width / 2)}
                  y2={minimap.toMiniY(to.y + to.height / 2)}
                  stroke={selectedEdgeId === edge.id ? "#38bdf8" : "#6366f1"}
                  strokeOpacity={0.65}
                  strokeWidth={1}
                />
              );
            })}

            {/* Minimap Nodes */}
            {canvas.nodes.map((node) => {
              const theme = SVG_THEME[node.color ?? "zinc"] ?? SVG_THEME.zinc;
              return (
                <rect
                  key={node.id}
                  x={minimap.toMiniX(node.x)}
                  y={minimap.toMiniY(node.y)}
                  width={Math.max(4, node.width * minimap.scale)}
                  height={Math.max(3, node.height * minimap.scale)}
                  rx={1.5}
                  fill={theme.accent}
                  fillOpacity={0.75}
                />
              );
            })}

            {/* Current Viewport Rectangle */}
            <rect
              x={minimap.vpRect.x}
              y={minimap.vpRect.y}
              width={Math.max(8, minimap.vpRect.w)}
              height={Math.max(8, minimap.vpRect.h)}
              fill="rgba(56, 189, 248, 0.1)"
              stroke="#38bdf8"
              strokeWidth={1.25}
              rx={2}
            />
          </svg>
        </div>

        {/* Bottom-Right Status Pill */}
        <div className="absolute right-4 bottom-3 z-20 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-[11px] text-zinc-400">
          Zoom: {Math.round(zoom * 100)}% •{" "}
          {snapToGrid ? "Raster: 20px • " : ""}
          {connectSource
            ? "Zielkarte zum Verbinden anklicken!"
            : selectedEdge
              ? "Kante ausgewählt (Entf zum Löschen)"
              : "Hintergrund ziehen zum Pannen • Karten frei verschiebbar"}
        </div>
      </div>
    </div>
  );
}
