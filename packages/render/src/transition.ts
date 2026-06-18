// Transition rendering plan — the vertical rhythm between cuts.
//
// Build-fresh per the reuse analysis (plotlink-ows has no transition concept).
// `layoutTransition` resolves a schema `Transition` into a framework-agnostic
// plan the studio preview (#7) renders as a styled gutter band, conveying the
// reading rhythm between cuts. It is read-only here; rich transition EDITING is
// issue #9. Pure and deterministic so the editor (#9) and stitched export (#10)
// can reuse the same band geometry/treatment.

import {
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  type Transition,
  type TransitionType,
} from "@toony/schema";
import { clamp } from "./geometry.js";

/**
 * Visual treatment of a transition band, derived from its type. `band` (#99) is
 * a solid full-width color band (the craft scene-break kinds).
 */
export type TransitionTreatment = "gutter" | "fade" | "card" | "break" | "band";

export interface TransitionRender {
  id: string;
  type: TransitionType;
  /** Clamped gutter height in px — the concrete vertical rhythm. */
  gutterHeight: number;
  /** How the band is drawn. */
  treatment: TransitionTreatment;
  /** Human-readable type label (e.g. "scene break"). */
  label: string;
  /** Primary text to show in the band (text → sfx → notes), or null. */
  detail: string | null;
  /** True when this transition carries SFX text (drives SFX styling). */
  isSfx: boolean;
  /** True when the band should read as a solid card rather than empty space. */
  isCard: boolean;
  /** Band fill color override (#98), or null to use the treatment's default. */
  color: string | null;
  /**
   * Resolved solid-band background fill (#99) for the v3 craft kinds, or null for
   * the legacy kinds (which keep their per-treatment default rendering). For a
   * craft kind this is `Transition.color` when set, else the per-kind default —
   * so both the studio band and the export canvas fill the band with the SAME
   * solid color. A solid fill (no gradient) keeps studio↔export parity.
   */
  bandFill: string | null;
}

const TREATMENT: Record<TransitionType, TransitionTreatment> = {
  "hard-cut": "gutter",
  gutter: "gutter",
  fade: "fade",
  beat: "card",
  "scene-break": "break",
  "time-skip": "card",
  // v3 craft kinds (#99): solid bands; title_card reuses the card text treatment.
  black_band: "band",
  palette_shift: "band",
  desaturate_repeat: "band",
  title_card: "card",
};

/**
 * Per-kind default solid-band fill for the v3 craft transition kinds (#99). A
 * craft transition with no explicit `Transition.color` falls back to these so the
 * band still reads; `desaturate_repeat` is a neutral GRAY band standing in for a
 * true cross-cut desaturate (deferred — see #99 / docs §8). Legacy kinds are
 * absent here and keep their existing treatment rendering (bandFill = null).
 */
const CRAFT_BAND_DEFAULTS: Partial<Record<TransitionType, string>> = {
  black_band: "#0d0d0d",
  title_card: "#15110d",
  palette_shift: "#5a6b7a",
  desaturate_repeat: "#9a958c",
};

/** Resolve a transition into a render plan. */
export function layoutTransition(transition: Transition): TransitionRender {
  // `transition.type` is an exhaustive enum key, so the lookup is always present.
  const treatment = TREATMENT[transition.type] ?? "gutter";
  const detail =
    transition.text ?? transition.sfx ?? transition.humanNote ?? transition.agentNote ?? null;
  const isSfx =
    transition.text === null && transition.sfx !== null && transition.sfx.trim().length > 0;
  const color = transition.color?.trim() ? transition.color : null;
  // Craft kinds (#99) resolve a solid band fill: the explicit color, else the
  // per-kind default. Legacy kinds have no default → bandFill stays null.
  const craftDefault = CRAFT_BAND_DEFAULTS[transition.type] ?? null;
  const bandFill = craftDefault !== null ? (color ?? craftDefault) : null;
  return {
    id: transition.id,
    type: transition.type,
    gutterHeight: clamp(
      Math.round(transition.gutterHeight),
      GUTTER_HEIGHT_MIN_PX,
      GUTTER_HEIGHT_MAX_PX,
    ),
    treatment,
    label: transition.type.replace(/[-_]/g, " "),
    detail: detail && detail.trim().length > 0 ? detail : null,
    isSfx,
    isCard: treatment === "card" || treatment === "break",
    color,
    bandFill,
  };
}
