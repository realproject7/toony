// Per-bubble-kind render-style defaults for Toony's bubble taxonomy.
//
// ADAPTED from plotlink-ows `overlays.ts` (`overlayRenderStyle`,
// `overlayHasBubble`, `overlaySupportsTail`): the MECHANISM of a per-kind style
// table + has-bubble / supports-tail predicates is reused, but the table is
// rebuilt for Toony's six MVP `BubbleKind`s (speech, thought, narration, shout,
// whisper, sfx). Per the reuse analysis, Toony leans on STORED per-overlay style
// (`fill`, `opacity`, `border`) which OVERRIDES these defaults; this table only
// supplies the per-kind defaults a stored style does not specify (text color,
// stroke, stroke weight, corner-radius scale).

import type { BubbleKind, BubbleTone } from "@toony/schema";
import {
  BLACK,
  compositeOver,
  contrastRatio,
  parseCssColor,
  type Rgb,
  type Rgba,
  toHex,
} from "./contrast.js";
import type { OutlineDecoration } from "./geometry.js";

export interface BubbleKindStyle {
  /** Default bubble fill (CSS color) when the overlay does not set one. */
  fill: string;
  /** Bubble stroke / border color (CSS color). */
  stroke: string;
  /** Body text color (CSS color). */
  text: string;
  /** Stroke width multiplier relative to the base stroke. */
  strokeScale: number;
  /** Corner-radius multiplier relative to defaultBalloonRadius. */
  radiusScale: number;
  /** Body weight default for this kind. */
  fontWeight: 400 | 700;
  /** Body font-size multiplier for this kind (#93: ambient reads smaller). Default 1. */
  fontScale: number;
}

const KIND_STYLE: Record<BubbleKind, BubbleKindStyle> = {
  speech: {
    fill: "rgba(255, 255, 255, 0.96)",
    stroke: "#1a1a1a",
    text: "#1a1a1a",
    strokeScale: 1,
    radiusScale: 1,
    fontWeight: 400,
    fontScale: 1,
  },
  thought: {
    fill: "rgba(255, 255, 255, 0.86)",
    stroke: "#6f675c",
    text: "#1f1a16",
    strokeScale: 0.75,
    radiusScale: 1.3,
    fontWeight: 400,
    fontScale: 1,
  },
  // A caption, not a balloon: it carries a backing PLATE (see
  // `resolveCaptionPlate`) but no border of its own — `strokeScale: 0` keeps it
  // borderless unless the overlay authors an explicit `border` (#186).
  narration: {
    fill: "rgba(244, 239, 230, 0.95)",
    stroke: "#6d6256",
    text: "#2a1b14",
    strokeScale: 0,
    radiusScale: 0.32,
    fontWeight: 400,
    fontScale: 1,
  },
  shout: {
    fill: "#ffffff",
    stroke: "#111111",
    text: "#111111",
    strokeScale: 1.45,
    radiusScale: 0.55,
    fontWeight: 700,
    fontScale: 1,
  },
  whisper: {
    fill: "rgba(255, 255, 255, 0.78)",
    stroke: "#8a8177",
    text: "#3a332d",
    strokeScale: 0.55,
    radiusScale: 1.1,
    fontWeight: 400,
    fontScale: 1,
  },
  sfx: {
    fill: "transparent",
    stroke: "#ffffff",
    text: "#111111",
    strokeScale: 1,
    radiusScale: 0,
    fontWeight: 700,
    fontScale: 1,
  },
  // #93: a silence-pause bubble — small, very rounded, minimal (renders "…").
  beat: {
    fill: "rgba(255, 255, 255, 0.9)",
    stroke: "#3a332d",
    text: "#3a332d",
    strokeScale: 0.6,
    radiusScale: 1.6,
    fontWeight: 400,
    fontScale: 1,
  },
  // #93: low-emphasis "background noise" — faint, rounded, smaller/denser text.
  ambient: {
    fill: "rgba(255, 255, 255, 0.62)",
    stroke: "#9a938a",
    text: "#5a534b",
    strokeScale: 0.45,
    radiusScale: 1.2,
    fontWeight: 400,
    fontScale: 0.72,
  },
};

/** The default render style for a bubble kind. */
export function bubbleKindStyle(kind: BubbleKind): BubbleKindStyle {
  // `kind` is an exhaustive enum key, so the lookup is always present.
  return KIND_STYLE[kind] ?? KIND_STYLE.speech;
}

/** Whether a kind draws a filled/stroked bubble body (SFX is bare text). */
export function kindHasBubble(kind: BubbleKind): boolean {
  return kind !== "sfx";
}

/** Whether a kind renders a speech tail when a tail point is present. */
export function kindSupportsTail(kind: BubbleKind): boolean {
  return kind === "speech" || kind === "shout" || kind === "whisper";
}

/**
 * Resolve the outline silhouette (#93) from a bubble's kind + tone. `"none"`
 * means NO shape is drawn at all — that is sfx, which is bare outlined text.
 * Narration is a borderless CAPTION: a plain rounded plate, never a balloon and
 * never tone-shaped, so it is resolved before the tone rules. Tone otherwise
 * overrides the kind default: shout→scalloped (cloud), aggressive→jagged
 * (spiky); otherwise the per-kind default shape applies.
 */
