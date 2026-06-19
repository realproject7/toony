// The single source of truth for laying out a cut's lettering overlays.
//
// `layoutCut` turns a list of schema `LetteringOverlay`s + the cut's pixel
// dimensions into framework-agnostic `BubbleRender` plans: each carries the
// balloon outline command list, the SVG path string, the resolved tail triangle,
// the wrapped/auto-fit text lines with their positions, and the resolved colors.
// It returns PLAIN GEOMETRY DATA — never SVG or canvas nodes — so the studio SVG
// preview (#7), the focused editor (#8), and the headless canvas export (#10)
// all consume the identical layout and cannot drift.
//
// All input coordinates are normalized 0..1 relative to the cut image (the
// schema's space). `width`/`height` are the render pixel dimensions of the cut
// in the caller's space (display px for the preview, natural px for export). The
// tail point is image-space normalized; it is converted to pixel space here.

import { type FontFamilyId, resolveFontFamily } from "@toony/fonts";
import {
  type BubbleKind,
  type BubbleTone,
  type FontWeight,
  LETTERING_STYLE_DEFAULTS,
  type LetteringOverlay,
  type TextAlign,
  type VerticalAlign,
} from "@toony/schema";
import {
  type BalloonCommand,
  balloonPathD,
  buildBalloonOutline,
  clamp,
  defaultBalloonRadius,
  type ImpactDecoration,
  impactDecoration,
  speechTailGeometry,
  type TailGeometry,
} from "./geometry.js";
import { approximateMeasure } from "./measure.js";
import { bubbleKindStyle, kindHasBubble, kindSupportsTail, outlineDecorationFor } from "./style.js";
import {
  type BubbleTextLayout,
  defaultBubbleFontRange,
  layoutBubbleText,
  type MeasureWidth,
} from "./text.js";

/** A positioned line of wrapped body text, in the caller's pixel space. */
export interface RenderedTextLine {
  text: string;
  /** Baseline-independent top-left x of the centered line. */
  x: number;
  /** Top y of the line's box (line index * lineHeight from the text origin). */
  y: number;
  /** Center x of the bubble's text column (for center-anchored rendering). */
  centerX: number;
  /**
   * X to anchor this line at for the resolved `textAlign`: the text column's
   * left edge (left), center (center), or right edge (right). A renderer draws
   * the line at `anchorX` with the matching text-anchor. For center alignment
   * this equals `centerX`, so existing center-anchored consumers are unchanged.
   */
  anchorX: number;
}

/** A fully resolved render plan for one bubble, in the caller's pixel space. */
export interface BubbleRender {
  id: string;
  kind: BubbleKind;
  /** The bubble body rect in pixel space. */
  box: { x: number; y: number; width: number; height: number };
  /**
   * Placement rects (#98), all in the caller's pixel space: `frame` = the whole
   * cut canvas; `art` = the artwork region (== frame for `in_panel`, the non-strip
   * portion for `gutter`); `band` = the reserved gutter strip, or null for
   * `in_panel`. Studio SVG and export canvas consume these identically so a gutter
   * bubble lands in the same place in both.
   */
  frame: Rect;
  art: Rect;
  band: Rect | null;
  /** Whether this kind draws a filled/stroked body (false for SFX). */
  hasBubble: boolean;
  /** Balloon outline command list (canvas/SVG-agnostic). */
  outline: BalloonCommand[];
  /** SVG path `d` tracing the same outline. */
  pathD: string;
  /** Resolved tail triangle, or null when tailless / tip inside the box. */
  tail: TailGeometry | null;
  /** Resolved fill / stroke / text colors (stored style overrides defaults). */
  fill: string;
  stroke: string;
  textColor: string;
  /** Stroke width in pixels. */
  strokeWidth: number;
  /** Fill opacity 0..1. */
  fillOpacity: number;
  /**
   * Width in px to stroke bare (SFX) text so it reads on any background. Single
   * source for SVG + canvas so they match (#83); 0 when the bubble has a body.
   */
  textOutlineWidth: number;
  /**
   * Impact-band SFX decoration (#99): radial speed-lines + a burst star drawn
   * behind the lettering, as pure straight segments so the studio SVG and the
   * export canvas match. Non-null only for `kind=sfx` with `sfxMode=impact_band`.
   */
  impact: ImpactDecoration | null;
  /** Resolved corner radius in px (override clamped, else per-kind default). */
  cornerRadius: number;
  /** Resolved body font weight (override, else per-kind default). */
  fontWeight: FontWeight;
  /**
   * Resolved curated font-family id (#56): the overlay's `fontFamily`, or the
   * per-kind default when absent/unknown. Export maps this to the registered
   * canvas family so the raster uses the SAME face as the SVG preview.
   */
  fontFamily: FontFamilyId;
  /**
   * CSS `font-family` stack for the resolved family (quoted name + generic
   * fallback). SVG/HTML consumers set this directly so the preview/editor render
   * the selected face from the self-hosted woff2.
   */
  fontStack: string;
  /** Resolved horizontal text alignment. */
  textAlign: TextAlign;
  /**
   * Resolved vertical text anchoring (#115); absent → `"top"` (current behavior).
   * Already baked into each line's `y`, so any consumer drawing `lines` honors it
   * by construction — render, export, and studio stay in lockstep.
   */
  verticalAlign: VerticalAlign;
  /** Resolved letter spacing in em. */
  letterSpacing: number;
  /** Resolved stacking order; layoutCut returns plans in ascending z (then input order). */
  zIndex: number;
  /** Wrapped, auto-fit text layout. */
  text: BubbleTextLayout;
  /** Positioned body lines, ready to place. */
  lines: RenderedTextLine[];
  /** Text origin: top-left of the body text area. */
  textOrigin: { x: number; y: number };
  /** True when text overflows the box even at the minimum font. */
  overflow: boolean;
}

