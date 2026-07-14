// Transition rendering plan — the vertical rhythm between cuts.
//
// Build-fresh per the reuse analysis (plotlink-ows has no transition concept).
// `layoutTransition` resolves a schema `Transition` into a framework-agnostic
// plan the studio preview (#7) renders as a styled gutter band, conveying the
// reading rhythm between cuts. It is read-only here; rich transition EDITING is
// issue #9. Pure and deterministic so the editor (#9) and stitched export (#10)
// can reuse the same band geometry/treatment.

import { resolveFontFamily } from "@toony/fonts";
import {
  type FadeDirection,
  type FadeType,
  type FontFamilyId,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  type TextAlign,
  type Transition,
  type TransitionType,
  type VerticalAlign,
} from "@toony/schema";
import { clamp } from "./geometry.js";
import { approximateMeasure } from "./measure.js";
import { layoutBubbleText, type MeasureWidth } from "./text.js";

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

// --- Band background + geometry (single source; #147) -----------------------
//
// These resolve the transition BAND's non-text visuals — background precedence,
// the legibility height floor, and the scene-break divider geometry/color — so
// the export canvas (`composeTransitionBand`) and the studio Read panel
// (`TransitionBlock`) draw identical bands with NO per-consumer color/geometry
// literals (the #112/#135 single-source rule; the divider thickness had already
// drifted, 2px in studio vs the height-scaled stroke in export). Band TEXT layout
// stays with `layoutCardText`/`layoutPanelText` (#148) — deliberately untouched.

/**
 * Neutral reading-margin white: the plain-gutter band fill AND the reserved
 * gutter strip behind gutter bubbles in a cut. One constant so the band, the
 * export canvas, and the studio cut stage never drift apart.
 */
export const GUTTER_MARGIN_FILL = "#ffffff";

/** Default dark fill behind a legacy `card` panel (beat/time-skip) with no color. */
const CARD_DEFAULT_FILL = "#15110d";

/** Default vertical fade-treatment gradient (reading white → warm gray). */
const FADE_DEFAULT_GRADIENT: ResolvedGradient = {
  from: "#ffffff",
  to: "#d9d4cc",
  direction: "top_bottom",
};

/** Scene-break divider color. */
const DIVIDER_COLOR = "#2a2a2a";

/** The resolved band background both consumers fill the panel with. */
export type BandBackground =
  | { kind: "gradient"; gradient: ResolvedGradient }
  | { kind: "solid"; color: string };

/**
 * Resolve a transition band's background in ONE place, precedence-ordered:
 * full-panel gradient (#115) → resolved solid band fill (#99/#115) → explicit
 * #98 `color` → legacy card dark default → fade-treatment gradient → plain
 * reading white. Consumers apply the result (canvas fill / CSS background) and
 * carry none of the precedence chain or fallback colors themselves.
 */
export function resolveBandBackground(render: TransitionRender): BandBackground {
  if (render.gradient) return { kind: "gradient", gradient: render.gradient };
  if (render.bandFill) return { kind: "solid", color: render.bandFill };
  if (render.color) return { kind: "solid", color: render.color };
  if (render.treatment === "card") return { kind: "solid", color: CARD_DEFAULT_FILL };
  if (render.treatment === "fade") return { kind: "gradient", gradient: FADE_DEFAULT_GRADIENT };
  return { kind: "solid", color: GUTTER_MARGIN_FILL };
}

/**
 * The drawn band height at panel `width`: honor the authored gutter height, but
 * cards/breaks and the v3 solid bands get a width-derived legibility floor
 * (`round(width*0.1)`) so a small authored gutter still reads. The single source
 * both the export canvas and the studio panel use to size a band.
 */
export function resolveBandHeight(render: TransitionRender, width: number): number {
  const floored = render.isCard || render.treatment === "band";
  const floor = floored ? Math.round(width * 0.1) : 0;
  return Math.max(render.gutterHeight, floor);
}

