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
  narration: {
    fill: "rgba(244, 239, 230, 0.95)",
    stroke: "#6d6256",
    text: "#2a1b14",
    strokeScale: 0.75,
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
 * means NO balloon outline is drawn — sfx is bare outlined text, narration is a
 * borderless caption. Tone overrides the kind default: shout→scalloped (cloud),
 * aggressive→jagged (spiky); otherwise the per-kind default shape applies.
 */
export function outlineDecorationFor(
  kind: BubbleKind,
  tone: BubbleTone,
): OutlineDecoration | "none" {
  if (kind === "sfx" || kind === "narration") return "none";
  if (tone === "shout") return "scalloped";
  if (tone === "aggressive") return "jagged";
  if (kind === "shout") return "scalloped";
  if (kind === "thought") return "bumpy";
  return "rounded";
}