export interface LayoutOptions {
  /**
   * Width measurer. Defaults to a deterministic DOM-free approximation so the
   * core lays out identically on server and client; inject a real
   * `canvas.measureText`-backed measurer for pixel-accurate fit.
   */
  measure?: MeasureWidth;
  /** Base stroke width in px at this render height (default: 0.4% of height). */
  baseStrokeWidth?: number;
  /**
   * The CUT-LEVEL art rect (#99): the artwork region reserved from ALL of the
   * cut's overlays via {@link cutPlacementFrame}, not just this one. `layoutCut`
   * supplies it so a full-width `impact_band` SFX spans the shared art and never
   * bleeds into a sibling gutter bubble's reserved strip. Absent (a standalone
   * `layoutBubble` call) → this overlay's own art rect, which is the full frame
   * for an in-panel bubble (back-compat).
   */
  cutArt?: Rect;
}

/** Base stroke width derived from render height when not supplied. */
function baseStroke(height: number): number {
  return Math.max(1, height * 0.004);
}

/**
 * SFX bare text is stroked (outlined) so it reads on any background. The outline
 * width is a fraction of the resolved font size, exposed on the plan as the
 * SINGLE source so the SVG preview and the canvas export stroke it identically
 * (#83 — they previously diverged 2×). 0.12em matches the value the export
 * raster has shipped, so the exported artwork is unchanged.
 */
const SFX_TEXT_OUTLINE_FACTOR = 0.12;

/**
 * Width of the reserved gutter strip (#98) as a fraction of the cut canvas width.
 * A `gutter`-placed bubble lays out inside this in-bounds strip; the remaining
 * width is the art. The canvas dimensions never change, so studio and export
 * agree without any per-consumer adjustment.
 */
export const GUTTER_BAND_FRAC = 0.18;

/** An axis-aligned rect in the caller's pixel space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Cut-level placement frame (#98): from a cut's overlays, the reserved gutter
 * band(s) and the remaining ART rect. A consumer draws the artwork into `art`
 * and leaves each band as a reserved reading margin where gutter bubbles sit, so
 * the strip is ACTUALLY reserved (not drawn over). With no gutter overlays the
 * art is the whole frame (back-compat: full-bleed artwork). Single source so the
 * studio preview and the canvas export reserve the SAME strip → parity.
 */
