import type {
  Block,
  BlockType,
  DocumentSummary,
  SearchResult,
} from "../../types/vault";
import { parseInlineTokens, stripExplicitBlockIds } from "../../utils/markdownRich";

export const MAX_HISTORY = 50;

export interface SlashOption {
  type: BlockType;
  label: string;
  headingLevel?: number;
  keywords: string;
  initialContent?: string;
}

export const SLASH_OPTIONS: SlashOption[] = [
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

export type AutocompleteMenuState =
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

export interface BlockRefCandidate {
  blockId: string;
  docTitle: string;
  docPath: string;
  preview: string;
  isLocal: boolean;
}

export interface PendingFocus {
  blockId: string;
  position: "start" | "end" | number;
  selectionEnd?: number;
}

export interface HoverDocPreview {
  title: string;
  path: string;
  snippet: string;
  tags: string[];
}

export interface FindMatch {
  blockId?: string;
  blockIndex?: number;
  start: number;
  end: number;
}

export interface ZoomState {
  isZoomed: boolean;
  rootDepth: number;
  startIdx: number;
  endIdx: number;
  breadcrumbs: Block[];
}

export function cloneBlocks(list: Block[]): Block[] {
  return list.map((b) => ({
    ...b,
    properties: { ...b.properties },
    tags: [...b.tags],
    task: b.task ? { ...b.task } : null,
  }));
}

export function autoResizeTextarea(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
}

export function extractBlockRefs(raw: string): string[] {
  const out: string[] = [];
  const regex = /\(\(([a-zA-Z0-9_-]+)\)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    out.push(match[1]);
  }
  return out;
}

export function extractImageEmbeds(
  raw: string,
): Array<{ path: string; alt: string | null }> {
  const tokens = parseInlineTokens(stripExplicitBlockIds(raw));
  const out: Array<{ path: string; alt: string | null }> = [];
  for (const tok of tokens) {
    if (tok.type === "imageEmbed") {
      out.push({ path: tok.path, alt: tok.alt });
    }
  }
  return out;
}

export function findMatchesInText(
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

export function replaceAllOccurrences(
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

export function serializeBlocksToCleanMarkdown(
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
        const box =
          st === "DONE" ? "x" : st === "DOING" ? "/" : st === "CANCELED" ? "-" : " ";
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

export function triggerFileDownload(
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

export function slugifyFilename(titleOrPath: string): string {
  const base = titleOrPath.replace(/\.md$/i, "").split("/").pop() || "dokument";
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "-").trim();
  return cleaned || "dokument";
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Datei konnte nicht als Base64 gelesen werden."));
        return;
      }
      const commaIdx = reader.result.indexOf(",");
      resolve(
        commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result,
      );
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Datei konnte nicht gelesen werden."));
    };
    reader.readAsDataURL(file);
  });
}

export function detectAutocomplete(
  blockId: string,
  value: string,
  cursorPos: number,
): AutocompleteMenuState | null {
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
}

