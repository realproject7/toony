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

import type { BubbleKind } from "@toony/schema";

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
}

const KIND_STYLE: Record<BubbleKind, BubbleKindStyle> = {
  speech: {
    fill: "rgba(255, 255, 255, 0.96)",
    stroke: "#1a1a1a",
    text: "#1a1a1a",
    strokeScale: 1,
    radiusScale: 1,
    fontWeight: 400,
  },
  thought: {
    fill: "rgba(255, 255, 255, 0.86)",
    stroke: "#6f675c",
    text: "#1f1a16",
    strokeScale: 0.75,
    radiusScale: 1.3,
    fontWeight: 400,
  },
  narration: {
    fill: "rgba(244, 239, 230, 0.95)",
    stroke: "#6d6256",
    text: "#2a1b14",
    strokeScale: 0.75,
    radiusScale: 0.32,
    fontWeight: 400,
  },
  shout: {
    fill: "#ffffff",
    stroke: "#111111",
    text: "#111111",
    strokeScale: 1.45,
    radiusScale: 0.55,
    fontWeight: 700,
  },
  whisper: {
    fill: "rgba(255, 255, 255, 0.78)",
    stroke: "#8a8177",
    text: "#3a332d",
    strokeScale: 0.55,
    radiusScale: 1.1,
    fontWeight: 400,
  },
  sfx: {
    fill: "transparent",
    stroke: "#ffffff",
    text: "#111111",
    strokeScale: 1,
    radiusScale: 0,
    fontWeight: 700,
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
