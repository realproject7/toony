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
import { compositeOver, parseCssColor, type Rgb, rec709Luminance } from "./contrast.js";
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
  /**
   * Fade span in px on the REFERENCE column, clamped to [1, authored gutter
   * height]. Consumers draw `resolveBandFade`'s span, never this one: the two
   * differ at every column but the reference one (#217).
   */
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
  /**
   * The authored vertical rhythm: clamped gutter height in px on the project's
   * REFERENCE column. Not a drawn height. `resolveBandHeight` scales it to the
   * column being rendered (#217).
   */
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

/**
 * The solid band fill a kind draws with NO authored `Transition.color`: its craft
 * default, or null for the legacy kinds that have none (those fall through to
 * their treatment's rendering). Read by `layoutTransition` below AND by
 * `defaultBandBackground`, so the fill a band's vocabulary is written against is
 * the fill the renderer actually draws.
 */
function defaultBandFill(type: TransitionType): string | null {
  return CRAFT_BAND_DEFAULTS[type] ?? null;
}

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
  const craftDefault = defaultBandFill(transition.type);
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
 * The fields the background precedence chain reads. Narrowed from
 * `TransitionRender` so `defaultBandBackground` can run the SAME chain over a
 * kind's defaults without inventing the rest of a render plan; every existing
 * caller still passes a whole `TransitionRender`.
 */
export type BandBackgroundSource = Pick<
  TransitionRender,
  "gradient" | "bandFill" | "color" | "treatment"
>;

/**
 * Resolve a transition band's background in ONE place, precedence-ordered:
 * full-panel gradient (#115) → resolved solid band fill (#99/#115) → explicit
 * #98 `color` → legacy card dark default → fade-treatment gradient → plain
 * reading white. Consumers apply the result (canvas fill / CSS background) and
 * carry none of the precedence chain or fallback colors themselves.
 */
export function resolveBandBackground(render: BandBackgroundSource): BandBackground {
  if (render.gradient) return { kind: "gradient", gradient: render.gradient };
  if (render.bandFill) return { kind: "solid", color: render.bandFill };
  if (render.color) return { kind: "solid", color: render.color };
  if (render.treatment === "card") return { kind: "solid", color: CARD_DEFAULT_FILL };
  if (render.treatment === "fade") return { kind: "gradient", gradient: FADE_DEFAULT_GRADIENT };
  return { kind: "solid", color: GUTTER_MARGIN_FILL };
}

/**
 * The background a kind resolves to with NOTHING authored on it — the same
 * precedence chain above, fed the plan an un-overridden transition of that kind
 * produces (no gradient, no `color`, the kind's own default fill). One chain and
 * one defaults table, so what a kind is SAID to draw can never drift from what
 * the renderer fills the band with.
 */
export function defaultBandBackground(type: TransitionType): BandBackground {
  return resolveBandBackground({
    gradient: null,
    bandFill: defaultBandFill(type),
    color: null,
    treatment: TREATMENT[type],
  });
}

// --- Which gap a band reads as (#267) ---------------------------------------
//
// A craft band's `transitionVocabulary` (#236) grades an episode's transition
// mix by reading each transition's declared KIND, against ranges measured by
// sorting reference pixels into four buckets: the page's own ground, a void, a
// colour field, a card. Which bucket a toony kind belongs to was asserted once
// per entry in each band and checked nowhere — and the assertion is only true
// for the kind's DEFAULT rendering, because `Transition.color` and
// `Transition.gradient` win over that default and nothing compares them to it.
//
// So the mapping lives HERE, beside the precedence chain and the default fills,
// because a band's bucket is a property of what the band DRAWS. Anywhere else it
// would be a second copy of the renderer's colours, free to drift from them —
// which is the defect one level up, not a fix for it.

/**
 * One of the four buckets a page's gaps are sorted into (#236): the page's own
 * ground, a near-black void, a solid colour field, or a panel carrying words.
 */
export type BandAppearance = "page-background" | "void" | "color-field" | "card";

/**
 * What a band reads as. THREE outcomes, and they are not the same claim:
 *
 *   - one of the four buckets;
 *   - `"unclassified"`, a fill the reference's rule puts in NONE of them — a
 *     mid-value band with too little colour in it to be a colour field. This is
 *     an answer, not ignorance: #236's shipped bands leave `desaturate_repeat`
 *     unclaimed for exactly this reason, and a band that claimed it would be
 *     claiming a bucket its pages never showed;
 *   - null, a fill the core cannot parse at all, which is ignorance.
 */
export type BandReading = BandAppearance | "unclassified" | null;