export function outlineDecorationFor(
  kind: BubbleKind,
  tone: BubbleTone,
): OutlineDecoration | "none" {
  if (kind === "sfx") return "none";
  // The caption plate is a quiet rectangle whatever the tone (#186); it is
  // borderless by `strokeScale: 0`, so "rounded" shapes a fill, not a balloon.
  if (kind === "narration") return "rounded";
  if (tone === "shout") return "scalloped";
  if (tone === "aggressive") return "jagged";
  if (kind === "shout") return "scalloped";
  if (kind === "thought") return "bumpy";
  return "rounded";
}

/**
 * WCAG 2.x AA contrast floor for body text. A caption that clears this over the
 * darkest possible artwork clears it over ANY artwork.
 */
export const CAPTION_MIN_CONTRAST = 4.5;

/** A resolved backing plate for a borderless caption (#186). */
export interface CaptionPlate {
  /**
   * The plate color as an OPAQUE CSS color, so the whole plate alpha lives in
   * `alpha` and a consumer's compositing is exactly `alpha × color + (1-alpha) ×
   * artwork` — the model `resolveCaptionPlate` proved the contrast floor against.
   */
  color: string;
  /** Plate alpha 0..1; a consumer applies it as the fill opacity. 0 draws nothing. */
  alpha: number;
}

/**
 * Alpha headroom over the knife edge, in 1/64ths. A raster quantizes the
 * composited plate to 8-bit channels, so an alpha sitting exactly ON the floor
 * can round back under it in the exported pixels. One 64th of alpha moves a
 * light plate by ~4/255 per channel — invisible, and comfortably clear of that
 * rounding — so the resolved alpha is rounded UP to the next 64th.
 */
const PLATE_ALPHA_STEP = 64;

/**
 * The smallest alpha in (0, 1] at which `plate` composited over pure BLACK still
 * clears {@link CAPTION_MIN_CONTRAST} against `ink`, or null when even a fully
 * opaque plate cannot (the author paired an ink and a plate that are too close).
 *
 * Black is the worst case: compositing a light plate over a darker background
 * yields a darker plate, so a plate that clears the floor over black clears it
 * over every background. Composite luminance rises monotonically with alpha, so
 * the passing set is an interval ending at 1 and a bisection finds its start.
 */
function minPlateAlpha(plate: Rgb, ink: Rgb): number | null {
  const clears = (a: number): boolean =>
    contrastRatio(compositeOver({ ...plate, a }, BLACK), ink) >= CAPTION_MIN_CONTRAST;
  if (!clears(1)) return null;
  let lo = 0;
  let hi = 1;
  // 24 halvings resolve alpha to ~6e-8 — far finer than an 8-bit channel — and
  // `hi` is only ever assigned a value that already clears the floor.
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) hi = mid;
    else lo = mid;
  }
  return Math.min(1, Math.ceil(hi * PLATE_ALPHA_STEP) / PLATE_ALPHA_STEP);
}

/**
 * The SINGLE resolution of a borderless caption's backing plate (#186).
 *
 * Narration paints fixed dark ink and, before this, painted it straight onto the
 * artwork. `layoutCut` gets no pixel data, so the renderer cannot sample what is
 * under the caption; what it CAN do is put a surface of its own under the ink and
 * prove that surface works over the darkest artwork possible. Returns null for
 * every other kind (they carry a balloon body already).
 *
 * Resolution order:
 *  - the plate color is the overlay's authored `fill` (both shipped examples
 *    author one) or, absent that, the per-kind caption color;
 *  - its alpha is the authored fill's own alpha × the overlay's `opacity`, raised
 *    to the minimum that keeps `ink` at the AA floor over black;
 *  - an alpha of exactly 0 is an explicit "no plate" and is honored — the
 *    pre-#186 fully borderless caption stays reachable with no schema change;
 *  - the floor is computed against the RESOLVED ink, so an authored `textColor`
 *    gets the same guarantee as the per-kind one.
 *
 * Two cases fall back to exactly what the author wrote. A color the core cannot
 * measure (a named color, a paint server) cannot be reasoned about at all; and a
 * plate/ink pair that no alpha can separate — an author who picked a dark plate
 * AND dark ink — cannot be fixed by opacity, and repainting a color the author
 * chose is not the renderer's call. Both are the same policy every other kind
 * already follows: pick both colors and you own the pairing.
 *
 * Both the studio SVG and the export canvas consume the result through the
 * render plan's `fill`/`fillOpacity`, so neither re-derives it (#112/#135/#147).
 */
export function resolveCaptionPlate(
  kind: BubbleKind,
  opts: { fill?: string; opacity?: number; ink: string },
): CaptionPlate | null {
  if (kind !== "narration") return null;
  const authored = opts.fill?.trim() ? opts.fill : KIND_STYLE.narration.fill;
  const opacity = Number.isFinite(opts.opacity) ? Math.max(0, Math.min(1, opts.opacity ?? 1)) : 1;
  const plate: Rgba | null = parseCssColor(authored);
  const ink = parseCssColor(opts.ink);
  if (!plate || !ink) return { color: authored, alpha: opacity };
  const alpha = plate.a * opacity;
  if (alpha <= 0) return { color: toHex(plate), alpha: 0 };
  const floor = minPlateAlpha(plate, ink);
  return { color: toHex(plate), alpha: floor === null ? alpha : Math.max(alpha, floor) };
}
