import { IssueCollector, joinPath } from "./errors.js";
import { isFiniteNumber, isInteger, isPlainObject } from "./guards.js";
import {
  FONT_FAMILY_IDS,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_WEIGHTS,
  type FontFamilyId,
  type FontWeight,
} from "./types.js";

export interface LetteringRangeStyle {
  fontFamily?: FontFamilyId;
  /** Reference-width pixels at the auto-fit target, scaled with the rest of the text. */
  fontSize?: number;
  fontWeight?: FontWeight;
  textColor?: string;
}

export interface LetteringTextRange {
  /** UTF-16 offsets, on grapheme boundaries; end is exclusive. */
  start: number;
  end: number;
  style: LetteringRangeStyle;
}

export interface LetteringTextDocument {
  text: string;
  textRanges?: LetteringTextRange[];
}

export type LetteringStylePatch = {
  [K in keyof LetteringRangeStyle]?: LetteringRangeStyle[K] | null;
};
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const styleKeys = new Set(["fontFamily", "fontSize", "fontWeight", "textColor"]);

export function letteringGraphemeBoundaries(text: string): number[] {
  return [...segmenter.segment(text)].map((part) => part.index).concat(text.length);
}

export function validateLetteringTextRanges(
  value: unknown,
  text: string,
  path: string,
  c: IssueCollector,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 2048) {
    c.add(path, "text-ranges.array", "textRanges must be an array of at most 2048 ranges.");
    return;
  }
  const boundaries = new Set(letteringGraphemeBoundaries(text));
  let previousEnd = 0;
  value.forEach((range, i) => {
    const p = joinPath(path, String(i));
    if (!isPlainObject(range)) {
      c.add(p, "text-ranges.range", "range must be an object.");
      return;
    }
    for (const key of Object.keys(range))
      if (!["start", "end", "style"].includes(key))
        c.add(joinPath(p, key), "text-ranges.key", "unsupported range field.");
    if (
      !isInteger(range.start) ||
      !isInteger(range.end) ||
      range.start < previousEnd ||
      range.start >= range.end ||
      !boundaries.has(range.start) ||
      !boundaries.has(range.end)
    ) {
      c.add(
        p,
        "text-ranges.bounds",
        "ranges must be ordered, non-overlapping UTF-16 grapheme intervals.",
      );
    }
    if (isInteger(range.end)) previousEnd = range.end;
    if (!isPlainObject(range.style) || Object.keys(range.style).length === 0) {
      c.add(
        joinPath(p, "style"),
        "text-ranges.style",
        "range style must contain a supported override.",
      );
      return;
    }
    for (const key of Object.keys(range.style))
      if (!styleKeys.has(key))
        c.add(joinPath(p, `style.${key}`), "text-ranges.style-key", "unsupported text style.");
    const s = range.style;
    if (
      s.fontFamily !== undefined &&
      !(FONT_FAMILY_IDS as readonly unknown[]).includes(s.fontFamily)
    )
      c.add(p, "text-ranges.font-family", "unknown font family.");
    if (s.fontWeight !== undefined && !(FONT_WEIGHTS as readonly unknown[]).includes(s.fontWeight))
      c.add(p, "text-ranges.font-weight", "unsupported font weight.");
    if (
      s.fontSize !== undefined &&
      (!isFiniteNumber(s.fontSize) ||
        s.fontSize < FONT_SIZE_MIN_PX ||
        s.fontSize > FONT_SIZE_MAX_PX)
    )
      c.add(p, "text-ranges.font-size", "range font size must be in 6..200 reference pixels.");
    if (
      s.textColor !== undefined &&
      (typeof s.textColor !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(s.textColor))
    )
      c.add(p, "text-ranges.color", "range text color must be a six- or eight-digit hex color.");
  });
}