/**
 * Below this value a band is a void, and over this saturation it is a colour
 * field. Both numbers are the REFERENCE ANALYZER'S OWN, recorded verbatim in
 * `@toony/export`'s transition-vocabulary note: "flat under luminance 60 is a
 * void, flat over saturation 0.18 is a colour field". Neither is chosen here, so
 * neither may be tuned here — moving one makes this classifier disagree with the
 * measurement whose buckets it exists to name, which is this ticket's own defect
 * one level up.
 *
 * Value is Rec. 709 luminance on 0..255 (`rec709Luminance`) and saturation is
 * `(max - min) / max` on the same channels, both the definitions
 * `@toony/export`'s `sampleColor` grades a page with.
 */
export const BAND_VOID_VALUE = 60;
export const BAND_COLOR_FIELD_SATURATION = 0.18;

/**
 * At or above this value a band with too little colour to be a colour field is
 * the page's own ground; below it, it is in no bucket at all.
 *
 * This one is NOT the reference's. Its rule says "flat and page-coloured is an
 * empty gutter" and records no number for page-coloured, so a number has to be
 * chosen here, and it is chosen against the renderer's own defaults rather than
 * freely: every default fill has to land in the bucket its kind is grouped
 * under, which leaves a window of (149.4, 233.7] — above `desaturate_repeat`'s
 * `#9a958c`, which must stay unclassified, and at or below the fade treatment's
 * default gradient, the DARKEST page ground the renderer draws (its two ends
 * average 233.7; the `#ffffff` of a plain gutter is the palest at 255, and a
 * palest bound would not constrain anything). 190 is the round value nearest
 * that window's middle, 191.6, so it sits as far from both bounds as the
 * defaults allow. `__tests__/band-appearance.test.ts` pins the window, the
 * rounding, and the constant itself.
 */
export const BAND_PAGE_BACKGROUND_MIN_VALUE = 190;

/**
 * `GUTTER_MARGIN_FILL` as channels: the page ground a translucent band fill
 * shows through. It is the one surface under a band that is never artwork, so it
 * is the only background the core can composite against and still be right.
 */
const PAGE_GROUND: Rgb = { r: 255, g: 255, b: 255 };

/** What one fill reads at, on the two axes the reference's rule uses. */
interface FillReading {
  value: number;
  saturation: number;
}

/**
 * One fill's reading, or null for a colour the core cannot measure.
 *
 * The value is rounded to the four decimals `@toony/export` reports every craft
 * number at, and that rounding is load bearing at a boundary rather than
 * cosmetic: the three coefficients sum to one, so a grey of 190 should read at
 * exactly the page floor, and in binary floating point it reads at
 * 189.99999999999997 and falls on the wrong side of it.
 */
function fillReading(color: string): FillReading | null {
  const parsed = parseCssColor(color);
  if (parsed === null) return null;
  const opaque = parsed.a >= 1 ? parsed : compositeOver(parsed, PAGE_GROUND);
  const max = Math.max(opaque.r, opaque.g, opaque.b);
  const min = Math.min(opaque.r, opaque.g, opaque.b);
  return {
    value: Math.round(rec709Luminance(opaque.r, opaque.g, opaque.b) * 1e4) / 1e4,
    saturation: max === 0 ? 0 : (max - min) / max,
  };
}

/**
 * What a whole band reads at. A gradient is its two ends averaged on both axes:
 * the band is one region of page and the reader sees all of it, so neither end
 * alone is what it reads as.
 *
 * The `fade` OVERLAY (`Transition.fade`) is deliberately NOT folded in. It is a
 * blend over part of the band rather than the band's fill, and covering a share
 * of the band with another colour is a question about geometry this has no
 * height to answer. A band whose fill and fade disagree is invisible here.
 */
function bandReading(background: BandBackground): FillReading | null {
  if (background.kind === "solid") return fillReading(background.color);
  const from = fillReading(background.gradient.from);
  const to = fillReading(background.gradient.to);
  if (from === null || to === null) return null;
  return {
    value: (from.value + to.value) / 2,
    saturation: (from.saturation + to.saturation) / 2,
  };
}

/**
 * True when the band DRAWS the transition's `detail` text. Only the card and
 * break treatments do: a `color_field` or a `void` carrying a note renders the
 * same bare field it would without one.
 *
 * `detail` is `text ?? sfx ?? humanNote ?? agentNote`, so an annotated card
 * kind reads as a card where an unannotated one does not. That is faithful
 * rather than a quirk of this rule — the renderer really does draw the note —
 * but it means a production note changes which bucket a band counts the
 * transition in.
 *
 * `beat`, `time-skip` and `title_card` also draw a small type LABEL with no
 * detail at all, and it does not count: it names the kind rather than carrying a
 * line, and a page classifier reading a dark rectangle with a small label on it
 * is reading a void. The other four card and break kinds do not even draw that —
 * a text-less `narration_card`, `dialogue_card` or `time_card` composes a single
 * flat colour, and a text-less `scene-break` its divider and nothing else.
 */
function carriesWords(render: Pick<TransitionRender, "treatment" | "detail">): boolean {
  return (render.treatment === "card" || render.treatment === "break") && render.detail !== null;
}