/** Scene-break divider geometry/color at a given panel `height`. */
export interface BandDivider {
  /** Rule start as a fraction of panel width (the left inset). */
  spanStart: number;
  /** Rule end as a fraction of panel width. */
  spanEnd: number;
  /** Rule thickness in px — scales with height so studio and export match. */
  thickness: number;
  /** Rule color. */
  color: string;
}

/**
 * Resolve the scene-break divider at panel `height`. Thickness scales with the
 * height (`max(1, round(height*0.04))`) — the value that had DRIFTED between the
 * export raster and the studio's fixed 2px CSS border (#147). Both consumers now
 * derive it here, so a break panel reads with the identical rule everywhere.
 */
export function resolveBandDivider(height: number): BandDivider {
  return {
    spanStart: 0.2,
    spanEnd: 0.8,
    thickness: Math.max(1, Math.round(height * 0.04)),
    color: DIVIDER_COLOR,
  };
}

// --- Panel/card TEXT wrapping + typeface (single source; #148) ---------------
//
// Panel/card text WRAPS in both consumers from the same measure-aware layout, and
// draws in ONE shared typeface. The studio used to wrap via CSS (`max-width` +
// `pre-wrap`) in Inter while the export drew a single unwrapped Nunito line, so
// the same long string broke differently and clipped the raster. These helpers
// wrap with the deterministic default measurer (identical breaks on server and
// canvas, no platform dependency) and expose the shared font id/stack; the #147
// band background/floor/divider helpers above are consumed as-is, never redefined.

/** Panel/card text wraps within this fraction of the panel width (#148). Matches
 *  the 8% horizontal padding both consumers use (avail = 1 - 2*0.08 = 0.84). */
export const BAND_TEXT_MAX_WIDTH_FRAC = 0.84;

/** Line advance as a multiple of font size for wrapped panel/card text. */
const BAND_LINE_HEIGHT_FACTOR = 1.25;

/** Light panel-text color drawn over the dark card fills (#115). */
const PANEL_TEXT_COLOR = "#f3ece0";

/**
 * The single band/panel typeface — curated Nunito — applied in BOTH consumers so
 * transition text renders in the same face in the studio Read view and the export
 * raster (#148). `BAND_FONT_ID` is what export registers/measures with;
 * `BAND_FONT_STACK` is the CSS stack the studio sets on panel/card text.
 */
export const BAND_FONT_ID: FontFamilyId = "nunito";
// `resolveFontFamily` always returns a registered family (the `kind` is only a
// fallback path, unused since `BAND_FONT_ID` is a valid registry id), so the
// stack is non-optional and stays a single source with what export registers.
export const BAND_FONT_STACK: string = resolveFontFamily(BAND_FONT_ID, "narration").stack;

/**
 * Trim trailing words (then characters) off `line` so that `line…` fits within
 * `maxWidth` at the given font — so the ellipsized last line never spills past
 * the panel horizontally. Measured with the SAME measurer the wrap used, so both
 * consumers truncate identically. Always returns at least the ellipsis.
 */
function ellipsizeToWidth(
  line: string,
  measure: MeasureWidth,
  fontSize: number,
  fontWeight: 400 | 700,
  maxWidth: number,
): string {
  const fits = (t: string) => measure(`${t}…`, fontSize, fontWeight) <= maxWidth;
  let text = line.replace(/\s+$/, "");
  if (fits(text)) return `${text}…`;
  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 1) {
    words.pop();
    text = words.join(" ");
    if (fits(text)) return `${text}…`;
  }
  // A single word still too wide with the ellipsis: trim characters.
  text = words[0] ?? "";
  while (text.length > 0 && !fits(text)) text = text.slice(0, -1);
  return `${text}…`;
}

/**
 * Shared overflow policy (#148): auto-fit shrinks the font to a floor, but
 * `Transition.text` is unbounded, so at the floor a very long caption can still
 * produce more lines than fit. Cap the block to the `maxLines` that fit the
 * available height, and width-aware-truncate the last shown line to `line…`
 * (reflowing so it still fits `maxWidth`) — so the block NEVER clips or overlaps
 * vertically OR horizontally, and both consumers degrade a too-long caption
 * identically. Always keeps at least one line.
 */