export function computeZoomState(
  blocks: Block[],
  zoomBlockId: string | null,
): ZoomState {
  if (!zoomBlockId) {
    return {
      isZoomed: false,
      rootDepth: 0,
      startIdx: 0,
      endIdx: blocks.length - 1,
      breadcrumbs: [],
    };
  }
  const idx = blocks.findIndex((b) => b.id === zoomBlockId);
  if (idx === -1) {
    return {
      isZoomed: false,
      rootDepth: 0,
      startIdx: 0,
      endIdx: blocks.length - 1,
      breadcrumbs: [],
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
}

export function createNewBlock(
  docId: string,
  index: number,
  depth = 0,
  blockType: BlockType = "paragraph",
  content = "",
): Block {
  return {
    id: `b-new-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    docId,
    parentBlockId: null,
    depth,
    sortOrder: (index + 1.5) * 1000,
    blockType,
    headingLevel: blockType === "heading" ? 2 : null,
    codeLang: null,
    hasExplicitId: false,
    rawContent: content,
    plainText: content,
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
}

export function filterSlashOptions(
  menu: AutocompleteMenuState | null,
): SlashOption[] {
  if (!menu || menu.kind !== "slash") return [];
  const q = menu.query.trim().toLowerCase();
  if (!q) return SLASH_OPTIONS;
  return SLASH_OPTIONS.filter(
    (opt) =>
      opt.label.toLowerCase().includes(q) ||
      opt.type.toLowerCase().includes(q) ||
      opt.keywords.includes(q),
  );
}

export function filterWikiDocs(
  menu: AutocompleteMenuState | null,
  allDocuments: DocumentSummary[],
): DocumentSummary[] {
  if (!menu || menu.kind !== "wiki") return [];
  const q = menu.query.trim().toLowerCase();
  const matched = q
    ? allDocuments.filter(
        (d) =>
          d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q),
      )
    : allDocuments;
  return matched.slice(0, 15);
}

export function buildBlockRefCandidates(
  menu: AutocompleteMenuState | null,
  blocks: Block[],
  docTitle: string,
  docPath: string,
  remoteBlockRefs: SearchResult[],
): BlockRefCandidate[] {
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
        docTitle,
        docPath,
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
}

export function computeFindMatches(
  findOpen: boolean,
  findQuery: string,
  mode: "hybrid" | "preview" | "raw",
  rawMarkdown: string,
  blocks: Block[],
  caseSensitive: boolean,
): FindMatch[] {
  if (!findOpen || !findQuery) return [];
  if (mode === "raw") {
    return findMatchesInText(rawMarkdown, findQuery, caseSensitive);
  }
  const list: FindMatch[] = [];
  blocks.forEach((b, blockIndex) => {
    if (b.blockType === "divider") return;
    const inBlk = findMatchesInText(b.rawContent, findQuery, caseSensitive);
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
}

export function getClipboardImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) return file;
  }
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

export function isBlockHiddenByCollapse(
  blocks: Block[],
  index: number,
  minBound: number,
): boolean {
  const currentDepth = blocks[index].depth;
  for (let i = index - 1; i >= minBound; i--) {
    if (blocks[i].depth < currentDepth) {
      if (blocks[i].collapsed) return true;
      return isBlockHiddenByCollapse(blocks, i, minBound);
    }
  }
  return false;
}

export function computeVisibleBlockIndices(
  blocks: Block[],
  zoomState: ZoomState,
  mode: "hybrid" | "preview" | "raw",
): number[] {
  const out: number[] = [];
  if (blocks.length === 0) return out;
  const start = zoomState.isZoomed ? zoomState.startIdx : 0;
  const end = zoomState.isZoomed ? zoomState.endIdx : blocks.length - 1;
  for (let i = start; i <= end; i++) {
    if (mode === "hybrid" && isBlockHiddenByCollapse(blocks, i, start)) continue;
    out.push(i);
  }
  return out;
}

export function getBlockTextareaClassName(blk: Block): string {
  const base =
    "w-full resize-none overflow-hidden bg-transparent outline-none placeholder-zinc-600";
  if (blk.blockType === "heading") {
    if (blk.headingLevel === 1) return `${base} text-2xl font-bold text-zinc-50`;
    if (blk.headingLevel === 2) return `${base} text-xl font-semibold text-zinc-100`;
    return `${base} text-base font-semibold text-zinc-200`;
  }
  if (blk.blockType === "codeBlock") {
    return `${base} rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 font-mono text-xs text-emerald-300`;
  }
  if (blk.blockType === "callout") {
    return `${base} rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm text-indigo-100`;
  }
  if (blk.blockType === "quote") {
    return `${base} border-l-2 border-indigo-500 pl-3 text-sm italic text-zinc-300`;
  }
  return `${base} text-sm leading-relaxed text-zinc-200`;
}

export function buildSlashOptionPatch(opt: SlashOption): Partial<Block> {
  const initial = opt.initialContent ?? "";
  return {
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
  };
}

export function buildNextTaskPatch(blk: Block): Partial<Block> {
  const curr = blk.task?.status ?? "TODO";
  const nextStatus =
    curr === "TODO" ? "DOING" : curr === "DOING" ? "DONE" : "TODO";
  return {
    task: {
      status: nextStatus,
      priority: blk.task?.priority ?? null,
      scheduledAt: blk.task?.scheduledAt ?? null,
      deadlineAt: blk.task?.deadlineAt ?? null,
      recurrence: blk.task?.recurrence ?? null,
    },
  };
}

export function reorderBlockList(
  blocks: Block[],
  sourceId: string,
  targetId: string,
): Block[] | null {
  if (sourceId === targetId) return null;
  const fromIdx = blocks.findIndex((b) => b.id === sourceId);
  const toIdx = blocks.findIndex((b) => b.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return null;
  const next = [...blocks];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function moveBlockInList(
  blocks: Block[],
  index: number,
  dir: -1 | 1,
): Block[] | null {
  const target = index + dir;
  if (target < 0 || target >= blocks.length) return null;
  const next = [...blocks];
  const [removed] = next.splice(index, 1);
  next.splice(target, 0, removed);
  return next;
}

export function computeFocusRange(
  valueLength: number,
  focus: PendingFocus,
): { start: number; end: number } {
  const start =
    focus.position === "start"
      ? 0
      : focus.position === "end"
        ? valueLength
        : Math.min(valueLength, Math.max(0, focus.position));
  const end =
    focus.selectionEnd !== undefined
      ? Math.min(valueLength, Math.max(start, focus.selectionEnd))
      : start;
  return { start, end };
}

export function replaceMatchInBlocks(
  blocks: Block[],
  match: FindMatch,
  replacement: string,
): Block[] {
  if (!match.blockId) return blocks;
  return blocks.map((b) => {
    if (b.id !== match.blockId) return b;
    const text =
      b.rawContent.slice(0, match.start) +
      replacement +
      b.rawContent.slice(match.end);
    return { ...b, rawContent: text, plainText: text };
  });
}

export function replaceAllInBlocks(
  blocks: Block[],
  query: string,
  replacement: string,
  caseSensitive: boolean,
): Block[] {
  return blocks.map((b) => {
    if (b.blockType === "divider") return b;
    const text = replaceAllOccurrences(
      b.rawContent,
      query,
      replacement,
      caseSensitive,
    );
    return text === b.rawContent ? b : { ...b, rawContent: text, plainText: text };
  });
}

export function applyInlineInsertion(
  rawContent: string,
  triggerStart: number,
  triggerEnd: number,
  insertion: string,
): { nextValue: string; nextCursor: number } {
  return {
    nextValue:
      rawContent.slice(0, triggerStart) +
      insertion +
      rawContent.slice(triggerEnd),
    nextCursor: triggerStart + insertion.length,
  };
}

export function buildHoverPreviewFromDoc(doc: {
  document: { title: string; path: string; tags: string[] };
  blocks: Block[];
}): HoverDocPreview {
  const snippet = doc.blocks
    .filter((b) => b.blockType !== "divider")
    .map((b) => stripExplicitBlockIds(b.plainText || b.rawContent).trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 260);
  return {
    title: doc.document.title,
    path: doc.document.path,
    snippet: snippet || "(Leeres Dokument)",
    tags: doc.document.tags,
  };
}
