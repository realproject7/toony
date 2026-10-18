import type { FontFamilyId } from "@toony/schema";
import { FONT_COVERAGE_DATA } from "./coverage-data.js";
import { FONT_FAMILIES, fontFileForWeight, getFontFamily } from "./registry.js";

const intervals = new Map<string, readonly (readonly [number, number])[]>();
for (const [file, data] of Object.entries(FONT_COVERAGE_DATA)) {
  intervals.set(
    file,
    data.ranges.split(",").map((range) => {
      const [a, b = a] = range.split("-");
      return [Number.parseInt(a ?? "", 16), Number.parseInt(b ?? "", 16)] as const;
    }),
  );
}

/** cmap coverage only. Whitespace/control/format characters need no visible glyph. */
function needsGlyph(character: string): boolean {
  return !/[\p{White_Space}\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(character);
}

export function fontHasCodepoint(id: FontFamilyId, codepoint: number, weight = 400): boolean {
  const family = getFontFamily(id);
  if (!family) return false;
  const spans = intervals.get(fontFileForWeight(family, weight >= 600 ? 700 : 400).file) ?? [];
  let low = 0,
    high = spans.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const span = spans[middle];
    if (!span) return false;
    if (codepoint < span[0]) high = middle - 1;
    else if (codepoint > span[1]) low = middle + 1;
    else return true;
  }
  return false;
}

export interface FontCoverageRun {
  /** UTF-16 source offsets; each boundary is a complete grapheme. */
  start: number;
  end: number;
  requestedFontFamily: FontFamilyId;
  fontFamily: FontFamilyId;
  /** No bundled face covers this entire grapheme. Original text stays intact. */
  missingCodepoints: number[];
}

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
// Fixed fallback order, independent of operating-system font installation.
const FALLBACKS: readonly FontFamilyId[] = [
  "nunito",
  "noto-sans-kr",
  "noto-sans-jp",
  ...FONT_FAMILIES.map((family) => family.id),
];

/** Resolve a complete grapheme to one bundled face; never split a combining/emoji cluster.
 * Unsupported clusters retain their requested face and literal text. Callers must
 * surface missingCodepoints: their host fallback appearance cannot promise parity.
 */
export function resolveFontRuns(
  text: string,
  requested: FontFamilyId,
  weight = 400,
): FontCoverageRun[] {
  const result: FontCoverageRun[] = [];
  for (const part of graphemes.segment(text)) {
    const points = [
      ...new Set([...part.segment].filter(needsGlyph).map((c) => c.codePointAt(0) as number)),
    ];
    const covers = (id: FontFamilyId) =>
      points.every((point) => fontHasCodepoint(id, point, weight));
    const resolved = covers(requested) ? requested : FALLBACKS.find(covers);
    const missing = resolved
      ? []
      : points.filter((point) => !fontHasCodepoint(requested, point, weight));
    const previous = result.at(-1);
    if (
      previous &&
      previous.fontFamily === (resolved ?? requested) &&
      JSON.stringify(previous.missingCodepoints) === JSON.stringify(missing)
    )
      previous.end += part.segment.length;
    else
      result.push({
        start: part.index,
        end: part.index + part.segment.length,
        requestedFontFamily: requested,
        fontFamily: resolved ?? requested,
        missingCodepoints: missing,
      });
  }
  return result;
}