function capLinesToFit(
  lines: string[],
  availableHeight: number,
  lineHeight: number,
  measure: MeasureWidth,
  fontSize: number,
  fontWeight: 400 | 700,
  maxWidth: number,
): string[] {
  const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const lastIndex = kept.length - 1;
  kept[lastIndex] = ellipsizeToWidth(
    kept[lastIndex] ?? "",
    measure,
    fontSize,
    fontWeight,
    maxWidth,
  );
  return kept;
}

/** One drawn, already-wrapped line of a transition panel, middle-baselined. */
export interface PanelTextLine {
  text: string;
  /** Anchor x (px) for the resolved horizontal alignment. */
  x: number;
  /** Vertical CENTER of this line (px) — draw middle-baselined. */
  y: number;
}

/**
 * Resolved v4 interstitial panel text (#115), WRAPPED to the panel width (#148).
 * The SINGLE source both the export canvas and the studio Read panel consume, so
 * they break and place the lines identically. `align` is the shared horizontal
 * alignment (canvas `textAlign` / CSS `text-align`); every line draws
 * middle-baselined at its own `y`.
 */
export interface PanelTextLayout {
  lines: PanelTextLine[];
  /** Font size in px, derived from the panel height. */
  fontSize: number;
  /** Horizontal text alignment. */
  align: TextAlign;
  /** Text color (light, for the dark card fills). */
  color: string;
}

/**
 * Resolve wrapped v4 panel text at the panel's drawn `width`×`height`. Wraps
 * `render.detail` within `BAND_TEXT_MAX_WIDTH_FRAC` of the width using the
 * deterministic default measurer (so export and studio break identically), and
 * positions the block per the resolved vertical alignment. Returns null with no
 * text. `measure` is injectable but both consumers use the default for parity.
 */
export function layoutPanelText(
  render: TransitionRender,
  width: number,
  height: number,
  measure: MeasureWidth = approximateMeasure,
): PanelTextLayout | null {
  if (!render.detail) return null;
  const padX = (width * (1 - BAND_TEXT_MAX_WIDTH_FRAC)) / 2;
  const padY = height * 0.1;
  const maxFontSize = Math.max(12, Math.round(height * 0.14));
  // Auto-fit + wrap the text so the block always fits within the padded panel:
  // it wraps to the max width and shrinks the font (down to a floor) if the
  // wrapped lines would be taller than the panel — so a long caption never clips.
  const fit = layoutBubbleText(measure, render.detail, width, height, {
    maxFontSize,
    minFontSize: Math.max(8, Math.round(maxFontSize * 0.6)),
    fontWeight: 400,
    lineHeightFactor: BAND_LINE_HEIGHT_FACTOR,
    paddingX: padX,
    paddingY: padY,
  });
  // Overflow policy: cap to the lines that fit the padded panel (width-aware
  // ellipsis on the last), so an unbounded caption never clips.
  const capped = capLinesToFit(
    fit.lines,
    height - 2 * padY,
    fit.lineHeight,
    measure,
    fit.fontSize,
    400,
    width * BAND_TEXT_MAX_WIDTH_FRAC,
  );
  const blockHeight = capped.length * fit.lineHeight;
  const align = render.textAlign;
  const x = align === "left" ? padX : align === "right" ? width - padX : width / 2;
  const v = render.verticalAlign;
  const blockTop =
    v === "top" ? padY : v === "bottom" ? height - padY - blockHeight : (height - blockHeight) / 2;
  const lines: PanelTextLine[] = capped.map((text, i) => ({
    text,
    x,
    y: blockTop + i * fit.lineHeight + fit.lineHeight / 2,
  }));
  return { lines, fontSize: fit.fontSize, align, color: PANEL_TEXT_COLOR };
}

