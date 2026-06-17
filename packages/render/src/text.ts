// Deterministic word-wrap + auto-fit font sizing for bubble text.
//
// ADOPTED from plotlink-ows `app/lib/bubble-text.ts` (`layoutBubbleText`,
// `wrapText`, `defaultBubbleFontRange`): a greedy word wrap with a max→min
// font-size descent that returns the largest font at which the wrapped lines fit
// the box, plus an `overflow` flag. The wrap is deterministic GIVEN an injected
// `measure` function — the key to WYSIWYG: the same layout call is used for the
// SVG preview (#7), the focused editor (#8), and the canvas export (#10), so all
// three wrap identically.
//
// Adapted for Toony: font sizing keys off the render HEIGHT (so preview display
// px and export natural px scale together); a deterministic default measurer is
// provided (see ./measure) so the core needs no DOM/canvas to lay out text
// server-side, while a real `canvas.measureText` measurer can still be injected.

/** Measure rendered width of `text` at `fontSize` px, optionally bold. */
export type MeasureWidth = (text: string, fontSize: number, fontWeight?: 400 | 700) => number;

export interface BubbleTextLayout {
  /** Wrapped lines of body text (never empty; [""] for empty text). */
  lines: string[];
  /** Chosen body font size in the caller's pixel space. */
  fontSize: number;
  /** Line advance (fontSize * lineHeightFactor). */
  lineHeight: number;
  /**
   * True when the text did not fit even at the minimum font (the lines are a
   * best-effort wrap that may clip the box). Mirrors the schema overlay's
   * `overflow` field and drives the editor's overflow warning (#8) and lint
   * (#11).
   */
  overflow: boolean;
}

export interface BubbleTextOptions {
  /** Largest body font to try, in the caller's pixel space. */
  maxFontSize: number;
  /** Smallest body font (used even if text still overflows). */
  minFontSize: number;
  /** Fixed body font size; when present, skip auto-fit and use this size. */
  fontSize?: number;
  /** Line advance as a multiple of font size. Default 1.2. */
  lineHeightFactor?: number;
  /** Body text weight, for consistent bold/regular measurement. */
  fontWeight?: 400 | 700;
  /** Letter spacing in em; widens each line by spacing*(glyphs-1)*font. Default 0. */
  letterSpacing?: number;
  /** Horizontal padding inside the box (each side). Default 6% of width. */
  paddingX?: number;
  /** Vertical padding inside the box (each side). Default 8% of height. */
  paddingY?: number;
}

/** Greedy word-wrap of `text` to lines no wider than `maxWidth` at `fontSize`. */
export function wrapText(
  measure: MeasureWidth,
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight?: 400 | 700,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    // Keep a word on the current line if it fits, or if the line is empty (a
    // single over-long word still occupies its own line — the fit loop shrinks
    // the font until it fits the box).
    if (!current || measure(candidate, fontSize, fontWeight) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Lay out bubble text: pick the largest font (between min and max) at which the
 * word-wrapped lines fit the box width AND total height. Deterministic given the
 * same `measure`, so preview and export produce identical wrapping/sizing.
 */
export function layoutBubbleText(
  measure: MeasureWidth,
  text: string,
  boxWidth: number,
  boxHeight: number,
  opts: BubbleTextOptions,
): BubbleTextLayout {
  const lineHeightFactor = opts.lineHeightFactor ?? 1.2;
  const padX = opts.paddingX ?? Math.max(2, boxWidth * 0.06);
  const padY = opts.paddingY ?? Math.max(2, boxHeight * 0.08);
  const availW = Math.max(1, boxWidth - 2 * padX);
  const availH = Math.max(1, boxHeight - 2 * padY);
  const fontWeight = opts.fontWeight ?? 400;
  const letterSpacing = opts.letterSpacing ?? 0;

  // Fold letter spacing into measurement so wrapping/auto-fit account for it:
  // each glyph after the first adds `letterSpacing * fontSize` of advance. When
  // spacing is 0 this is identical to the raw measurer, so existing layouts are
  // byte-for-byte unchanged.
  const measureSpaced: MeasureWidth =
    letterSpacing === 0
      ? measure
      : (text, fontSize, weight) =>
          measure(text, fontSize, weight) +
          letterSpacing * fontSize * Math.max(0, [...text].length - 1);

  const maxFont = Math.max(opts.minFontSize, opts.maxFontSize);
  const minFont = Math.max(1, Math.min(opts.minFontSize, maxFont));

  const fit = (bodyFont: number): { lines: string[]; ok: boolean } => {
    const lines = wrapText(measureSpaced, text, availW, bodyFont, fontWeight);
    const bodyH = lines.length * bodyFont * lineHeightFactor;
    const widthOk = lines.every((l) => measureSpaced(l, bodyFont, fontWeight) <= availW + 0.5);
    return { lines, ok: bodyH <= availH && widthOk };
  };

  if (typeof opts.fontSize === "number" && Number.isFinite(opts.fontSize) && opts.fontSize > 0) {
    const bodyFont = Math.max(1, opts.fontSize);
    const { lines, ok } = fit(bodyFont);
    return {
      lines,
      fontSize: bodyFont,
      lineHeight: bodyFont * lineHeightFactor,
      overflow: !ok,
    };
  }

  // Descend from max to min font (0.5px steps) and take the first that fits.
  for (let f = maxFont; f >= minFont; f -= 0.5) {
    const { lines, ok } = fit(f);
    if (ok) {
      return {
        lines,
        fontSize: f,
        lineHeight: f * lineHeightFactor,
        overflow: false,
      };
    }
  }

  // Nothing fits even at min — best effort: wrap at min font (may overflow).
  const lines = wrapText(measureSpaced, text, availW, minFont, fontWeight);
  return {
    lines,
    fontSize: minFont,
    lineHeight: minFont * lineHeightFactor,
    overflow: true,
  };
}

/**
 * Default body min/max font sizes for a bubble, as fractions of the rendering
 * HEIGHT so export (natural image size) and preview (displayed size) scale
 * together — identical wrapping at both scales.
 */
export function defaultBubbleFontRange(renderHeight: number): {
  minFontSize: number;
  maxFontSize: number;
} {
  return {
    minFontSize: Math.max(1, renderHeight * 0.022),
    maxFontSize: Math.max(1, renderHeight * 0.05),
  };
}
