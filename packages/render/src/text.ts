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

/**
 * Measure rendered width of `text` at `fontSize` px, optionally bold and in a
 * specific resolved font family. `fontFamily` is the render plan's resolved
 * family id (#56); a face-aware measurer (e.g. the canvas one in `@toony/export`)
 * keys its `ctx.font` off it so wrap/auto-fit match the glyphs actually drawn.
 * The deterministic DOM-free default measurer ignores it, so server-side layout
 * stays platform-independent.
 */
export type MeasureWidth = (
  text: string,
  fontSize: number,
  fontWeight?: 400 | 700,
  fontFamily?: string,
) => number;

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
  /**
   * Per-line horizontal inset in px, one entry per line, that the balloon's
   * corner arcs take out of the padded text column on EACH side (#210). Zero for
   * every line when `cornerRadius` is absent or 0. A consumer that anchors text
   * left or right must add it, so the line clears the drawn silhouette rather
   * than the body rectangle; the wrap already respects it.
   */
  lineInsets: number[];
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
  /** Resolved font family id, forwarded to a face-aware measurer (#56/#77). */
  fontFamily?: string;
  /** Letter spacing in em; widens each line by spacing*(glyphs-1)*font. Default 0. */
  letterSpacing?: number;
  /** Horizontal padding inside the box (each side). Default 6% of width. */
  paddingX?: number;
  /** Vertical padding inside the box (each side). Default 8% of height. */
  paddingY?: number;
  /**
   * Corner radius in px of the rounded silhouette the text is drawn inside
   * (#210). The wrap then keeps the padding clear of the ARC, not of the box
   * corner the arc cuts away. Default 0: a plain rectangle, byte-for-byte the
   * pre-#210 layout.
   */
  cornerRadius?: number;
}

/**
 * Greedy word-wrap where each line carries its OWN limit: `widthAt(i)` is the
 * width available to the line at index `i`. A rounded balloon is narrower at the
 * top and bottom than in the middle, so its first and last lines get less room
 * than its middle ones (#210).
 */
