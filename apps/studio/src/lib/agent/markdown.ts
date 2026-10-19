// A small, safe Markdown subset for agent replies in the panel. It parses text
// into a token tree; the panel renders the tree with React elements, never with
// HTML strings, so markup in a reply always shows as text. Supported: paragraphs
// (single newlines become line breaks), headings, ordered and unordered lists
// (nested by indentation), fenced code, block quotes, rules, simple pipe tables,
// and inline code, bold, italic, strikethrough and links. Internal links (paths
// starting with one "/") become links into the workspace; http(s) links stay
// visible as their address; anything else stays plain text. No Node or React
// imports, so the Node test runner covers it.

export type MdInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "strike"; children: MdInline[] }
  | { type: "code"; text: string }
  /** A link to a page in this Studio. `href` is a safe internal path. */
  | { type: "link"; href: string; children: MdInline[] }
  /** An http(s) link. The panel shows the address itself and opens it in a new tab. */
  | { type: "external"; href: string; label: string }
  | { type: "break" };

export interface MdListItem {
  children: MdInline[];
  /** Nested list under this item, if any. */
  list?: MdList;
}

export interface MdList {
  type: "list";
  ordered: boolean;
  start: number;
  items: MdListItem[];
}

export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MdInline[] }
  | MdList
  | { type: "code"; text: string; lang: string }
  | { type: "quote"; children: MdBlock[] }
  | { type: "rule" }
  | { type: "table"; head: MdInline[][]; rows: MdInline[][][] };

/** Replies longer than this are cut before parsing. */
export const MARKDOWN_MAX_CHARS = 100_000;
const MAX_TABLE_COLUMNS = 12;
const MAX_DEPTH = 6;

/** True for a same-origin path such as `/w/my-work/episodes/ep-002`. */
export function isInternalHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  if (href.includes("\\")) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused on purpose.
  if (/[\u0000-\u001f\u007f\s]/.test(href)) return false;
  return true;
}

/** True for an absolute http(s) address without credentials or control characters. */
export function isSafeExternalHref(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused on purpose.
  if (/[\u0000-\u001f\u007f\s<>"'`]/.test(href)) return false;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return url.hostname.length > 0;
  } catch {
    return false;
  }
}

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!|~>".split(""));

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/**
 * Per-parse memory of delimiters known to have no match from some position on.
 * Without it, every unmatched `*`, `_`, `~~`, `[` or backtick run rescans to the
 * end of the text, which turns a long reply full of stray delimiters into
 * quadratic work. Once a scan from position p finds nothing, a later scan of
 * the same delimiter from p or after is skipped (and the text stays plain).
 */
interface ScanMemo {
  noMatchFrom: Map<string, number>;
}

function knownMissing(memo: ScanMemo, key: string, from: number): boolean {
  const at = memo.noMatchFrom.get(key);
  return at !== undefined && from >= at;
}

function rememberMissing(memo: ScanMemo, key: string, from: number): void {
  const at = memo.noMatchFrom.get(key);
  if (at === undefined || from < at) memo.noMatchFrom.set(key, from);
}

function findBacktickClose(src: string, from: number, run: number, memo: ScanMemo): number {
  const key = `tick:${run}`;
  if (knownMissing(memo, key, from)) return -1;
  const close = src.indexOf("`".repeat(run), from);
  if (close === -1) rememberMissing(memo, key, from);
  return close;
}

/** Find a closing delimiter that is not escaped, not inside a code span, and follows a non-space. */
function findClose(src: string, from: number, delim: string, memo: ScanMemo): number {
  if (knownMissing(memo, `close:${delim}`, from)) return -1;
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      let run = 0;
      while (src[i + run] === "`") run += 1;
      const close = findBacktickClose(src, i + run, run, memo);
      if (close === -1) {
        i += run;
        continue;
      }
      i = close + run;
      continue;
    }
    if (src.startsWith(delim, i) && i > from && !/\s/.test(src[i - 1] ?? " ")) {
      if (delim.length === 1 && src[i + 1] === delim) {
        // `**` is never a single-character close.
        i += 2;
        continue;
      }
      if (delim === "_" && isWordChar(src[i + 1])) {
        i += 1;
        continue;
      }
      return i;
    }
    i += 1;
  }
  rememberMissing(memo, `close:${delim}`, from);
  return -1;
}

