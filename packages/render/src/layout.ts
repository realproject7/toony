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

import type { BubbleKind, LetteringOverlay } from "@toony/schema";
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
}

/** A fully resolved render plan for one bubble, in the caller's pixel space. */
export interface BubbleRender {
  id: string;
  kind: BubbleKind;
  speaker: string;
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
  speakerColor: string;
  /** Stroke width in pixels. */
  strokeWidth: number;
  /** Fill opacity 0..1. */
  fillOpacity: number;
  /** Wrapped, auto-fit text layout. */
  text: BubbleTextLayout;
  /** Positioned body lines (center-anchored), ready to place. */
  lines: RenderedTextLine[];
  /** Text origin: top-left of the body text area (below the speaker strip). */
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

  // Body rect → pixel space, clamped to a sane positive size.
  const ow = Math.max(1, overlay.geometry.width * width);
  const oh = Math.max(1, overlay.geometry.height * height);
  const ox = overlay.geometry.x * width;
  const oy = overlay.geometry.y * height;

  const radius = defaultBalloonRadius(ow, oh) * style.radiusScale;
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
  const hasSpeaker = hasBubble && overlay.speaker.trim().length > 0;
  const text = layoutBubbleText(measure, overlay.text, ow, oh, {
    minFontSize,
    maxFontSize,
    hasSpeaker,
    fontWeight: style.fontWeight,
  });

  // Text origin: inside the box padding, below the speaker strip if present.
  const padX = Math.max(2, ow * 0.06);
  const padY = Math.max(2, oh * 0.08);
  const speakerStrip = hasSpeaker ? text.speakerFontSize * (text.lineHeight / text.fontSize) : 0;
  const textOriginX = ox + padX;
  const textOriginY = oy + padY + speakerStrip;
  const centerX = ox + ow / 2;

  const lines: RenderedTextLine[] = text.lines.map((line, i) => ({
    text: line,
    x: textOriginX,
    y: textOriginY + i * text.lineHeight,
    centerX,
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
    speaker: overlay.speaker,
    box: { x: ox, y: oy, width: ow, height: oh },
    hasBubble,
    outline,
    pathD,
    tail,
    fill,
    stroke,
    textColor: style.text,
    speakerColor: style.speaker,
    strokeWidth,
    fillOpacity,
    text,
    lines,
    textOrigin: { x: textOriginX, y: textOriginY },
    overflow: text.overflow,
  };
}

/**
 * Lay out all overlays for one cut at the given render size. Overlays are laid
 * out in input order (reading order is preserved by the caller). Returns one
 * `BubbleRender` per overlay.
 */
export function layoutCut(
  overlays: LetteringOverlay[],
  width: number,
  height: number,
  opts: LayoutOptions = {},
): BubbleRender[] {
  return overlays.map((overlay) => layoutBubble(overlay, width, height, opts));
}
