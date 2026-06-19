// Transition rendering plan — the vertical rhythm between cuts.
//
// Build-fresh per the reuse analysis (plotlink-ows has no transition concept).
// `layoutTransition` resolves a schema `Transition` into a framework-agnostic
// plan the studio preview (#7) renders as a styled gutter band, conveying the
// reading rhythm between cuts. It is read-only here; rich transition EDITING is
// issue #9. Pure and deterministic so the editor (#9) and stitched export (#10)
// can reuse the same band geometry/treatment.

import {
  type FadeDirection,
  type FadeType,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  type TextAlign,
  type Transition,
  type TransitionType,
  type VerticalAlign,
} from "@toony/schema";
import { clamp } from "./geometry.js";

/**
 * Visual treatment of a transition band, derived from its type. `band` (#99) is
 * a solid full-width color band (the craft scene-break kinds); the v4 interstitial
 * card kinds (#115, narration/dialogue/time) reuse the `card` treatment but with
 * the plan's resolved H+V text anchoring.
 */
export type TransitionTreatment = "gutter" | "fade" | "card" | "break" | "band";

/**
 * Resolved panel fade (#115): the concrete end `color` the panel fades into over
 * `length` px from the leading edge per `direction`. Both consumers draw the
 * identical gradient from these resolved fields.
 */
export interface ResolvedFade {
  type: FadeType;
  direction: FadeDirection;
  /** Fade span in px, clamped to [1, panel height]. */
  length: number;
  /** Concrete end color the panel fades into. */
  color: string;
}

/**
 * Resolved full-panel gradient (#115): the panel fill spans `from` → `to` per
 * `direction`. Both consumers draw the identical gradient from these fields.
 */
export interface ResolvedGradient {
  from: string;
  to: string;
  direction: FadeDirection;
}

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
   * Resolved solid-band background fill (#99) for the v3 craft kinds and the v4
   * interstitial panels (#115), or null for the legacy kinds (which keep their
   * per-treatment default rendering). For a panel kind this is `Transition.color`
   * when set, else the per-kind default — so both the studio band and the export
   * canvas fill the band with the SAME solid color. Solid fill keeps parity.
   */
  bandFill: string | null;
  /**
   * Resolved horizontal/vertical text anchoring for the v4 interstitial card
   * kinds (#115). Defaults (`center`/`middle`) are resolved ONCE here so render,
   * export, and studio anchor panel text identically (the #112 single-source
   * lesson). Legacy card kinds keep their own fixed text layout and ignore these.
   */
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /**
   * Resolved full-panel gradient fill (#115), or null for a solid fill. When set,
   * consumers fill the panel with this instead of the solid `bandFill`/`color`.
   */
  gradient: ResolvedGradient | null;
  /** Resolved panel fade (#115) overlay, or null when the transition has none. */
  fade: ResolvedFade | null;
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
  // v4 interstitial kinds (#115): solid color/void fills are `band`; the text
  // panels (narration/dialogue/time) are `card` but use the resolved H+V anchor.
  color_field: "band",
  void: "band",
  narration_card: "card",
  dialogue_card: "card",
  time_card: "card",
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
  // v4 interstitial panels (#115): solid mood field, near-black void, and the
  // dark cards the text panels sit on (text is drawn light over these).
  color_field: "#5a6b7a",
  void: "#0a0a0a",
  narration_card: "#15110d",
  dialogue_card: "#15110d",
  time_card: "#15110d",
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
  // Craft (#99) + v4 interstitial (#115) kinds resolve a solid band fill: the
  // explicit color, else the per-kind default. Legacy kinds have no default →
  // bandFill stays null.
  const craftDefault = CRAFT_BAND_DEFAULTS[transition.type] ?? null;
  const bandFill = craftDefault !== null ? (color ?? craftDefault) : null;
  const gutterHeight = clamp(
    Math.round(transition.gutterHeight),
    GUTTER_HEIGHT_MIN_PX,
    GUTTER_HEIGHT_MAX_PX,
  );
  // Panel text anchoring (#115): resolve defaults ONCE. center/middle is the v4
  // panel default; legacy card kinds ignore these and keep their fixed layout.
  const textAlign: TextAlign = transition.textAlign ?? "center";
  const verticalAlign: VerticalAlign = transition.verticalAlign ?? "middle";
  // Panel gradient (#115): a full-panel fill from `from`→`to`. Colors pass through
  // (validated non-empty); both consumers draw the identical gradient.
  const gradient: ResolvedGradient | null = transition.gradient
    ? {
        from: transition.gradient.from,
        to: transition.gradient.to,
        direction: transition.gradient.direction,
      }
    : null;
  // Panel fade (#115): resolve the concrete end color + clamp the span to the
  // panel height so both consumers draw the identical gradient.
  let fade: ResolvedFade | null = null;
  if (transition.fade) {
    const f = transition.fade;
    const endColor =
      f.type === "to_black" ? "#000000" : f.type === "to_white" ? "#ffffff" : (color ?? "#000000");
    fade = {
      type: f.type,
      direction: f.direction,
      length: clamp(Math.round(f.length), 1, Math.max(1, gutterHeight)),
      color: endColor,
    };
  }
  return {
    id: transition.id,
    type: transition.type,
    gutterHeight,
    treatment,
    label: transition.type.replace(/[-_]/g, " "),
    detail: detail && detail.trim().length > 0 ? detail : null,
    isSfx,
    isCard: treatment === "card" || treatment === "break",
    color,
    bandFill,
    textAlign,
    verticalAlign,
    gradient,
    fade,
  };
}
