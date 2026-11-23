import type { Block } from "../types/vault.ts";

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "wikiLink"; target: string; alias: string | null }
  | { type: "blockRef"; blockId: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "strike"; text: string }
  | { type: "code"; text: string }
  | { type: "externalLink"; label: string; url: string };

export type CalloutKind =
  | "NOTE"
  | "TIP"
  | "IMPORTANT"
  | "WARNING"
  | "CAUTION"
  | "INFO";

const CALLOUT_KINDS: ReadonlySet<string> = new Set<CalloutKind>([
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
  "INFO",
]);

const DEFAULT_CALLOUT_TITLES: Record<CalloutKind, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
  INFO: "Info",
};

const WORD_CHAR_RE = /[A-Za-z0-9_]/;

function pushText(tokens: InlineToken[], text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === "text") {
    last.text += text;
  } else {
    tokens.push({ type: "text", text });
  }
}

export function parseInlineTokens(text: string): InlineToken[] {
  if (!text) return [];

  const tokens: InlineToken[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // 1. Inline code: `code`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        const inner = text.slice(i + 1, end);
        if (!inner.includes("\n")) {
          tokens.push({ type: "code", text: inner });
          i = end + 1;
          continue;
        }
      }
    }

    // 2. Wiki-Link: [[Target]] or [[Target|Alias]]
    if (ch === "[" && text[i + 1] === "[") {
      const end = text.indexOf("]]", i + 2);
      if (end > i + 2) {
        const inner = text.slice(i + 2, end);
        if (!inner.includes("\n") && !inner.includes("[")) {
          const pipeIdx = inner.indexOf("|");
          const target = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
          const aliasRaw = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : "";
          if (target.length > 0) {
            tokens.push({
              type: "wikiLink",
              target,
              alias: aliasRaw.length > 0 ? aliasRaw : null,
            });
            i = end + 2;
            continue;
          }
        }
      }
    }

    // 3. Block reference: ((block-id))
    if (ch === "(" && text[i + 1] === "(") {
      const slice = text.slice(i);
      const match = /^\(\(([a-zA-Z0-9_-]+)\)\)/.exec(slice);
      if (match) {
        tokens.push({ type: "blockRef", blockId: match[1] });
        i += match[0].length;
        continue;
      }
    }

    // 4. Markdown external link: [label](https://...) or [label](http://...)
    if (ch === "[") {
      const slice = text.slice(i);
      const match = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(slice);
      if (match) {
        tokens.push({
          type: "externalLink",
          label: match[1],
          url: match[2],
        });
        i += match[0].length;
        continue;
      }
    }

    // 5. Bold: **text**
    if (ch === "*" && text[i + 1] === "*") {
      const slice = text.slice(i);
      const match = /^\*\*((?:[^*\n]|\*(?!\*))+)\*\*/.exec(slice);
      if (match && match[1].trim().length > 0) {
        tokens.push({ type: "bold", text: match[1] });
        i += match[0].length;
        continue;
      }
    }

    // 6. Strikethrough: ~~text~~
    if (ch === "~" && text[i + 1] === "~") {
      const slice = text.slice(i);
      const match = /^~~((?:[^~\n]|~(?!~))+)~~/.exec(slice);
      if (match && match[1].trim().length > 0) {
        tokens.push({ type: "strike", text: match[1] });
        i += match[0].length;
        continue;
      }
    }

    // 7. Italic: *text*
    if (ch === "*" && text[i + 1] !== "*") {
      const slice = text.slice(i);
      const match = /^\*([^*\n]+)\*/.exec(slice);
      if (
        match &&
        match[1].length > 0 &&
        !match[1].startsWith(" ") &&
        !match[1].endsWith(" ")
      ) {
        tokens.push({ type: "italic", text: match[1] });
        i += match[0].length;
        continue;
      }
    }

    // 8. Italic: _text_ (avoid matching intra-word snake_case)
    if (ch === "_" && text[i + 1] !== "_") {
      const prev = i > 0 ? text[i - 1] : "";
      if (!prev || !WORD_CHAR_RE.test(prev)) {
        const slice = text.slice(i);
        const match = /^_([^_\n]+)_/.exec(slice);
        if (match && match[1].length > 0) {
          const afterIdx = i + match[0].length;
          const next = afterIdx < len ? text[afterIdx] : "";
          if (
            (!next || !WORD_CHAR_RE.test(next)) &&
            !match[1].startsWith(" ") &&
            !match[1].endsWith(" ")
          ) {
            tokens.push({ type: "italic", text: match[1] });
            i = afterIdx;
            continue;
          }
        }
      }
    }

    // 9. Bare URL: http://... or https://...
    if (
      (ch === "h" || ch === "H") &&
      (text.startsWith("https://", i) || text.startsWith("http://", i))
    ) {
      const slice = text.slice(i);
      const match = /^https?:\/\/[^\s<>()[\]"']+/.exec(slice);
      if (match) {
        let url = match[0];
        while (url.length > 0 && /[.,;:!?]$/.test(url)) {
          url = url.slice(0, -1);
        }
        if (url.length > "http://".length) {
          tokens.push({ type: "externalLink", label: url, url });
          i += url.length;
          continue;
        }
      }
    }

    pushText(tokens, ch);
    i += 1;
  }

  return tokens;
}