/** One drawn line of a legacy card/break panel (#118 parity), middle-baselined. */
export interface CardTextLine {
  text: string;
  /** Anchor x (px) — always horizontally centered. */
  x: number;
  /** Anchor y (px) of the line's vertical MIDDLE. */
  y: number;
  fontSize: number;
  /** 700 for the bold detail line, 400 for the small type label. */
  weight: number;
}

/** Resolved text for a legacy `card`/`break` panel: detail + small type label. */
export interface CardTextLayout {
  lines: CardTextLine[];
  /** Light over dark cards (#f3ece0); dark over the break's light/divider ground. */
  color: string;
}

/**
 * Resolve the legacy card/break panel text geometry (`beat`/`time-skip`/
 * `title_card`/`scene-break`) at the drawn `width`×`height`. This is the SINGLE
 * source both the export canvas (`drawBandText`) and the studio Read panel (#118)
 * consume. The bold detail WRAPS + auto-fits to the panel width (#148,
 * deterministic measurer → identical breaks); the detail block and the small type
 * label form one vertically-centered, bounded, non-overlapping stack (the label
 * always sits below the detail). Returns null when there is nothing to draw.
 */
export function layoutCardText(
  render: TransitionRender,
  width: number,
  height: number,
  measure: MeasureWidth = approximateMeasure,
): CardTextLayout | null {
  const labelSize = Math.max(10, Math.round(height * 0.22));
  const cx = width / 2;
  const color = render.treatment === "break" ? "#2a2a2a" : PANEL_TEXT_COLOR;
  const padX = (width * (1 - BAND_TEXT_MAX_WIDTH_FRAC)) / 2;
  const padY = height * 0.1;
  if (render.detail) {
    const labelFontSize = Math.max(8, Math.round(labelSize * 0.6));
    const labelLineHeight = labelFontSize * BAND_LINE_HEIGHT_FACTOR;
    const gap = labelLineHeight * 0.5;
    // Auto-fit + wrap the bold detail into the panel MINUS the top/bottom pad and
    // the label row + gap, so the detail block never grows past the panel. The
    // detail + label form one vertically-centered, bounded, non-overlapping stack.
    const detailBox = Math.max(1, height - 2 * padY - labelLineHeight - gap);
    const detail = layoutBubbleText(measure, render.detail, width, detailBox, {
      maxFontSize: labelSize,
      minFontSize: Math.max(8, Math.round(labelSize * 0.5)),
      fontWeight: 700,
      lineHeightFactor: BAND_LINE_HEIGHT_FACTOR,
      paddingX: padX,
      paddingY: 0,
    });
    // Overflow policy: cap the detail to the lines that fit its reserved box
    // (width-aware ellipsis on the last), so the stack always stays bounded.
    const cappedDetail = capLinesToFit(
      detail.lines,
      detailBox,
      detail.lineHeight,
      measure,
      detail.fontSize,
      700,
      width * BAND_TEXT_MAX_WIDTH_FRAC,
    );
    const detailHeight = cappedDetail.length * detail.lineHeight;
    const stackHeight = detailHeight + gap + labelLineHeight;
    const stackTop = Math.max(padY, (height - stackHeight) / 2);
    const detailLines: CardTextLine[] = cappedDetail.map((text, i) => ({
      text,
      x: cx,
      y: stackTop + i * detail.lineHeight + detail.lineHeight / 2,
      fontSize: detail.fontSize,
      weight: 700,
    }));
    return {
      color,
      lines: [
        ...detailLines,
        {
          text: render.label,
          x: cx,
          y: stackTop + detailHeight + gap + labelLineHeight / 2,
          fontSize: labelFontSize,
          weight: 400,
        },
      ],
    };
  }
  return {
    color,
    lines: [
      {
        text: render.label,
        x: cx,
        y: height / 2,
        fontSize: Math.max(8, Math.round(labelSize * 0.7)),
        weight: 400,
      },
    ],
  };
}