function appearanceOf(background: BandBackground, words: boolean): BandReading {
  if (words) return "card";
  const read = bandReading(background);
  if (read === null) return null;
  if (read.value < BAND_VOID_VALUE) return "void";
  if (read.saturation > BAND_COLOR_FIELD_SATURATION) return "color-field";
  if (read.value >= BAND_PAGE_BACKGROUND_MIN_VALUE) return "page-background";
  return "unclassified";
}

/**
 * The bucket a transition's KIND puts it in — the mapping a band's
 * `transitionVocabulary` entry asserts when it groups that kind.
 *
 * It rests on one assumption, and this is the whole of it: **the transition is
 * rendered at its kind's default.** An authored `color` or `gradient` is not
 * read here, so on a transition that carries one this is the bucket the band
 * COUNTS it in rather than the bucket it draws — compare `drawnBandAppearance`
 * to find out whether those are the same thing.
 *
 * It is not a static table, because two things decide a bucket. The card and
 * break treatments — `beat`, `time-skip`, `scene-break`, `title_card`,
 * `narration_card`, `dialogue_card`, `time_card` — read as a card when they
 * carry text and as their own bare ground when they do not: a void for the six
 * that default to the dark card fill, the page's ground for `scene-break`, which
 * falls through to the reading white. Every other kind's bucket is the same
 * whatever it carries, because its treatment draws no text at all.
 *
 * `desaturate_repeat` is `"unclassified"`: its neutral grey default is over the
 * void ceiling and under the colour-field saturation, so the reference's rule
 * puts it in no bucket, and #236's shipped bands leave it unclaimed on exactly
 * that ground. Never null — every default is measurable.
 */
export function declaredBandAppearance(render: TransitionRender): BandReading {
  return appearanceOf(defaultBandBackground(render.type), carriesWords(render));
}

/**
 * The bucket the transition's AUTHORED appearance actually draws: the resolved
 * background, not the kind's default.
 *
 * Null ONLY when the fill is one the core cannot parse AND the band's bucket
 * turns on that fill — a card kind carrying a line is a card before any colour
 * is read, so an unparseable colour on one still reads `card`.
 */
export function drawnBandAppearance(render: TransitionRender): BandReading {
  return appearanceOf(resolveBandBackground(render), carriesWords(render));
}

/** How a reading is written in a report, so every consumer words it once. */
export function bandAppearanceLabel(reading: BandAppearance | "unclassified"): string {
  if (reading === "page-background") return "page background";
  if (reading === "color-field") return "color field";
  if (reading === "unclassified") return "none of the four buckets";
  return reading;
}

// --- Reference-column scaling (#217) ----------------------------------------
//
// A cut's art is scaled to fill the column, so its drawn height is a fixed
// multiple of the column width. A band's authored `gutterHeight` is px on the
// project's reference column. Drawing that number raw made the ratio between the
// two, which is the page rhythm, a function of the export width. The same
// episode at 1600px had gutters half the relative size it had at 800px, 23% more
// panels per screen, and graded against a different half of its craft band.
// Scaling by the column ratio makes an export the same comic, larger.

/**
 * The scale from a project's reference column to the column being rendered.
 * `referenceWidth` comes from `resolveReferenceWidth`, so it is always positive.
 */
function columnScale(width: number, referenceWidth: number): number {
  return width / Math.max(1, referenceWidth);
}

/**
 * The drawn band height at panel `width`, for a project whose px are authored
 * against `referenceWidth`: scale the authored gutter height to this column, but
 * give cards/breaks and the v3 solid bands a width-derived legibility floor
 * (`round(width*0.1)`) so a small authored gutter still reads. The single source
 * both the export canvas and the studio panel use to size a band.
 *
 * The floor was already column-relative, which is why a card's text stayed
 * legible at every width while the gutters around it did not.
 */
export function resolveBandHeight(
  render: TransitionRender,
  width: number,
  referenceWidth: number,
): number {
  const scaled = Math.round(render.gutterHeight * columnScale(width, referenceWidth));
  const floored = render.isCard || render.treatment === "band";
  const floor = floored ? Math.round(width * 0.1) : 0;
  return Math.max(scaled, floor);
}

/**
 * The drawn panel fade at `width`×`height`, or null when the transition has none.
 *
 * The authored span is reference-column px like the gutter height, so it scales
 * with the column too. Left unscaled it would cover a different share of the band
 * at every export width, which is the same defect one level down. Clamped to the
 * drawn height so the fade never runs past the panel.
 */
export function resolveBandFade(
  render: TransitionRender,
  width: number,
  height: number,
  referenceWidth: number,
): ResolvedFade | null {
  if (!render.fade) return null;
  const length = clamp(
    Math.round(render.fade.length * columnScale(width, referenceWidth)),
    1,
    Math.max(1, height),
  );
  return { ...render.fade, length };
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