function styleAt(ranges: LetteringTextRange[], offset: number): LetteringRangeStyle {
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if ((ranges[middle]?.start ?? Infinity) <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const range = ranges[high];
  return range && offset < range.end ? range.style : {};
}

function sameStyle(a: LetteringRangeStyle, b: LetteringRangeStyle): boolean {
  return [...styleKeys].every(
    (key) => a[key as keyof LetteringRangeStyle] === b[key as keyof LetteringRangeStyle],
  );
}

function canonical(text: string, ranges: LetteringTextRange[]): LetteringTextRange[] {
  const result: LetteringTextRange[] = [];
  for (const part of segmenter.segment(text)) {
    const style = styleAt(ranges, part.index);
    if (!Object.keys(style).length) continue;
    const end = part.index + part.segment.length;
    const last = result.at(-1);
    if (last && last.end === part.index && sameStyle(last.style, style)) last.end = end;
    else result.push({ start: part.index, end, style: { ...style } });
  }
  return result;
}

function assertInput(doc: LetteringTextDocument, start: number, end: number): void {
  const c = new IssueCollector();
  validateLetteringTextRanges(doc.textRanges, doc.text, "textRanges", c);
  const bounds = new Set(letteringGraphemeBoundaries(doc.text));
  if (!c.result().valid || !bounds.has(start) || !bounds.has(end) || start > end)
    throw new RangeError("Invalid text document or grapheme selection.");
}

/** Apply overrides to a selection. Null removes the override and restores inheritance. */
export function styleLetteringRange(
  doc: LetteringTextDocument,
  start: number,
  end: number,
  patch: LetteringStylePatch,
): LetteringTextDocument {
  assertInput(doc, start, end);
  if (Object.keys(patch).some((key) => !styleKeys.has(key)))
    throw new RangeError("Unsupported text style.");
  if (start === end) return { ...doc };
  const candidates: LetteringTextRange[] = [];
  for (const part of segmenter.segment(doc.text)) {
    const style = { ...styleAt(doc.textRanges ?? [], part.index) };
    if (part.index >= start && part.index < end)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete style[key as keyof LetteringRangeStyle];
        else if (value !== undefined) Object.assign(style, { [key]: value });
      }
    if (Object.keys(style).length)
      candidates.push({ start: part.index, end: part.index + part.segment.length, style });
  }
  const textRanges = canonical(doc.text, candidates);
  const c = new IssueCollector();
  validateLetteringTextRanges(textRanges, doc.text, "textRanges", c);
  if (!c.result().valid) throw new RangeError("Invalid text style.");
  return { text: doc.text, textRanges };
}

/** Insertions inherit the preceding grapheme; replacements inherit the first selected one. */
export function replaceLetteringText(
  doc: LetteringTextDocument,
  start: number,
  end: number,
  replacement: string,
): LetteringTextDocument {
  assertInput(doc, start, end);
  const text = doc.text.slice(0, start) + replacement + doc.text.slice(end);
  if (doc.textRanges === undefined) return { text };
  const shift = replacement.length - (end - start);
  const ranges: LetteringTextRange[] = [];
  for (const r of doc.textRanges) {
    if (r.start < start) ranges.push({ ...r, end: Math.min(start, r.end) });
    if (r.end > end)
      ranges.push({ ...r, start: Math.max(end, r.start) + shift, end: r.end + shift });
  }
  const inherited = styleAt(doc.textRanges, start === end && start > 0 ? start - 1 : start);
  if (replacement.length && Object.keys(inherited).length)
    ranges.push({ start, end: start + replacement.length, style: inherited });
  ranges.sort((a, b) => a.start - b.start);
  return { text, textRanges: canonical(text, ranges) };
}

/** Reconcile a native textarea/IME update without splitting a composed grapheme. */
export function reconcileLetteringText(
  doc: LetteringTextDocument,
  text: string,
): LetteringTextDocument {
  if (doc.text === text) return { ...doc };
  let start = 0,
    suffix = 0;
  while (start < doc.text.length && start < text.length && doc.text[start] === text[start]) start++;
  const oldBounds = new Set(letteringGraphemeBoundaries(doc.text));
  const newBounds = new Set(letteringGraphemeBoundaries(text));
  while (!oldBounds.has(start) || !newBounds.has(start)) start--;
  while (
    suffix < doc.text.length - start &&
    suffix < text.length - start &&
    doc.text[doc.text.length - suffix - 1] === text[text.length - suffix - 1]
  )
    suffix++;
  while (!oldBounds.has(doc.text.length - suffix) || !newBounds.has(text.length - suffix)) suffix--;
  return replaceLetteringText(
    doc,
    start,
    doc.text.length - suffix,
    text.slice(start, text.length - suffix),
  );
}