export function parseCalloutHeader(raw: string): {
  kind: CalloutKind;
  title: string;
  body: string;
} {
  const normalizedLines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""));

  const firstLine = (normalizedLines[0] ?? "").trim();
  const headerMatch = /^\[!([a-zA-Z]+)\](?:\s+(.*))?$/.exec(firstLine);

  if (headerMatch) {
    const rawKind = headerMatch[1].toUpperCase();
    const kind: CalloutKind = CALLOUT_KINDS.has(rawKind)
      ? (rawKind as CalloutKind)
      : "NOTE";
    const explicitTitle = (headerMatch[2] ?? "").trim();
    const title = explicitTitle || DEFAULT_CALLOUT_TITLES[kind];
    const body = normalizedLines.slice(1).join("\n").trim();
    return { kind, title, body };
  }

  return {
    kind: "NOTE",
    title: DEFAULT_CALLOUT_TITLES.NOTE,
    body: normalizedLines.join("\n").trim(),
  };
}

export function stripExplicitBlockIds(markdown: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inCodeFence = false;

  const cleaned = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      return line;
    }
    if (inCodeFence) {
      return line;
    }
    if (/^\s*\^[a-zA-Z0-9_-]+\s*$/.test(line)) {
      return "";
    }
    return line.replace(/[ \t]+\^[a-zA-Z0-9_-]+[ \t]*$/, "");
  });

  return cleaned.join(eol);
}

export function computeDocumentStats(blocks: Block[]): {
  words: number;
  chars: number;
  readingMinutes: number;
} {
  let words = 0;
  let chars = 0;

  for (const block of blocks) {
    if (block.blockType === "divider") continue;
    const raw = (block.plainText.trim() || block.rawContent.trim());
    if (!raw) continue;
    const cleaned = stripExplicitBlockIds(raw).trim();
    if (!cleaned) continue;
    chars += cleaned.length;
    const parts = cleaned.split(/\s+/).filter(Boolean);
    words += parts.length;
  }

  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));
  return { words, chars, readingMinutes };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineTokensHtml(text: string): string {
  const cleaned = stripExplicitBlockIds(text);
  const tokens = parseInlineTokens(cleaned);
  return tokens
    .map((tok) => {
      switch (tok.type) {
        case "text":
          return escapeHtml(tok.text);
        case "bold":
          return `<strong>${escapeHtml(tok.text)}</strong>`;
        case "italic":
          return `<em>${escapeHtml(tok.text)}</em>`;
        case "strike":
          return `<del>${escapeHtml(tok.text)}</del>`;
        case "code":
          return `<code class="inline-code">${escapeHtml(tok.text)}</code>`;
        case "wikiLink":
          return `<span class="wiki-link">${escapeHtml(tok.alias ?? tok.target)}</span>`;
        case "blockRef":
          return `<span class="block-ref">((${escapeHtml(tok.blockId)}))</span>`;
        case "externalLink":
          return `<a href="${escapeHtml(tok.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tok.label)}</a>`;
      }
    })
    .join("");
}

function renderMultilineInlineHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => renderInlineTokensHtml(line))
    .join("<br />");
}

