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
  type FontWeight,
  LETTERING_STYLE_DEFAULTS,
  type LetteringOverlay,
  type TextAlign,
} from "@toony/schema";
import {
  type BalloonCommand,
  balloonOutline,
  balloonPathD,
  clamp,
  defaultBalloonRadius,
  speechTailGeometry,
  type TailGeometry,
} from "./geometry.js";
import { approximateMeasure } from "./measure.js";
import { bubbleKindStyle, kindHasBubble, kindSupportsTail } from "./style.js";
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
}

/** Base stroke width derived from render height when not supplied. */
function baseStroke(height: number): number {
  return Math.max(1, height * 0.004);
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
  // Resolve the curated font family (#56): the overlay's id, or the per-kind
  // default when absent/unknown, via the shared @toony/fonts registry. Both the
  // family id and its CSS stack are exposed so SVG sets `font-family` and export
  // selects the matching registered canvas family — one resolution, no drift.
  const family = resolveFontFamily(overlay.fontFamily, kind);
  const fontFamily: FontFamilyId = family.id;
  const fontStack = family.stack;
  const textAlign: TextAlign = overlay.textAlign ?? LETTERING_STYLE_DEFAULTS.textAlign;
  const lineHeightFactor = overlay.lineHeight ?? LETTERING_STYLE_DEFAULTS.lineHeight;
  const letterSpacing = overlay.letterSpacing ?? LETTERING_STYLE_DEFAULTS.letterSpacing;
  const zIndex = overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex;
  const textColor = overlay.textColor?.trim() ? overlay.textColor : style.text;
  // The approximate/canvas measurers distinguish only regular vs bold advance;
  // map intermediate weights to the nearer of 400/700 for measurement while the
  // exact weight is still exposed for the renderer to apply.
  const measureWeight: 400 | 700 = fontWeight >= 700 ? 700 : 400;

  // Body rect → pixel space, clamped to a sane positive size.
  const ow = Math.max(1, overlay.geometry.width * width);
  const oh = Math.max(1, overlay.geometry.height * height);
  const ox = overlay.geometry.x * width;
  const oy = overlay.geometry.y * height;

  // Corner radius: a stored override (clamped so arcs never overrun the body)
  // takes precedence; otherwise the per-kind default scale.
  const radius =
    overlay.cornerRadius !== undefined && Number.isFinite(overlay.cornerRadius)
      ? clamp(overlay.cornerRadius, 0, Math.min(ow, oh) / 2)
      : defaultBalloonRadius(ow, oh) * style.radiusScale;
  const hasBubble = kindHasBubble(kind);

  // Tail: schema `tail` is an image-space normalized point. Convert to pixel
  // space; only kinds that support a tail and have a non-null tail draw one.
  let tail: TailGeometry | null = null;
  if (hasBubble && kindSupportsTail(kind) && overlay.tail) {
    const tip = { x: overlay.tail.x * width, y: overlay.tail.y * height };
    tail = speechTailGeometry(ox, oy, ow, oh, tip, radius);
  }

  const outline = hasBubble ? balloonOutline(ox, oy, ow, oh, tail, radius) : [];
  const pathD = hasBubble ? balloonPathD(outline) : "";

  const { minFontSize, maxFontSize } = defaultBubbleFontRange(height);
  const text = layoutBubbleText(measure, overlay.text, ow, oh, {
    minFontSize,
    maxFontSize,
    // A stored numeric fontSize fixes the size; null/absent keeps auto-fit.
    fontSize: overlay.fontSize ?? undefined,
    fontWeight: measureWeight,
    lineHeightFactor,
    letterSpacing,
  });

  // Text origin: inside the box padding.
  const padX = Math.max(2, ow * 0.06);
  const padY = Math.max(2, oh * 0.08);
  const textOriginX = ox + padX;
  const textOriginY = oy + padY;
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

  return {
    id: overlay.id,
    kind,
    box: { x: ox, y: oy, width: ow, height: oh },
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
    fontWeight,
    fontFamily,
    fontStack,
    textAlign,
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
  return overlays
    .map((overlay, index) => ({ overlay, index }))
    .sort(
      (a, b) =>
        (a.overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex) -
          (b.overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex) || a.index - b.index,
    )
    .map(({ overlay }) => layoutBubble(overlay, width, height, opts));
}