export function cutPlacementFrame(
  overlays: readonly LetteringOverlay[],
  width: number,
  height: number,
): { art: Rect; bands: Rect[] } {
  const bandW = width * GUTTER_BAND_FRAC;
  let left = 0;
  let right = 0;
  for (const overlay of overlays) {
    if (overlay.placement === "gutter") {
      if ((overlay.placementSide ?? "right") === "left") left = bandW;
      else right = bandW;
    }
  }
  const bands: Rect[] = [];
  if (left > 0) bands.push({ x: 0, y: 0, width: left, height });
  if (right > 0) bands.push({ x: width - right, y: 0, width: right, height });
  return {
    art: { x: left, y: 0, width: Math.max(1, width - left - right), height },
    bands,
  };
}

/**
 * Lay out a single overlay into a `BubbleRender`. Pure: same inputs → same plan.
 */
export function layoutBubble(
  overlay: LetteringOverlay,
  width: number,
  height: number,
  opts: LayoutOptions = {},
): BubbleRender {
  const measure = opts.measure ?? approximateMeasure;
  const kind = overlay.kind;
  const style = bubbleKindStyle(kind);

  // Resolve the additive style fields (#54). An absent field falls back to the
  // current behavior — per-kind weight/color/corner-radius, auto-fit size — so
  // overlays written before these fields existed render identically.
  const fontWeight: FontWeight = overlay.fontWeight ?? style.fontWeight;
  // SFX render mode (#99): only meaningful for kind=sfx; absent → typeset.
  // `hand_lettered` swaps to a loose hand face WITHOUT mutating the stored text,
  // but an explicit `fontFamily` still wins; `impact_band` adds the full-width
  // radial-burst decoration below. typeset keeps the current behavior.
  const sfxMode = kind === "sfx" ? (overlay.sfxMode ?? "typeset") : "typeset";
  const effectiveFamilyId =
    sfxMode === "hand_lettered" && overlay.fontFamily === undefined
      ? "patrick-hand"
      : overlay.fontFamily;
  // Resolve the curated font family (#56): the overlay's id, or the per-kind
  // default when absent/unknown, via the shared @toony/fonts registry. Both the
  // family id and its CSS stack are exposed so SVG sets `font-family` and export
  // selects the matching registered canvas family — one resolution, no drift.
  const family = resolveFontFamily(effectiveFamilyId, kind);
  const fontFamily: FontFamilyId = family.id;
  const fontStack = family.stack;
  const textAlign: TextAlign = overlay.textAlign ?? LETTERING_STYLE_DEFAULTS.textAlign;
  const lineHeightFactor = overlay.lineHeight ?? LETTERING_STYLE_DEFAULTS.lineHeight;
  const letterSpacing = overlay.letterSpacing ?? LETTERING_STYLE_DEFAULTS.letterSpacing;
  const zIndex = overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex;
  const textColor = overlay.textColor?.trim() ? overlay.textColor : style.text;
  // Only two faces ship per family (400, 700). Map the resolved weight to the
  // face that will actually be used, following CSS font-weight matching for a
  // {400,700} set: 600-700 → the bold (700) face, 400-500 → regular. The same
  // threshold is applied in @toony/export's canvas face selection so the raster
  // and the SVG land on the identical face (#85). Measurement uses it too so
  // wrap/auto-fit reflect the weight actually drawn.
  const measureWeight: 400 | 700 = fontWeight >= 600 ? 700 : 400;

  // Placement (#98): `in_panel` uses the whole cut canvas (back-compat); `gutter`
  // reserves an in-bounds strip of `GUTTER_BAND_FRAC` width on `placementSide`.
  // The bubble geometry maps WITHIN the placement rect (the strip for gutter); its
  // tailTarget is normalized in the remaining ART rect and clamped to the art edge.
  // Canvas dimensions never change → studio SVG and export canvas use the same
  // rects (the plan exposes frame/art/band) and stay pixel-consistent.
  const placement = overlay.placement ?? "in_panel";
  const placementSide = overlay.placementSide ?? "right";
  const frame: Rect = { x: 0, y: 0, width, height };
  let band: Rect | null = null;
  let art: Rect = frame;
  if (placement === "gutter") {
    const bandW = width * GUTTER_BAND_FRAC;
    band =
      placementSide === "left"
        ? { x: 0, y: 0, width: bandW, height }
        : { x: width - bandW, y: 0, width: bandW, height };
    art =
      placementSide === "left"
        ? { x: bandW, y: 0, width: width - bandW, height }
        : { x: 0, y: 0, width: width - bandW, height };
  }
  const geomRect = band ?? frame;

  // Body rect → pixel space within the placement rect, clamped to positive size.
  let ow = Math.max(1, overlay.geometry.width * geomRect.width);
  const oh = Math.max(1, overlay.geometry.height * geomRect.height);
  let ox = geomRect.x + overlay.geometry.x * geomRect.width;
  const oy = geomRect.y + overlay.geometry.y * geomRect.height;
  // impact_band SFX (#99) is a FULL-WIDTH band over the art: the box spans the
  // whole art width (the authored y/height set its vertical placement), so the
  // burst + speed-lines fill the panel. The art it spans is the CUT-LEVEL art
  // rect (reserved from every overlay), so a sibling gutter bubble's strip stays
  // clear; absent (standalone call) it falls back to this overlay's art. Other
  // modes keep the authored box.
  const isImpact = sfxMode === "impact_band";
  const impactArt = opts.cutArt ?? art;
  if (isImpact) {
    ox = impactArt.x;
    ow = impactArt.width;
  }

  // Corner radius: a stored override (clamped so arcs never overrun the body)
  // takes precedence; otherwise the per-kind default scale.
  const radius =
    overlay.cornerRadius !== undefined && Number.isFinite(overlay.cornerRadius)
      ? clamp(overlay.cornerRadius, 0, Math.min(ow, oh) / 2)
      : defaultBalloonRadius(ow, oh) * style.radiusScale;
  const hasBubble = kindHasBubble(kind);
  // Outline silhouette (#93): tone refines the shape (shout→scalloped,
  // aggressive→jagged); narration/sfx draw no balloon ("none").
  const tone: BubbleTone = overlay.tone ?? "neutral";
  const decoration = outlineDecorationFor(kind, tone);

  // Tail: prefer the off-panel `tailTarget` (#93) over `tail`; both are cut-image
  // normalized points. `tailTarget` MAY be off-panel, so the pixel tip is clamped
  // to the art edge before the tail geometry is built. Only tail-supporting kinds
  // with a target draw one.
  const tailPoint = overlay.tailTarget ?? overlay.tail;
  let tail: TailGeometry | null = null;
  if (hasBubble && kindSupportsTail(kind) && tailPoint) {
    // tailTarget is normalized in ART space (the whole cut for in_panel); clamp
    // the drawn tip to the art edge so a gutter bubble's tail crosses into the art.
    const tip = {
      x: clamp(art.x + tailPoint.x * art.width, art.x, art.x + art.width),
      y: clamp(art.y + tailPoint.y * art.height, art.y, art.y + art.height),
    };
    tail = speechTailGeometry(ox, oy, ow, oh, tip, radius);
  }

  // narration is a borderless caption and sfx is bare text — both skip the
  // balloon. The rest build the (possibly decorated) outline; a decorated span is
  // pure line segments so the SVG path and canvas trace stay identical (#88).
  const drawsOutline = hasBubble && decoration !== "none";
  const outline = drawsOutline ? buildBalloonOutline(ox, oy, ow, oh, tail, radius, decoration) : [];
  const pathD = drawsOutline ? balloonPathD(outline) : "";

  const { minFontSize, maxFontSize } = defaultBubbleFontRange(height);
  // #93: a beat bubble with no authored text renders an ellipsis pause; per-kind
  // `fontScale` shrinks the auto-fit range (ambient reads smaller/denser).
  const renderText = kind === "beat" && overlay.text.trim().length === 0 ? "..." : overlay.text;
  const text = layoutBubbleText(measure, renderText, ow, oh, {
    minFontSize: minFontSize * style.fontScale,
    maxFontSize: maxFontSize * style.fontScale,
    // A stored numeric fontSize fixes the size; null/absent keeps auto-fit.
    fontSize: overlay.fontSize ?? undefined,
    fontWeight: measureWeight,
    // The resolved family id (#56), so a face-aware measurer (export) wraps with
    // the same face it draws (#77). The default measurer ignores it.
    fontFamily,
    lineHeightFactor,
    letterSpacing,
  });

  // Text origin: inside the box padding.
  const padX = Math.max(2, ow * 0.06);
  const padY = Math.max(2, oh * 0.08);
  const textOriginX = ox + padX;
  // Vertical anchoring (#115): `top` (default) keeps the text at the top padding
  // (byte-identical to before); `middle`/`bottom` offset the whole block within
  // the box's inner height. Baked into line.y so every consumer honors it.
  const verticalAlign: VerticalAlign = overlay.verticalAlign ?? "top";
  const innerHeight = Math.max(0, oh - 2 * padY);
  const blockHeight = text.lines.length * text.lineHeight;
  const vOffset =
    verticalAlign === "middle"
      ? Math.max(0, (innerHeight - blockHeight) / 2)
      : verticalAlign === "bottom"
        ? Math.max(0, innerHeight - blockHeight)
        : 0;
  const textOriginY = oy + padY + vOffset;
  const centerX = ox + ow / 2;
  const rightX = ox + ow - padX;
  const anchorX = textAlign === "left" ? textOriginX : textAlign === "right" ? rightX : centerX;

  const lines: RenderedTextLine[] = text.lines.map((line, i) => ({
    text: line,
    x: textOriginX,
    y: textOriginY + i * text.lineHeight,
    centerX,
    anchorX,
  }));

  // Stored style overrides per-kind defaults. A stored border width is authored
  // in px; otherwise fall back to a height-relative base scaled per kind so the
  // stroke reads consistently at preview and export scale.
  const fill = overlay.fill?.trim() ? overlay.fill : style.fill;
  const stroke = overlay.border?.color ?? style.stroke;
  const fallbackStroke = (opts.baseStrokeWidth ?? baseStroke(height)) * style.strokeScale;
  const strokeWidth =
    overlay.border && Number.isFinite(overlay.border.width) && overlay.border.width >= 0
      ? overlay.border.width
      : fallbackStroke;
  const fillOpacity = clamp(Number.isFinite(overlay.opacity) ? overlay.opacity : 1, 0, 1);

  // SFX (no bubble body) draws stroked-then-filled bare text; the outline width
  // is resolved here so every consumer strokes it the same. 0 when there is a
  // bubble body (no bare-text outline).
  const textOutlineWidth = hasBubble ? 0 : Math.max(1, text.fontSize * SFX_TEXT_OUTLINE_FACTOR);

  // impact_band (#99): the radial speed-lines + burst behind the text, as pure
  // straight segments (parity). Built from the resolved full-width box.
  const impact = isImpact ? impactDecoration({ x: ox, y: oy, width: ow, height: oh }) : null;

  return {
    id: overlay.id,
    kind,
    box: { x: ox, y: oy, width: ow, height: oh },
    frame,
    art,
    band,
    hasBubble,
    outline,
    pathD,
    tail,
    fill,
    stroke,
    textColor,
    strokeWidth,
    fillOpacity,
    cornerRadius: radius,
    textOutlineWidth,
    impact,
    fontWeight,
    fontFamily,
    fontStack,
    textAlign,
    verticalAlign,
    letterSpacing,
    zIndex,
    text,
    lines,
    textOrigin: { x: textOriginX, y: textOriginY },
    overflow: text.overflow,
  };
}

/**
 * Lay out all overlays for one cut at the given render size. Plans are returned
 * in ASCENDING `zIndex`, ties broken by input order (a stable sort), so a
 * consumer that draws them in array order paints higher-z overlays on top.
 * Overlays without a `zIndex` default to 0, so legacy projects keep their
 * input/reading order exactly. Returns one `BubbleRender` per overlay.
 */
export function layoutCut(
  overlays: LetteringOverlay[],
  width: number,
  height: number,
  opts: LayoutOptions = {},
): BubbleRender[] {
  // Reserve the cut-level art rect from ALL overlays once (#98/#99) and pass it
  // down, so a full-width impact_band SFX spans the shared art and never enters a
  // sibling gutter bubble's reserved strip. An explicit opts.cutArt wins.
  const cutArt = opts.cutArt ?? cutPlacementFrame(overlays, width, height).art;
  return overlays
    .map((overlay, index) => ({ overlay, index }))
    .sort(
      (a, b) =>
        (a.overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex) -
          (b.overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex) || a.index - b.index,
    )
    .map(({ overlay }) => layoutBubble(overlay, width, height, { ...opts, cutArt }));
}
