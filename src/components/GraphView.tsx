import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleOff,
  Compass,
  Download,
  Ghost,
  Hash,
  Maximize2,
  Network,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { vaultApi } from "../api/bridge";
import type { GraphNode, GraphPathResult, GraphSnapshot } from "../types/vault";

interface GraphViewProps {
  onOpenDocument: (docPath: string) => void;
  activeDocId?: string | null;
}

type LocalGraphMode = "global" | "1hop" | "2hop";

const CLUSTER_COLORS = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fbbf24", // amber
  "#38bdf8", // sky
  "#f472b6", // pink
  "#a78bfa", // violet
];

export function GraphView({ onOpenDocument, activeDocId }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [includeTags, setIncludeTags] = useState(true);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const [localMode, setLocalMode] = useState<LocalGraphMode>("global");
  const [searchQuery, setSearchQuery] = useState("");
  const [spacing, setSpacing] = useState(1.0);
  const [hubsOpen, setHubsOpen] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [pathResult, setPathResult] = useState<GraphPathResult | null>(null);

  // Camera transform + dragged node overrides + layout scaling refs
  const camRef = useRef({ x: 0, y: 0, zoom: 1.0 });
  const spacingRef = useRef(1.0);
  const centroidRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    mode: "none" | "pan" | "node";
    nodeId?: string;
    lastX: number;
    lastY: number;
  }>({ mode: "none", lastX: 0, lastY: 0 });
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    spacingRef.current = spacing;
  }, [spacing]);

  const getScaledPos = useCallback((nodeId: string) => {
    const p = positionsRef.current.get(nodeId);
    if (!p) return null;
    const c = centroidRef.current;
    const s = spacingRef.current;
    return {
      x: c.x + (p.x - c.x) * s,
      y: c.y + (p.y - c.y) * s,
    };
  }, []);

  const loadGraph = useCallback(async (tags: boolean) => {
    const snap = await vaultApi.getGraphSnapshot(tags);
    setSnapshot(snap);
    const map = new Map<string, { x: number; y: number }>();
    let sumX = 0;
    let sumY = 0;
    for (const n of snap.nodes) {
      map.set(n.id, { x: n.x, y: n.y });
      sumX += n.x;
      sumY += n.y;
    }
    positionsRef.current = map;
    centroidRef.current =
      snap.nodes.length > 0
        ? { x: sumX / snap.nodes.length, y: sumY / snap.nodes.length }
        : { x: 0, y: 0 };

    const docs = snap.nodes.filter((n) => n.nodeKind === "document");
    if (docs.length >= 2) {
      setFromId((prev) => prev || docs[0].id);
      setToId((prev) => prev || docs[docs.length - 1].id);
    }
  }, []);

  useEffect(() => {
    void loadGraph(includeTags);
  }, [includeTags, loadGraph]);

  const localAnchorId = selectedNode?.id ?? activeDocId ?? null;

  const { visibleNodes, visibleEdges, localAnchorMissing } = useMemo(() => {
    if (!snapshot) {
      return {
        visibleNodes: [] as GraphNode[],
        visibleEdges: [] as GraphSnapshot["edges"],
        localAnchorMissing: false,
      };
    }

    let nodes = snapshot.nodes;
    if (!showUnresolved) {
      nodes = nodes.filter((n) => n.nodeKind !== "unresolved");
    }
    if (onlyOrphans) {
      nodes = nodes.filter((n) => n.nodeKind === "document" && n.degree === 0);
    }

    let anchorMissing = false;
    if (localMode !== "global") {
      const allowedIds = new Set(nodes.map((n) => n.id));
      if (localAnchorId && allowedIds.has(localAnchorId)) {
        const maxHops = localMode === "1hop" ? 1 : 2;
        const adj = new Map<string, string[]>();
        for (const e of snapshot.edges) {
          if (!allowedIds.has(e.source) || !allowedIds.has(e.target)) continue;
          const sList = adj.get(e.source);
          if (sList) sList.push(e.target);
          else adj.set(e.source, [e.target]);
          const tList = adj.get(e.target);
          if (tList) tList.push(e.source);
          else adj.set(e.target, [e.source]);
        }

        const visited = new Set<string>([localAnchorId]);
        const queue: Array<{ id: string; depth: number }> = [
          { id: localAnchorId, depth: 0 },
        ];
        while (queue.length > 0) {
          const curr = queue.shift()!;
          if (curr.depth >= maxHops) continue;
          const neighbors = adj.get(curr.id) ?? [];
          for (const nextId of neighbors) {
            if (!visited.has(nextId)) {
              visited.add(nextId);
              queue.push({ id: nextId, depth: curr.depth + 1 });
            }
          }
        }
        nodes = nodes.filter((n) => visited.has(n.id));
      } else {
        anchorMissing = true;
      }
    }

    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges = snapshot.edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );

    return {
      visibleNodes: nodes,
      visibleEdges: edges,
      localAnchorMissing: anchorMissing,
    };
  }, [snapshot, showUnresolved, onlyOrphans, localMode, localAnchorId]);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return visibleNodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        (n.path?.toLowerCase().includes(q) ?? false),
    );
  }, [searchQuery, visibleNodes]);

  const searchMatchIdSet = useMemo(
    () => new Set(searchMatches.map((n) => n.id)),
    [searchMatches],
  );

  const topHubs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.nodes
      .filter((n) => n.nodeKind === "document")
      .slice()
      .sort((a, b) => b.centrality - a.centrality || b.degree - a.degree)
      .slice(0, 5);
  }, [snapshot]);

  const centerOnNode = useCallback(
    (node: GraphNode) => {
      if (onlyOrphans && (node.nodeKind !== "document" || node.degree !== 0)) {
        setOnlyOrphans(false);
      }
      setSelectedNode(node);
      const pos = getScaledPos(node.id);
      if (!pos) return;
      const targetZoom = Math.max(camRef.current.zoom, 1.15);
      camRef.current = {
        x: -pos.x * targetZoom,
        y: -pos.y * targetZoom,
        zoom: targetZoom,
      };
    },
    [getScaledPos, onlyOrphans],
  );

  const handleZoomToFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleNodes.length === 0) {
      camRef.current = { x: 0, y: 0, zoom: 1.0 };
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of visibleNodes) {
      const p = getScaledPos(n.id);
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    if (!Number.isFinite(minX)) return;

    const padding = 72;
    const bboxW = Math.max(80, maxX - minX + padding * 2);
    const bboxH = Math.max(80, maxY - minY + padding * 2);
    const nextZoom = Math.min(
      2.5,
      Math.max(0.25, Math.min(rect.width / bboxW, rect.height / bboxH)),
    );
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    camRef.current = {
      x: -midX * nextZoom,
      y: -midY * nextZoom,
      zoom: nextZoom,
    };
  }, [visibleNodes, getScaledPos]);

  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = "oxidevault-graph.png";
    link.click();
  };

  const handleFindPath = async () => {
    if (!fromId || !toId) return;
    const res = await vaultApi.findGraphPath(fromId, toId);
    setPathResult(res);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    const hasSearch = searchQuery.trim().length > 0;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.floor(rect.width * dpr) ||
        canvas.height !== Math.floor(rect.height * dpr)
      ) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, rect.width, rect.height);

      const cx = rect.width / 2 + camRef.current.x;
      const cy = rect.height / 2 + camRef.current.y;
      const zoom = camRef.current.zoom;

      ctx.translate(cx, cy);
      ctx.scale(zoom, zoom);

      const activeSet = new Set<string>();
      if (hoveredNode) {
        activeSet.add(hoveredNode.id);
        for (const e of visibleEdges) {
          if (e.source === hoveredNode.id) activeSet.add(e.target);
          if (e.target === hoveredNode.id) activeSet.add(e.source);
        }
      }

      const pathNodeSet = new Set(
        pathResult?.found ? pathResult.pathNodeIds : [],
      );
      const pathEdgePairs = new Set<string>();
      if (pathResult?.found) {
        for (let i = 0; i + 1 < pathResult.pathNodeIds.length; i++) {
          const a = pathResult.pathNodeIds[i];
          const b = pathResult.pathNodeIds[i + 1];
          pathEdgePairs.add(`${a}|${b}`);
          pathEdgePairs.add(`${b}|${a}`);
        }
      }

      // Draw edges
      for (const edge of visibleEdges) {
        const p1 = getScaledPos(edge.source);
        const p2 = getScaledPos(edge.target);
        if (!p1 || !p2) continue;

        const isPath = pathEdgePairs.has(`${edge.source}|${edge.target}`);
        const isHoverAdj =
          hoveredNode &&
          (edge.source === hoveredNode.id || edge.target === hoveredNode.id);
        const isSearchAdj =
          hasSearch &&
          (searchMatchIdSet.has(edge.source) ||
            searchMatchIdSet.has(edge.target));

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);

        if (isPath) {
          ctx.strokeStyle = "#34d399";
          ctx.lineWidth = 3 / zoom;
        } else if (isHoverAdj) {
          ctx.strokeStyle = "#818cf8";
          ctx.lineWidth = 2 / zoom;
        } else if (hasSearch) {
          ctx.strokeStyle = isSearchAdj
            ? "rgba(251, 191, 36, 0.45)"
            : "rgba(63, 63, 70, 0.14)";
          ctx.lineWidth = (isSearchAdj ? 1.5 : 0.9) / zoom;
        } else {
          ctx.strokeStyle = hoveredNode
            ? "rgba(63, 63, 70, 0.25)"
            : "rgba(82, 82, 91, 0.45)";
          ctx.lineWidth = 1.1 / zoom;
        }
        ctx.stroke();
      }

      // Draw nodes
      for (const node of visibleNodes) {
        const p = getScaledPos(node.id);
        if (!p) continue;

        const baseRadius =
          node.nodeKind === "document"
            ? 8 + Math.min(12, node.degree * 1.6)
            : node.nodeKind === "tag"
              ? 6
              : 5;

        const isPath = pathNodeSet.has(node.id);
        const isSearchMatch = hasSearch && searchMatchIdSet.has(node.id);
        const isActiveDoc = Boolean(activeDocId && node.id === activeDocId);
        const isHighlighted = hoveredNode
          ? activeSet.has(node.id) || isPath || isSearchMatch
          : hasSearch
            ? isSearchMatch || isPath
            : true;

        const fill =
          node.nodeKind === "tag"
            ? "#10b981"
            : node.nodeKind === "unresolved"
              ? "#52525b"
              : CLUSTER_COLORS[node.clusterId % CLUSTER_COLORS.length];

        ctx.globalAlpha = isHighlighted ? 1.0 : 0.18;

        if (
          isPath ||
          isSearchMatch ||
          selectedNode?.id === node.id ||
          hoveredNode?.id === node.id ||
          isActiveDoc
        ) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, baseRadius + 4.5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = isPath
            ? "rgba(52, 211, 153, 0.28)"
            : isSearchMatch
              ? "rgba(251, 191, 36, 0.35)"
              : isActiveDoc && selectedNode?.id !== node.id
                ? "rgba(56, 189, 248, 0.28)"
                : "rgba(129, 140, 248, 0.3)";
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        if (isSearchMatch) {
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 2 / zoom;
          ctx.stroke();
        } else if (isActiveDoc) {
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 1.6 / zoom;
          ctx.stroke();
        } else if (node.nodeKind === "unresolved") {
          ctx.strokeStyle = "#a1a1aa";
          ctx.setLineDash([2, 2]);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Label
        ctx.font = `${Math.max(10, 11 / Math.sqrt(zoom))}px Inter, sans-serif`;
        ctx.fillStyle = isSearchMatch
          ? "#fde68a"
          : isHighlighted
            ? "#e4e4e7"
            : "#71717a";
        ctx.textAlign = "center";
        ctx.fillText(node.label, p.x, p.y + baseRadius + 13 / zoom);
        ctx.globalAlpha = 1.0;
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [
    snapshot,
    visibleNodes,
    visibleEdges,
    hoveredNode,
    selectedNode,
    pathResult,
    searchQuery,
    searchMatchIdSet,
    activeDocId,
    getScaledPos,
  ]);

  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left - rect.width / 2 - camRef.current.x;
    const sy = clientY - rect.top - rect.height / 2 - camRef.current.y;
    return { x: sx / camRef.current.zoom, y: sy / camRef.current.zoom };
  };

  const hitTest = (wx: number, wy: number): GraphNode | null => {
    for (let i = visibleNodes.length - 1; i >= 0; i--) {
      const n = visibleNodes[i];
      const p = getScaledPos(n.id);
      if (!p) continue;
      const r = 14 / camRef.current.zoom;
      const dx = wx - p.x;
      const dy = wy - p.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  };

  const docNodes =
    snapshot?.nodes.filter((n) => n.nodeKind === "document") ?? [];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* Top Toolbar */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-800/80 bg-zinc-950/90 px-5 py-3 backdrop-blur-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Compass className="h-4 w-4 text-indigo-400" />
            <span>Wissensgraph</span>
          </div>
          {snapshot && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
              <Zap className="h-3 w-3" />
              Rust Layout: {(snapshot.computedInUs / 1000).toFixed(2)} ms (
              {visibleNodes.length}/{snapshot.nodes.length} Knoten,{" "}
              {visibleEdges.length} Kanten)
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Node Search */}
          <div className="relative flex items-center rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus-within:border-amber-500/50">
            <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchMatches.length > 0) {
                  centerOnNode(searchMatches[0]);
                } else if (e.key === "Escape") {
                  setSearchQuery("");
                }
              }}
              placeholder="Knoten suchen..."
              className="w-32 bg-transparent text-zinc-200 placeholder-zinc-500 outline-none"
            />
            {searchQuery.trim() && (
              <>
                <button
                  onClick={() => {
                    if (searchMatches.length > 0) {
                      centerOnNode(searchMatches[0]);
                    }
                  }}
                  title="Ersten Treffer zentrieren"
                  className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-500/30"
                >
                  {searchMatches.length}
                </button>
                <button
                  onClick={() => setSearchQuery("")}
                  title="Suche leeren"
                  className="ml-1 text-zinc-500 hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            )}

            {searchQuery.trim() && searchMatches.length > 0 && (
              <div className="absolute top-full left-0 z-30 mt-1.5 max-h-48 w-60 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/95 p-1 shadow-xl backdrop-blur-xs">
                {searchMatches.slice(0, 8).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => centerOnNode(m)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    <span className="truncate">{m.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {m.nodeKind}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter Toggles */}
          <button
            onClick={() => setIncludeTags((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              includeTags
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Hash className="h-3.5 w-3.5" />
            Tags
          </button>

          <button
            onClick={() => setShowUnresolved((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              showUnresolved
                ? "border-zinc-600 bg-zinc-800/80 text-zinc-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
            }`}
            title="Nicht aufgelöste Ghost-Links ein-/ausblenden"
          >
            <Ghost className="h-3.5 w-3.5" />
            Ghost-Links
          </button>

          <button
            onClick={() => setOnlyOrphans((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              onlyOrphans
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Nur verwaiste Notizen ohne Verknüpfungen (Grad 0)"
          >
            <CircleOff className="h-3.5 w-3.5" />
            Nur Verwaiste
          </button>

          {/* Local Graph Mode */}
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
            <Network className="h-3.5 w-3.5 text-indigo-400" />
            <select
              value={localMode}
              onChange={(e) => setLocalMode(e.target.value as LocalGraphMode)}
              className="bg-transparent text-zinc-200 outline-none"
              title="Lokaler Graph-Modus (BFS-Nachbarschaft)"
            >
              <option value="global" className="bg-zinc-900">
                Global
              </option>
              <option value="1hop" className="bg-zinc-900">
                Lokal 1-Hop
              </option>
              <option value="2hop" className="bg-zinc-900">
                Lokal 2-Hops
              </option>
            </select>
          </div>

          {/* Layout Spacing Slider */}
          <div
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300"
            title="Knoten-Abstand skalieren"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
            <input
              type="range"
              min={0.6}
              max={2.0}
              step={0.05}
              value={spacing}
              onChange={(e) => setSpacing(parseFloat(e.target.value))}
              className="w-16 accent-indigo-500"
            />
            <span className="w-8 font-mono text-[11px] text-zinc-400">
              {spacing.toFixed(1)}x
            </span>
          </div>

          {/* Shortest Path */}
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
            <Route className="h-3.5 w-3.5 text-emerald-400" />
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="max-w-28 bg-transparent text-zinc-200 outline-none"
            >
              {docNodes.map((n) => (
                <option key={n.id} value={n.id} className="bg-zinc-900">
                  {n.label}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">→</span>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="max-w-28 bg-transparent text-zinc-200 outline-none"
            >
              {docNodes.map((n) => (
                <option key={n.id} value={n.id} className="bg-zinc-900">
                  {n.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleFindPath}
              className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
            >
              Pfad
            </button>
          </div>

          {/* Zoom to Fit */}
          <button
            onClick={handleZoomToFit}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            title="Sichtbare Knoten in Ansicht einpassen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Einpassen
          </button>

          {/* PNG Export */}
          <button
            onClick={handleExportPng}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            title="Graph als PNG exportieren"
          >
            <Download className="h-3.5 w-3.5" />
            PNG
          </button>

          {/* Reset */}
          <button
            onClick={() => {
              camRef.current = { x: 0, y: 0, zoom: 1.0 };
              setSpacing(1.0);
              setSearchQuery("");
              setLocalMode("global");
              setOnlyOrphans(false);
              setShowUnresolved(true);
              setPathResult(null);
              void loadGraph(includeTags);
            }}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      {pathResult && (
        <div className="z-10 flex items-center justify-between border-b border-emerald-500/30 bg-emerald-500/10 px-5 py-2 text-xs text-emerald-200">
          <span>
            {pathResult.found
              ? `Kürzester Wissenspfad (${pathResult.hops} Hops): ${pathResult.pathLabels.join("  →  ")}`
              : "Kein direkter Verknüpfungspfad zwischen diesen beiden Notizen."}
          </span>
          <button
            onClick={() => setPathResult(null)}
            className="text-emerald-400 hover:underline"
          >
            Ausblenden
          </button>
        </div>
      )}

      {localAnchorMissing && (
        <div className="z-10 flex items-center justify-between border-b border-indigo-500/30 bg-indigo-500/10 px-5 py-1.5 text-xs text-indigo-200">
          <span>
            Lokal-Modus aktiv: Wähle einen Knoten im Graph aus, um seine{" "}
            {localMode === "1hop" ? "1-Hop" : "2-Hops"}-Nachbarschaft zu
            isolieren.
          </span>
        </div>
      )}

      {/* Interactive Canvas Area */}
      <div className="relative flex flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="h-full w-full flex-1 cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => {
            const w = toWorld(e.clientX, e.clientY);
            const hit = hitTest(w.x, w.y);
            if (hit) {
              setSelectedNode(hit);
              dragRef.current = {
                mode: "node",
                nodeId: hit.id,
                lastX: e.clientX,
                lastY: e.clientY,
              };
            } else {
              dragRef.current = {
                mode: "pan",
                lastX: e.clientX,
                lastY: e.clientY,
              };
            }
          }}
          onMouseMove={(e) => {
            if (dragRef.current.mode === "pan") {
              camRef.current.x += e.clientX - dragRef.current.lastX;
              camRef.current.y += e.clientY - dragRef.current.lastY;
              dragRef.current.lastX = e.clientX;
              dragRef.current.lastY = e.clientY;
              return;
            }
            if (dragRef.current.mode === "node" && dragRef.current.nodeId) {
              const p = positionsRef.current.get(dragRef.current.nodeId);
              if (p) {
                const denom = camRef.current.zoom * spacingRef.current;
                p.x += (e.clientX - dragRef.current.lastX) / denom;
                p.y += (e.clientY - dragRef.current.lastY) / denom;
              }
              dragRef.current.lastX = e.clientX;
              dragRef.current.lastY = e.clientY;
              return;
            }

            const w = toWorld(e.clientX, e.clientY);
            setHoveredNode(hitTest(w.x, w.y));
          }}
          onMouseUp={() => {
            dragRef.current.mode = "none";
          }}
          onDoubleClick={(e) => {
            const w = toWorld(e.clientX, e.clientY);
            const hit = hitTest(w.x, w.y);
            if (hit?.path) {
              onOpenDocument(hit.path);
            }
          }}
          onWheel={(e) => {
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            camRef.current.zoom = Math.min(
              3.5,
              Math.max(0.25, camRef.current.zoom * factor),
            );
          }}
        />

        {snapshot && visibleNodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 px-4 py-2.5 text-xs text-zinc-400 shadow-lg">
              Keine Knoten entsprechen den aktuellen Filterkriterien.
            </div>
          </div>
        )}

        {/* Top Hubs Collapsible Panel */}
        {topHubs.length > 0 && (
          <div className="absolute top-4 right-4 z-10 w-64 rounded-xl border border-zinc-800 bg-zinc-900/90 text-xs shadow-xl backdrop-blur-xs">
            <button
              onClick={() => setHubsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-zinc-200 hover:bg-zinc-800/60"
            >
              <span className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                Top Hubs ({topHubs.length})
              </span>
              {hubsOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              )}
            </button>
            {hubsOpen && (
              <div className="space-y-1 border-t border-zinc-800/80 p-2">
                {topHubs.map((hub, idx) => {
                  const isSel = selectedNode?.id === hub.id;
                  return (
                    <button
                      key={hub.id}
                      onClick={() => centerOnNode(hub)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                        isSel
                          ? "bg-indigo-500/20 text-indigo-200"
                          : "text-zinc-300 hover:bg-zinc-800/80"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="w-4 shrink-0 font-mono text-[10px] text-zinc-500">
                          #{idx + 1}
                        </span>
                        <span className="truncate">{hub.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-emerald-400">
                        {(hub.centrality * 100).toFixed(1)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Selected Node Details */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 z-10 w-72 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3.5 text-xs shadow-xl backdrop-blur-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-zinc-100">
                {selectedNode.label}
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-zinc-500 hover:text-zinc-200"
                title="Auswahl aufheben"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-3 text-zinc-400">
              <span>Typ: {selectedNode.nodeKind}</span>
              <span>Grad: {selectedNode.degree}</span>
              <span>Cluster: #{selectedNode.clusterId}</span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-500">
              PageRank: {(selectedNode.centrality * 100).toFixed(2)}%
            </div>
            {selectedNode.path && (
              <button
                onClick={() => onOpenDocument(selectedNode.path!)}
                className="mt-2.5 w-full rounded-lg bg-indigo-600 py-1.5 font-semibold text-white hover:bg-indigo-500"
              >
                Notiz im Editor öffnen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
