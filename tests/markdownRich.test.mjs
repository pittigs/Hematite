import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDocumentStats,
  parseCalloutHeader,
  parseInlineTokens,
  renderDocumentToStandaloneHtml,
  stripExplicitBlockIds,
} from "../src/utils/markdownRich.ts";

describe("markdownRich utilities", () => {
  it("parses wikiLinks, blockRefs, formatting, and external links", () => {
    const tokens = parseInlineTokens(
      "Siehe [[Architektur & Storage Engine|Architektur]] und [[Roadmap]], **fett**, *kursiv*, ~~alt~~, `code`, ((blk-1)), [Docs](https://example.com) sowie https://oxide.dev.",
    );

    assert.equal(
      tokens.some(
        (t) =>
          t.type === "wikiLink" &&
          t.target === "Architektur & Storage Engine" &&
          t.alias === "Architektur",
      ),
      true,
    );
    assert.equal(
      tokens.some(
        (t) => t.type === "wikiLink" && t.target === "Roadmap" && t.alias === null,
      ),
      true,
    );
    assert.equal(tokens.some((t) => t.type === "bold" && t.text === "fett"), true);
    assert.equal(
      tokens.some((t) => t.type === "italic" && t.text === "kursiv"),
      true,
    );
    assert.equal(tokens.some((t) => t.type === "strike" && t.text === "alt"), true);
    assert.equal(tokens.some((t) => t.type === "code" && t.text === "code"), true);
    assert.equal(
      tokens.some((t) => t.type === "blockRef" && t.blockId === "blk-1"),
      true,
    );
    assert.equal(
      tokens.some(
        (t) =>
          t.type === "externalLink" &&
          t.label === "Docs" &&
          t.url === "https://example.com",
      ),
      true,
    );
    assert.equal(
      tokens.some(
        (t) => t.type === "externalLink" && t.url === "https://oxide.dev",
      ),
      true,
    );
  });

  it("does not treat snake_case identifiers as italic", () => {
    const tokens = parseInlineTokens("nutze my_snake_case_var statt _betont_");
    const italics = tokens.filter((t) => t.type === "italic");
    assert.deepEqual(italics, [{ type: "italic", text: "betont" }]);
  });

  it("parses callout headers and provides NOTE fallback", () => {
    const tip = parseCalloutHeader("> [!TIP] Lazy IDs\n> Text im Tipp");
    assert.equal(tip.kind, "TIP");
    assert.equal(tip.title, "Lazy IDs");
    assert.equal(tip.body, "Text im Tipp");

    const warn = parseCalloutHeader("[!WARNING]\nAchtung!");
    assert.equal(warn.kind, "WARNING");
    assert.equal(warn.title, "Warning");
    assert.equal(warn.body, "Achtung!");

    const fallback = parseCalloutHeader("Nur ein normaler Absatz");
    assert.equal(fallback.kind, "NOTE");
    assert.equal(fallback.body, "Nur ein normaler Absatz");
  });

  it("strips explicit block IDs while preserving code fences", () => {
    const input = [
      "Absatz eins ^blk-1",
      "```rust",
      "let x = \"keep ^blk-in-code\";",
      "```",
      "Absatz zwei ^blk-2",
    ].join("\n");
    const cleaned = stripExplicitBlockIds(input);
    assert.equal(cleaned.includes("^blk-1"), false);
    assert.equal(cleaned.includes("^blk-2"), false);
    assert.equal(cleaned.includes("^blk-in-code"), true);
  });

  it("computes word, char, and reading time stats", () => {
    const stats = computeDocumentStats([
      {
        id: "b1",
        docId: "d1",
        parentBlockId: null,
        depth: 0,
        sortOrder: 1,
        blockType: "paragraph",
        headingLevel: null,
        codeLang: null,
        hasExplicitId: true,
        rawContent: "Hallo OxideVault Welt ^b1",
        plainText: "Hallo OxideVault Welt",
        properties: {},
        tags: [],
        collapsed: false,
        task: null,
        updatedAt: 0,
      },
      {
        id: "b2",
        docId: "d1",
        parentBlockId: null,
        depth: 0,
        sortOrder: 2,
        blockType: "divider",
        headingLevel: null,
        codeLang: null,
        hasExplicitId: false,
        rawContent: "---",
        plainText: "",
        properties: {},
        tags: [],
        collapsed: false,
        task: null,
        updatedAt: 0,
      },
    ]);
    assert.equal(stats.words, 3);
    assert.equal(stats.chars, "Hallo OxideVault Welt".length);
    assert.equal(stats.readingMinutes, 1);
  });

  it("renders standalone HTML safely and escapes dangerous tags", () => {
    const html = renderDocumentToStandaloneHtml("<script>alert(1)</script>", [
      {
        id: "b1",
        docId: "d1",
        parentBlockId: null,
        depth: 0,
        sortOrder: 1,
        blockType: "paragraph",
        headingLevel: null,
        codeLang: null,
        hasExplicitId: false,
        rawContent: "Hallo **<img src=x onerror=alert(1)>**",
        plainText: "Hallo <img src=x onerror=alert(1)>",
        properties: {},
        tags: [],
        collapsed: false,
        task: null,
        updatedAt: 0,
      },
      {
        id: "b2",
        docId: "d1",
        parentBlockId: null,
        depth: 0,
        sortOrder: 2,
        blockType: "callout",
        headingLevel: null,
        codeLang: null,
        hasExplicitId: false,
        rawContent: "[!CAUTION] Risiko\nNicht ignorieren",
        plainText: "[!CAUTION] Risiko\nNicht ignorieren",
        properties: {},
        tags: [],
        collapsed: false,
        task: null,
        updatedAt: 0,
      },
    ]);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.equal(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
    assert.equal(html.includes("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>"), true);
    assert.equal(html.includes("callout-caution"), true);
  });
});