function wrapLines(
  measure: MeasureWidth,
  text: string,
  widthAt: (index: number) => number,
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
    if (!current || measure(candidate, fontSize, fontWeight) <= widthAt(lines.length)) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Greedy word-wrap of `text` to lines no wider than `maxWidth` at `fontSize`. */
export function wrapText(
  measure: MeasureWidth,
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight?: 400 | 700,
): string[] {
  return wrapLines(measure, text, () => maxWidth, fontSize, fontWeight);
}

/**
 * How far a corner arc of `radius` sits inside the body rect, on each side, at
 * `depth` px below the nearer horizontal edge. A rounded rect's edge runs from
 * the corner center outward, so at depth `d < r` the drawn silhouette is
 * `r - sqrt(d * (2r - d))` narrower than the rect; at `d >= r` the edge is
 * straight and the arc takes nothing.
 */
function cornerInset(depth: number, radius: number): number {
  if (!(radius > 0) || !(depth < radius)) return 0;
  const d = Math.max(0, depth);
  return radius - Math.sqrt(Math.max(0, d * (2 * radius - d)));
}

/**
 * How deep line `index` of a `count`-line block sits below the NEARER horizontal
 * edge of the body rect.
 *
 * Measuring from the nearer edge makes the result the same under every
 * `verticalAlign`: whichever end of the block is pushed against an edge, the
 * line closest to it is the one at that distance. So the wrap does not need to
 * know the vertical anchoring, and changing the anchoring never reflows text.
 * The depth is the line BOX edge, not the glyph extents, so the clearance holds
 * for any face's ascent and descent.
 */
function lineDepth(index: number, count: number, padY: number, lineHeight: number): number {
  const fromEnd = Math.max(0, count - 1 - index);
  return padY + Math.min(index, fromEnd) * lineHeight;
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
  const fontFamily = opts.fontFamily;
  const letterSpacing = opts.letterSpacing ?? 0;

  // Bind the resolved family so a face-aware measurer wraps with the real face
  // (#77); the default measurer ignores the extra arg. When no family is set
  // this is the raw measurer, so existing layouts are byte-for-byte unchanged.
  const measureFam: MeasureWidth =
    fontFamily === undefined ? measure : (t, fs, w) => measure(t, fs, w, fontFamily);

  // Fold letter spacing into measurement so wrapping/auto-fit account for it:
  // each glyph after the first adds `letterSpacing * fontSize` of advance. When
  // spacing is 0 this is identical to the raw measurer, so existing layouts are
  // byte-for-byte unchanged.
  const measureSpaced: MeasureWidth =
    letterSpacing === 0
      ? measureFam
      : (t, fs, w) => measureFam(t, fs, w) + letterSpacing * fs * Math.max(0, [...t].length - 1);

  const maxFont = Math.max(opts.minFontSize, opts.maxFontSize);
  const minFont = Math.max(1, Math.min(opts.minFontSize, maxFont));

  // The arcs only reach the text when the top padding lands inside one. Below
  // that the silhouette IS the rectangle for every row text can occupy, so the
  // whole shaped path is skipped and the layout is the pre-#210 one exactly.
  const radius = Math.max(0, opts.cornerRadius ?? 0);
  const shaped = cornerInset(padY, radius) > 0;

  const fit = (bodyFont: number): { lines: string[]; insets: number[]; ok: boolean } => {
    const lineHeight = bodyFont * lineHeightFactor;
    const widthFor = (index: number, count: number): number =>
      Math.max(1, availW - 2 * cornerInset(lineDepth(index, count, padY, lineHeight), radius));
    const wrapAt = (count: number): string[] =>
      wrapLines(measureSpaced, text, (i) => widthFor(i, count), bodyFont, fontWeight);

    // Wrap and silhouette are mutually dependent: a line's width depends on how
    // deep it sits, which depends on how many lines there are. Every line's
    // width only grows as the assumed count grows, so the wrap's own count only
    // falls. Walk the assumed count up while the wrap still yields at least that
    // many lines; the assumed count therefore never exceeds the real one, and no
    // line is ever wrapped wider than its true depth allows.
    let assumed = 1;
    let lines = shaped ? wrapAt(1) : wrapText(measureSpaced, text, availW, bodyFont, fontWeight);
    while (shaped && lines.length > assumed) {
      const next = assumed + 1;
      const candidate = wrapAt(next);
      if (candidate.length < next) break;
      assumed = next;
      lines = candidate;
    }

    // Report the insets for the count the wrap actually produced: that is where
    // the lines really sit, and it is never tighter than the width they were
    // wrapped to.
    const insets = lines.map((_, i) =>
      shaped ? cornerInset(lineDepth(i, lines.length, padY, lineHeight), radius) : 0,
    );
    const bodyH = lines.length * bodyFont * lineHeightFactor;
    const widthOk = lines.every(
      (l, i) => measureSpaced(l, bodyFont, fontWeight) <= availW - 2 * (insets[i] ?? 0) + 0.5,
    );
    return { lines, insets, ok: bodyH <= availH && widthOk };
  };

  if (typeof opts.fontSize === "number" && Number.isFinite(opts.fontSize) && opts.fontSize > 0) {
    const bodyFont = Math.max(1, opts.fontSize);
    const { lines, insets, ok } = fit(bodyFont);
    return {
      lines,
      fontSize: bodyFont,
      lineHeight: bodyFont * lineHeightFactor,
      overflow: !ok,
      lineInsets: insets,
    };
  }

  // Descend from max to min font (0.5px steps) and take the first that fits.
  for (let f = maxFont; f >= minFont; f -= 0.5) {
    const { lines, insets, ok } = fit(f);
    if (ok) {
      return {
        lines,
        fontSize: f,
        lineHeight: f * lineHeightFactor,
        overflow: false,
        lineInsets: insets,
      };
    }
  }

  // Nothing fits even at min — best effort: wrap at min font (may overflow).
  const { lines, insets } = fit(minFont);
  return {
    lines,
    fontSize: minFont,
    lineHeight: minFont * lineHeightFactor,
    overflow: true,
    lineInsets: insets,
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

/**
 * Map a resolved body weight (400–700) to the face weight actually used, per CSS
 * font-weight matching for the {400,700} set each family ships: 600–700 pick the
 * bold (700) face, 400–500 pick regular. The SINGLE source both the render
 * measurement weight and `@toony/export`'s canvas face selection (`cssFaceWeight`)
 * use, so the SVG preview and the export raster always land on the identical face
 * (#85/#154 — do not re-derive this threshold per consumer).
 */
export function matchFaceWeight(weight: number): 400 | 700 {
  return weight >= 600 ? 700 : 400;
}
