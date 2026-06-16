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

/** Visual treatment of a transition band, derived from its type. */
export type TransitionTreatment = "gutter" | "fade" | "card" | "break";

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
}

const TREATMENT: Record<TransitionType, TransitionTreatment> = {
  "hard-cut": "gutter",
  gutter: "gutter",
  fade: "fade",
  beat: "card",
  "scene-break": "break",
  "time-skip": "card",
};

/** Resolve a transition into a render plan. */
export function layoutTransition(transition: Transition): TransitionRender {
  // `transition.type` is an exhaustive enum key, so the lookup is always present.
  const treatment = TREATMENT[transition.type] ?? "gutter";
  const detail =
    transition.text ?? transition.sfx ?? transition.humanNote ?? transition.agentNote ?? null;
  const isSfx =
    transition.text === null && transition.sfx !== null && transition.sfx.trim().length > 0;
  return {
    id: transition.id,
    type: transition.type,
    gutterHeight: clamp(
      Math.round(transition.gutterHeight),
      GUTTER_HEIGHT_MIN_PX,
      GUTTER_HEIGHT_MAX_PX,
    ),
    treatment,
    label: transition.type.replace(/-/g, " "),
    detail: detail && detail.trim().length > 0 ? detail : null,
    isSfx,
    isCard: treatment === "card" || treatment === "break",
  };
}