export function renderDocumentToStandaloneHtml(
  title: string,
  blocks: Block[],
): string {
  const escapedTitle = escapeHtml(title);
  const firstBlock = blocks[0];
  const hasMatchingH1 =
    firstBlock &&
    firstBlock.blockType === "heading" &&
    firstBlock.headingLevel === 1 &&
    stripExplicitBlockIds(firstBlock.rawContent).trim() === title.trim();

  const renderedBlocks = blocks
    .map((block) => {
      const indentPx = Math.max(0, block.depth) * 24;
      const indentStyle = indentPx > 0 ? ` style="margin-left:${indentPx}px"` : "";

      switch (block.blockType) {
        case "divider":
          return `<hr class="divider" />`;

        case "heading": {
          const level = Math.min(6, Math.max(1, block.headingLevel ?? 2));
          return `<h${level}${indentStyle}>${renderInlineTokensHtml(block.rawContent)}</h${level}>`;
        }

        case "codeBlock": {
          const lang = block.codeLang?.trim() || "text";
          const langClass = `language-${escapeHtml(lang)}`;
          return `<div class="code-block"${indentStyle}><div class="code-lang">${escapeHtml(lang)}</div><pre><code class="${langClass}">${escapeHtml(block.rawContent)}</code></pre></div>`;
        }

        case "callout": {
          const { kind, title: calloutTitle, body } = parseCalloutHeader(
            block.rawContent,
          );
          const kindClass = `callout-${kind.toLowerCase()}`;
          const bodyHtml = body
            ? `<div class="callout-body">${renderMultilineInlineHtml(body)}</div>`
            : "";
          return `<div class="callout ${kindClass}"${indentStyle}><div class="callout-header"><span class="callout-badge">${escapeHtml(kind)}</span><span>${escapeHtml(calloutTitle)}</span></div>${bodyHtml}</div>`;
        }

        case "quote":
          return `<blockquote${indentStyle}>${renderMultilineInlineHtml(block.rawContent)}</blockquote>`;

        case "taskItem": {
          const status = block.task?.status ?? "TODO";
          const done = status === "DONE" || status === "CANCELED";
          const checked = status === "DONE" ? " checked" : "";
          const textCls = done ? "task-text task-done" : "task-text";
          return `<div class="task-item"${indentStyle}><input type="checkbox" disabled${checked} /><span class="task-status">${escapeHtml(status)}</span><span class="${textCls}">${renderInlineTokensHtml(block.rawContent)}</span></div>`;
        }

        case "listItem":
          return `<div class="list-item"${indentStyle}><span class="list-bullet">&bull;</span><div class="list-content">${renderInlineTokensHtml(block.rawContent)}</div></div>`;

        case "paragraph":
        default:
          return `<p${indentStyle}>${renderMultilineInlineHtml(block.rawContent)}</p>`;
      }
    })
    .join("\n    ");

  const headerMarkup = hasMatchingH1
    ? ""
    : `<header class="doc-header"><h1>${escapedTitle}</h1></header>\n    `;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    :root {
      color-scheme: dark light;
      --bg: #09090b;
      --surface: #18181b;
      --border: #27272a;
      --fg: #e4e4e7;
      --muted: #a1a1aa;
      --accent: #818cf8;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --surface: #f4f4f5;
        --border: #e4e4e7;
        --fg: #18181b;
        --muted: #52525b;
        --accent: #4f46e5;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 2.5rem 1.25rem;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      line-height: 1.65;
    }
    main {
      max-width: 780px;
      margin: 0 auto;
    }
    .doc-header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
      margin-bottom: 1.5rem;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.3;
    }
    h1 { font-size: 1.875rem; margin-top: 0; }
    h2 { font-size: 1.375rem; }
    h3 { font-size: 1.125rem; }
    p { margin: 0.75rem 0; }
    a { color: var(--accent); text-decoration: underline; }
    .inline-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.875em;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.1em 0.35em;
    }
    .wiki-link {
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      padding: 0.08em 0.4em;
      border-radius: 4px;
      font-weight: 500;
    }
    .block-ref {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85em;
      color: #f59e0b;
      background: rgba(245, 158, 11, 0.14);
      padding: 0.08em 0.35em;
      border-radius: 4px;
    }
    .code-block {
      margin: 1rem 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--surface);
    }
    .code-lang {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: var(--muted);
      padding: 0.35rem 0.75rem;
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
    }
    .code-block pre {
      margin: 0;
      padding: 0.9rem 1rem;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    blockquote {
      margin: 1rem 0;
      padding: 0.25rem 0 0.25rem 1rem;
      border-left: 3px solid var(--accent);
      color: var(--muted);
      font-style: italic;
    }
    .callout {
      margin: 1rem 0;
      padding: 0.85rem 1rem;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
    }
    .callout-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }
    .callout-badge {
      font-size: 0.7rem;
      letter-spacing: 0.05em;
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 20%, transparent);
    }
    .callout-note { border-color: rgba(99, 102, 241, 0.45); }
    .callout-info { border-color: rgba(14, 165, 233, 0.45); }
    .callout-tip { border-color: rgba(16, 185, 129, 0.45); }
    .callout-important { border-color: rgba(168, 85, 247, 0.45); }
    .callout-warning { border-color: rgba(245, 158, 11, 0.5); }
    .callout-caution { border-color: rgba(244, 63, 94, 0.5); }
    .list-item, .task-item {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0.4rem 0;
    }
    .list-bullet {
      color: var(--accent);
      font-weight: bold;
    }
    .task-status {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.72rem;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: var(--surface);
    }
    .task-done {
      text-decoration: line-through;
      color: var(--muted);
    }
    .divider {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 1.5rem 0;
    }
  </style>
</head>
<body>
  <main>
    ${headerMarkup}${renderedBlocks}
  </main>
</body>
</html>
`;
}