function parseLinkTarget(src: string, open: number): { end: number; href: string } | null {
  // `open` points at "(".
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        const raw = src.slice(open + 1, i).trim();
        // An optional title after the address is dropped.
        const href = raw.split(/\s+/)[0] ?? "";
        return { end: i + 1, href: href.replace(/^<|>$/g, "") };
      }
    } else if (ch === "\n") return null;
  }
  return null;
}

function findLabelEnd(src: string, open: number, memo: ScanMemo): number {
  if (knownMissing(memo, "label", open)) return -1;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "`") {
      let run = 0;
      while (src[i + run] === "`") run += 1;
      const close = findBacktickClose(src, i + run, run, memo);
      if (close !== -1) i = close + run - 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  rememberMissing(memo, "label", open);
  return -1;
}

function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.text;
        case "break":
          return " ";
        case "external":
          return node.label;
        default:
          return inlineText(node.children);
      }
    })
    .join("");
}

/** Parse inline Markdown into tokens. Lines are joined with breaks. */
export function parseInline(src: string, depth = 0, inLink = false): MdInline[] {
  return parseInlineWith(src, depth, inLink, { noMatchFrom: new Map() });
}

function parseInlineWith(src: string, depth: number, inLink: boolean, memo: ScanMemo): MdInline[] {
  const out: MdInline[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, src);
    return out;
  }
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.has(src[i + 1] as string)) {
      pushText(out, src[i + 1] as string);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      out.push({ type: "break" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      let run = 0;
      while (src[i + run] === "`") run += 1;
      const close = findBacktickClose(src, i + run, run, memo);
      if (close !== -1 && src[close + run] !== "`") {
        let text = src.slice(i + run, close).replace(/\n/g, " ");
        if (text.length > 2 && text.startsWith(" ") && text.endsWith(" ")) text = text.slice(1, -1);
        out.push({ type: "code", text });
        i = close + run;
        continue;
      }
      pushText(out, "`".repeat(run));
      i += run;
      continue;
    }
    if (ch === "[" && !inLink) {
      const labelEnd = findLabelEnd(src, i, memo);
      if (labelEnd !== -1 && src[labelEnd + 1] === "(") {
        const target = parseLinkTarget(src, labelEnd + 1);
        if (target) {
          const children = parseInlineWith(src.slice(i + 1, labelEnd), depth + 1, true, {
            noMatchFrom: new Map(),
          });
          const label = inlineText(children);
          if (isInternalHref(target.href)) {
            out.push({ type: "link", href: target.href, children });
          } else if (isSafeExternalHref(target.href)) {
            out.push({ type: "external", href: target.href, label });
          } else {
            for (const child of children) {
              if (child.type === "text") pushText(out, child.text);
              else out.push(child);
            }
          }
          i = target.end;
          continue;
        }
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const delim = ch + ch;
      const next = src[i + 2];
      const leftOk = ch === "*" || !isWordChar(src[i - 1]);
      if (next !== undefined && !/\s/.test(next) && leftOk) {
        const close = findClose(src, i + 2, delim, memo);
        if (close !== -1) {
          out.push({
            type: "strong",
            children: parseInlineWith(src.slice(i + 2, close), depth + 1, inLink, {
              noMatchFrom: new Map(),
            }),
          });
          i = close + 2;
          continue;
        }
      }
    }
    if (ch === "~" && src[i + 1] === "~") {
      const next = src[i + 2];
      if (next !== undefined && !/\s/.test(next)) {
        const close = findClose(src, i + 2, "~~", memo);
        if (close !== -1) {
          out.push({
            type: "strike",
            children: parseInlineWith(src.slice(i + 2, close), depth + 1, inLink, {
              noMatchFrom: new Map(),
            }),
          });
          i = close + 2;
          continue;
        }
      }
    }
    if (ch === "*" || ch === "_") {
      const next = src[i + 1];
      const leftOk = ch === "*" || !isWordChar(src[i - 1]);
      if (next !== undefined && !/\s/.test(next) && next !== ch && leftOk) {
        const close = findClose(src, i + 1, ch, memo);
        if (close !== -1) {
          out.push({
            type: "em",
            children: parseInlineWith(src.slice(i + 1, close), depth + 1, inLink, {
              noMatchFrom: new Map(),
            }),
          });
          i = close + 1;
          continue;
        }
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else current += ch;
  }
  cells.push(current.trim());
  return cells.slice(0, MAX_TABLE_COLUMNS);
}

function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

function isBlockStart(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    LIST_ITEM.test(line) ||
    QUOTE.test(line)
  );
}

interface RawItem {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
}

function buildList(items: RawItem[], from: number, depth: number): { list: MdList; next: number } {
  const first = items[from] as RawItem;
  const list: MdList = { type: "list", ordered: first.ordered, start: first.start, items: [] };
  let i = from;
  while (i < items.length) {
    const item = items[i] as RawItem;
    if (item.indent < first.indent) break;
    if (item.indent > first.indent) {
      const parent = list.items[list.items.length - 1];
      if (parent && depth < MAX_DEPTH && !parent.list) {
        const nested = buildList(items, i, depth + 1);
        parent.list = nested.list;
        i = nested.next;
        continue;
      }
      // Too deep or a second nested run: keep it as a sibling.
    }
    if (item.indent === first.indent && item.ordered !== first.ordered) break;
    list.items.push({ children: parseInline(item.text) });
    i += 1;
  }
  return { list, next: i };
}

function parseBlocks(lines: string[], depth: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const current = lines[i] as string;
        if (
          current.trim().startsWith(marker.slice(0, 3)) &&
          current.trim().replace(/[`~]/g, "") === ""
        )
          break;
        body.push(current);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", text: body.join("\n"), lang: fence[2] ?? "" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(3, (heading[1] as string).length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i] as string);
        if (!match) break;
        body.push(match[1] ?? "");
        i += 1;
      }
      blocks.push({
        type: "quote",
        children: depth < MAX_DEPTH ? parseBlocks(body, depth + 1) : [],
      });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const raw: RawItem[] = [];
      while (i < lines.length) {
        const current = lines[i] as string;
        const match = LIST_ITEM.exec(current);
        if (match) {
          const marker = match[2] as string;
          const ordered = /\d/.test(marker);
          raw.push({
            indent: indentOf(match[1] ?? ""),
            ordered,
            start: ordered ? Number.parseInt(marker, 10) : 1,
            text: match[3] ?? "",
          });
          i += 1;
          continue;
        }
        // A continuation line belongs to the previous item.
        if (current.trim() && indentOf(current) > 0 && raw.length > 0 && !isBlockStart(current)) {
          const last = raw[raw.length - 1] as RawItem;
          last.text += `\n${current.trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      let at = 0;
      while (at < raw.length) {
        const built = buildList(raw, at, 0);
        blocks.push(built.list);
        at = built.next;
      }
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[i + 1] as string) &&
      (lines[i + 1] as string).includes("-")
    ) {
      const head = splitRow(line).map((cell) => parseInline(cell));
      const rows: MdInline[][][] = [];
      i += 2;
      while (
        i < lines.length &&
        (lines[i] as string).includes("|") &&
        (lines[i] as string).trim()
      ) {
        const cells = splitRow(lines[i] as string).map((cell) => parseInline(cell));
        rows.push(cells);
        i += 1;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }
    const body: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const current = lines[i] as string;
      if (!current.trim() || isBlockStart(current)) break;
      body.push(current.trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(body.join("\n")) });
  }
  return blocks;
}

/** Parse a reply into blocks. Never throws; unknown syntax stays as text. */
export function parseMarkdown(source: string): MdBlock[] {
  const text = (source ?? "").slice(0, MARKDOWN_MAX_CHARS).replace(/\r\n?/g, "\n");
  return parseBlocks(text.split("\n"), 0);
}

/** The visible text of an inline tree (for labels and tests). */
export function plainText(nodes: MdInline[]): string {
  return inlineText(nodes);
}
