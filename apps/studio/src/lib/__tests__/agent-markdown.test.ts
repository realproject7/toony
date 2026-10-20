// The agent panel's Markdown subset: replies become a token tree that the panel
// renders with React elements, so markup never becomes HTML, links only go to
// internal paths or visible http(s) addresses, and common chat formatting works.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isInternalHref,
  isSafeExternalHref,
  MARKDOWN_MAX_CHARS,
  type MdBlock,
  type MdInline,
  parseInline,
  parseMarkdown,
  plainText,
} from "../agent/markdown.js";

function only(blocks: MdBlock[]): MdBlock {
  assert.equal(blocks.length, 1, JSON.stringify(blocks));
  return blocks[0] as MdBlock;
}

function paragraph(source: string): MdInline[] {
  const block = only(parseMarkdown(source));
  assert.equal(block.type, "paragraph");
  return (block as Extract<MdBlock, { type: "paragraph" }>).children;
}

test("HTML in a reply stays text and produces no element tokens", () => {
  const blocks = parseMarkdown(
    'Hello <script>alert(1)</script> and <img src=x onerror="alert(2)"> <b>bold</b>',
  );
  const inline = (only(blocks) as Extract<MdBlock, { type: "paragraph" }>).children;
  assert.deepEqual(inline, [
    {
      type: "text",
      text: 'Hello <script>alert(1)</script> and <img src=x onerror="alert(2)"> <b>bold</b>',
    },
  ]);
  const types = new Set(JSON.stringify(blocks).match(/"type":"[a-z]+"/g));
  assert.deepEqual([...types], ['"type":"paragraph"', '"type":"text"']);
});

test("internal links become link tokens; other schemes stay plain text", () => {
  assert.deepEqual(paragraph("See [Episode 2](/w/my-work/episodes/ep-002)."), [
    { type: "text", text: "See " },
    {
      type: "link",
      href: "/w/my-work/episodes/ep-002",
      children: [{ type: "text", text: "Episode 2" }],
    },
    { type: "text", text: "." },
  ]);
  for (const href of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:x",
    "//evil.example/path",
    "/\\evil.example",
    "file:///etc/passwd",
    "mailto:a@b.example",
  ]) {
    const inline = paragraph(`[click](${href})`);
    assert.equal(plainText(inline), "click", href);
    assert.ok(
      inline.every((node) => node.type === "text"),
      `${href} must not become a link: ${JSON.stringify(inline)}`,
    );
  }
});

test("http(s) links keep their address visible and drop credentials", () => {
  assert.deepEqual(paragraph("Docs: [the guide](https://docs.example.com/start?x=1)"), [
    { type: "text", text: "Docs: " },
    { type: "external", href: "https://docs.example.com/start?x=1", label: "the guide" },
  ]);
  // Built at run time so no credential-shaped address sits in the source.
  const withUser = ["https://", "someone", "@example.com/"].join("");
  assert.equal(isSafeExternalHref(withUser), false);
  assert.equal(isSafeExternalHref("http://example.com/a b"), false);
  assert.equal(isSafeExternalHref("ftp://example.com/"), false);
  const inline = paragraph(`[x](${withUser})`);
  assert.ok(inline.every((node) => node.type === "text"));
});

test("internal href rules", () => {
  assert.equal(isInternalHref("/"), true);
  assert.equal(isInternalHref("/w/a/episodes/ep-001?item=cut:cut-002"), true);
  assert.equal(isInternalHref("//example.com"), false);
  assert.equal(isInternalHref("w/a"), false);
  assert.equal(isInternalHref("/a\nb"), false);
  assert.equal(isInternalHref("/a b"), false);
  assert.equal(isInternalHref("https://example.com"), false);
});

test("code spans keep their content literally", () => {
  assert.deepEqual(paragraph("Run `claude auth login` then `**not bold**` and ``a `tick` b``"), [
    { type: "text", text: "Run " },
    { type: "code", text: "claude auth login" },
    { type: "text", text: " then " },
    { type: "code", text: "**not bold**" },
    { type: "text", text: " and " },
    { type: "code", text: "a `tick` b" },
  ]);
  assert.deepEqual(paragraph("an `unclosed tick"), [{ type: "text", text: "an `unclosed tick" }]);
});

test("bold, italic, strikethrough and escapes", () => {
  assert.deepEqual(paragraph("**Bold** and *italic* and _also_ and ~~gone~~"), [
    { type: "strong", children: [{ type: "text", text: "Bold" }] },
    { type: "text", text: " and " },
    { type: "em", children: [{ type: "text", text: "italic" }] },
    { type: "text", text: " and " },
    { type: "em", children: [{ type: "text", text: "also" }] },
    { type: "text", text: " and " },
    { type: "strike", children: [{ type: "text", text: "gone" }] },
  ]);
  assert.deepEqual(paragraph("snake_case_name and 2 * 3 * 4"), [
    { type: "text", text: "snake_case_name and 2 * 3 * 4" },
  ]);
  assert.deepEqual(paragraph("\\*not italic\\*"), [{ type: "text", text: "*not italic*" }]);
  assert.deepEqual(paragraph("**bold with *italic* inside**"), [
    {
      type: "strong",
      children: [
        { type: "text", text: "bold with " },
        { type: "em", children: [{ type: "text", text: "italic" }] },
        { type: "text", text: " inside" },
      ],
    },
  ]);
});

