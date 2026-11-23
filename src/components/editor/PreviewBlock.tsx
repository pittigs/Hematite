import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Flame,
  ImageOff,
  Info,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { vaultApi } from "../../api/bridge";
import type { Block, BlockLookup } from "../../types/vault";
import {
  type CalloutKind,
  parseCalloutHeader,
  parseInlineTokens,
  stripExplicitBlockIds,
} from "../../utils/markdownRich";
import { extractBlockRefs, type HoverDocPreview } from "./editorHelpers";

const assetDataUrlCache = new Map<string, string>();

export const CALLOUT_STYLES: Record<
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

export function CalloutIcon({ kind }: { kind: CalloutKind }) {
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

export function AssetImagePreview({
  path,
  alt,
  compact = false,
}: {
  path: string;
  alt: string | null;
  compact?: boolean;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(
    () => assetDataUrlCache.get(path) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = assetDataUrlCache.get(path);
    if (cached) {
      setDataUrl(cached);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    vaultApi
      .getAssetDataUrl(path)
      .then((url) => {
        if (cancelled) return;
        assetDataUrlCache.set(path, url);
        setDataUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <span className="my-1.5 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span>Bild nicht gefunden: {alt ? `${alt} (${path})` : path}</span>
      </span>
    );
  }

  if (!dataUrl) {
    return (
      <span className="my-1.5 inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 font-mono text-[11px] text-zinc-400">
        Lade Bild „{path}“...
      </span>
    );
  }

  return (
    <span className="my-2 inline-block max-w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 p-2 align-top">
      <img
        src={dataUrl}
        alt={alt ?? path}
        loading="lazy"
        className={`block max-w-full rounded-lg object-contain ${
          compact ? "max-h-56" : "max-h-[480px]"
        }`}
      />
      {alt && (
        <span className="mt-1.5 block text-center text-xs text-zinc-400">
          {alt}
        </span>
      )}
    </span>
  );
}

export function CodeBlockPreview({ block }: { block: Block }) {
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

export function WikiLinkPreviewChip({
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

export function renderRichText(
  text: string,
  onNavigate: (target: string) => void,
  loadHoverPreview: (target: string) => Promise<HoverDocPreview | "not_found">,
): React.ReactNode {
  const cleaned = stripExplicitBlockIds(text);
  const tokens = parseInlineTokens(cleaned);

  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case "imageEmbed":
        return <AssetImagePreview key={idx} path={tok.path} alt={tok.alt} />;
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

export function TransclusionCard({
  refId,
  target,
  onNavigate,
  compact = false,
}: {
  refId: string;
  target: BlockLookup;
  onNavigate: (target: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      onClick={() => onNavigate(target.docPath)}
      className={`${compact ? "mt-2 p-3" : "p-3.5"} cursor-pointer rounded-xl border border-amber-500/30 bg-amber-500/5 transition hover:border-amber-400/60`}
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
}

export function PreviewBlock({
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
          <TransclusionCard
            key={refId}
            refId={refId}
            target={target}
            onNavigate={onNavigate}
          />
        );
      })}
    </div>
  );
}
