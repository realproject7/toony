import { fontTypography, resolveFontFamily, resolveFontRuns } from "@toony/fonts";
import type { FontFamilyId, FontWeight, LetteringTextRange } from "@toony/schema";
import {
  type BubbleTextLayout,
  type BubbleTextOptions,
  type MeasureWidth,
  matchFaceWeight,
} from "./text.js";

export interface StyledTextSegment {
  text: string;
  fontFamily: FontFamilyId;
  requestedFontFamily: FontFamilyId;
  missingCodepoints: number[];
  /** Positive shear slants the top to the right about the alphabetic baseline. */
  skew: number;
  /** Space reserved for the left descender overhang of geometric oblique. */
  textOffsetX: number;
  fontStack: string;
  fontWeight: FontWeight;
  fontSize: number;
  textColor: string;
  /** Left edge and advance within this line, in reference pixels. */
  x: number;
  width: number;
}

export interface StyledTextLine {
  text: string;
  segments: StyledTextSegment[];
  width: number;
  baseline: number;
  ascent: number;
  descent: number;
  advance: number;
}

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Range-aware layout. Explicit line breaks and source offsets survive wrapping. */
export function layoutStyledText(
  measure: MeasureWidth,
  text: string,
  ranges: LetteringTextRange[],
  boxWidth: number,
  boxHeight: number,
  opts: BubbleTextOptions & {
    fontFamily: FontFamilyId;
    textColor: string;
    fontStyle?: "normal" | "italic";
  },
): { layout: BubbleTextLayout; lines: StyledTextLine[] } {
  const padX = opts.paddingX ?? 0,
    padY = opts.paddingY ?? 0;
  const radius = Math.max(0, opts.cornerRadius ?? 0);
  // Conservative clearance for every row, including mixed-height rows.
  const inset = padY < radius ? radius - Math.sqrt(Math.max(0, padY * (2 * radius - padY))) : 0;
  const available = Math.max(1, boxWidth - 2 * (padX + inset));
  const target = opts.fontSize ?? opts.maxFontSize;
  const spacing = opts.letterSpacing ?? 0;
  const lineFactor = opts.lineHeightFactor ?? 1.2;
  const boundaries = [
    ...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])]),
  ].sort((a, b) => a - b);
  // Resolve once, outside the fit/wrap loop. Repeated candidate widths must not
  // repeatedly inspect every font's cmap or break clusters at a wrap boundary.
  const sources = boundaries.slice(0, -1).flatMap((a, i) => {
    const end = boundaries[i + 1] ?? text.length;
    const style = ranges.find((r) => r.start <= a && a < r.end)?.style ?? {};
    const requested = style.fontFamily ?? opts.fontFamily;
    const weight = matchFaceWeight(style.fontWeight ?? opts.fontWeight ?? 400);
    return resolveFontRuns(text.slice(a, end), requested, weight).map((run) => ({
      ...run,
      start: a + run.start,
      end: a + run.end,
      style,
      weight,
    }));
  });
  const fragments = (start: number, end: number, base: number): StyledTextSegment[] => {
    const result: StyledTextSegment[] = [];
    let x = 0;
    for (const source of sources) {
      const a = Math.max(start, source.start),
        b = Math.min(end, source.end);
      if (a >= b) continue;
      const style = source.style;
      const family = resolveFontFamily(source.fontFamily, "speech");
      const fontSize =
        style.fontSize === undefined
          ? base
          : Math.max(Math.min(style.fontSize, opts.minFontSize), (style.fontSize * base) / target);
      const fontWeight = source.weight;
      const piece = text.slice(a, b);
      const skew = (style.fontStyle ?? opts.fontStyle) === "italic" ? Math.tan(Math.PI / 15) : 0;
      const metrics = fontTypography(family.id);
      const textOffsetX = skew * metrics.descent * fontSize;
      const glyphs = [...graphemes.segment(piece)].length;
      // Account for the tracking gap BETWEEN runs exactly once.
      if (result.length) x += spacing * base;
      const width =
        measure(piece, fontSize, fontWeight, family.id, "css") +
        Math.max(0, glyphs - 1) * spacing * base +
        skew * (metrics.ascent + metrics.descent) * fontSize;
      result.push({
        text: piece,
        fontFamily: family.id,
        requestedFontFamily: source.requestedFontFamily,
        missingCodepoints: source.missingCodepoints,
        skew,
        textOffsetX,
        fontStack: family.stack,
        fontWeight,
        fontSize,
        textColor: style.textColor ?? opts.textColor,
        x,
        width,
      });
      x += width;
    }
    return result;
  };
  const widthOf = (start: number, end: number, base: number) => {
    const last = fragments(start, end, base).at(-1);
    return last ? last.x + last.width : 0;
  };
  const fit = (base: number) => {
    const spans: { start: number; end: number }[] = [];
    let paragraphStart = 0;
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      let start = paragraphStart,
        end = start;
      const flush = () => {
        spans.push({ start, end });
        start = end;
      };
      for (const token of paragraph.matchAll(/\s+|[^\s]+/gu)) {
        const tokenStart = paragraphStart + token.index,
          tokenEnd = tokenStart + token[0].length;
        if (widthOf(start, tokenEnd, base) <= available) {
          end = tokenEnd;
          continue;
        }
        if (end > start) {
          flush();
          start = tokenStart;
        }
        if (/^\s+$/u.test(token[0])) {
          start = end = tokenEnd;
          continue;
        }
        if (widthOf(start, tokenEnd, base) <= available) {
          end = tokenEnd;
          continue;
        }
        // Long words and CJK sequences may break only at complete graphemes.
        const units: { index: number; segment: string }[] = [];
        for (const part of graphemes.segment(token[0])) {
          const previous = units.at(-1);
          if (previous && /^[,.;:!?…。，、！？；：)）\]】》」』%％]+$/u.test(part.segment))
            previous.segment += part.segment;
          else units.push({ index: part.index, segment: part.segment });
        }
        for (const part of units) {
          const a = tokenStart + part.index,
            b = a + part.segment.length;
          if (end > start && widthOf(start, b, base) > available) {
            flush();
            start = a;
          }
          end = b;
        }
      }
      flush();
      const delimiter =
        text.slice(paragraphStart + paragraph.length).match(/^(?:\r\n|\r|\n)/)?.[0] ?? "";
      paragraphStart += paragraph.length + delimiter.length;
    }
    let top = 0;
    const lines: StyledTextLine[] = spans.map(({ start, end }) => {
      const segments = fragments(start, end, base);
      const metrics = (
        segments.length ? segments : [{ fontFamily: opts.fontFamily, fontSize: base }]
      ).map((segment) => {
        const font = fontTypography(segment.fontFamily);
        return {
          size: segment.fontSize,
          ascent: font.ascent * segment.fontSize,
          descent: font.descent * segment.fontSize,
        };
      });
      const ascent = Math.max(...metrics.map((m) => m.ascent));
      const descent = Math.max(...metrics.map((m) => m.descent));
      const advance = Math.max(ascent + descent, ...metrics.map((m) => m.size * lineFactor));
      const last = segments.at(-1);
      const line = {
        text: text.slice(start, end),
        segments,
        width: last ? last.x + last.width : 0,
        baseline: top + ascent,
        ascent,
        descent,
        advance,
      };
      top += advance;
      return line;
    });
    const last = lines.at(-1);
    const height = last ? last.baseline + last.descent : 0;
    return {
      lines,
      ok:
        height <= Math.max(1, boxHeight - 2 * padY) &&
        lines.every((l) => l.width <= available + 0.5),
    };
  };
  let base = target,
    result = fit(base);
  if (opts.fontSize === undefined) {
    while (!result.ok && base > opts.minFontSize) {
      base = Math.max(opts.minFontSize, base - 0.5);
      result = fit(base);
    }
  }
  return {
    layout: {
      lines: result.lines.map((l) => l.text),
      fontSize: base,
      lineHeight: base * lineFactor,
      overflow: !result.ok,
      lineInsets: result.lines.map(() => inset),
    },
    lines: result.lines,
  };
}