test("lists: unordered, ordered with a start, nested and continued", () => {
  const blocks = parseMarkdown(
    [
      "Plan:",
      "- Write the outline",
      "- Add **cuts**",
      "  - Cut 1",
      "  - Cut 2",
      "- Letter",
      "",
      "3. Third",
      "4. Fourth",
      "   continues here",
    ].join("\n"),
  );
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.type, "paragraph");
  const bullets = blocks[1] as Extract<MdBlock, { type: "list" }>;
  assert.equal(bullets.type, "list");
  assert.equal(bullets.ordered, false);
  assert.equal(bullets.items.length, 3);
  assert.equal(plainText(bullets.items[1]?.children ?? []), "Add cuts");
  assert.deepEqual(
    bullets.items[1]?.list?.items.map((item) => plainText(item.children)),
    ["Cut 1", "Cut 2"],
  );
  const numbered = blocks[2] as Extract<MdBlock, { type: "list" }>;
  assert.equal(numbered.ordered, true);
  assert.equal(numbered.start, 3);
  assert.equal(plainText(numbered.items[1]?.children ?? []), "Fourth continues here");
});

test("headings, fenced code, quotes, rules and paragraphs with line breaks", () => {
  const blocks = parseMarkdown(
    [
      "## Episode plan",
      "First line",
      "second line",
      "",
      "```json",
      '{ "a": "<b>1</b>" }',
      "```",
      "> Quoted **text**",
      "---",
      "#### Deep heading",
    ].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "paragraph", "code", "quote", "rule", "heading"],
  );
  assert.equal((blocks[0] as Extract<MdBlock, { type: "heading" }>).level, 2);
  assert.deepEqual((blocks[1] as Extract<MdBlock, { type: "paragraph" }>).children, [
    { type: "text", text: "First line" },
    { type: "break" },
    { type: "text", text: "second line" },
  ]);
  assert.deepEqual(blocks[2], { type: "code", text: '{ "a": "<b>1</b>" }', lang: "json" });
  const quote = blocks[3] as Extract<MdBlock, { type: "quote" }>;
  assert.equal(quote.children[0]?.type, "paragraph");
  assert.equal((blocks[5] as Extract<MdBlock, { type: "heading" }>).level, 3);
});

test("an unclosed fence keeps the rest as code", () => {
  const blocks = parseMarkdown("```\nline one\n# not a heading");
  assert.deepEqual(blocks, [{ type: "code", text: "line one\n# not a heading", lang: "" }]);
});

test("pipe tables parse with inline cells and a column cap", () => {
  const blocks = parseMarkdown(
    ["| Cut | Line |", "| --- | :--- |", "| 1 | **Hi** |", "| 2 | a \\| b |"].join("\n"),
  );
  const table = only(blocks) as Extract<MdBlock, { type: "table" }>;
  assert.equal(table.type, "table");
  assert.deepEqual(table.head.map(plainText), ["Cut", "Line"]);
  assert.deepEqual(
    table.rows.map((row) => row.map(plainText)),
    [
      ["1", "Hi"],
      ["2", "a | b"],
    ],
  );
  const wide = parseMarkdown(
    [
      `|${Array.from({ length: 20 }, (_, i) => ` c${i} `).join("|")}|`,
      `|${Array.from({ length: 20 }, () => "---").join("|")}|`,
    ].join("\n"),
  );
  assert.equal((only(wide) as Extract<MdBlock, { type: "table" }>).head.length, 12);
});

test("huge or hostile input is bounded and never throws", () => {
  const long = "a".repeat(MARKDOWN_MAX_CHARS + 5000);
  const blocks = parseMarkdown(long);
  const text = plainText((only(blocks) as Extract<MdBlock, { type: "paragraph" }>).children);
  assert.equal(text.length, MARKDOWN_MAX_CHARS);
  const nested = `${"**".repeat(400)}x${"**".repeat(400)}`;
  assert.doesNotThrow(() => parseMarkdown(nested));
  assert.doesNotThrow(() => parseMarkdown("[".repeat(5000)));
  assert.doesNotThrow(() => parseMarkdown(`${"- ".repeat(3000)}x`));
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseInline("plain"), [{ type: "text", text: "plain" }]);
});

test("stray delimiters in a long reply parse in linear time and stay text", () => {
  for (const unit of ["*a ", "_b ", "~~c ", "[d ", "`e ", "**f "]) {
    const source = unit.repeat(12_000);
    const started = performance.now();
    const blocks = parseMarkdown(source);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1500, `${JSON.stringify(unit)} took ${Math.round(elapsed)} ms`);
    assert.equal(blocks.length, 1);
  }
});
