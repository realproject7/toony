// Craft measurement: read a rendered episode back as numbers.
//
// A style pack sets craft knobs — the transition gutter budget, the cut height
// distribution, cut density, palette, and whether art reads full-bleed or inset.
// Every one of those is visible in the rendered page, so a pack can be graded
// against a target band instead of being declared finished when it looks right.
//
// This measures the SAME signals, with the same definitions, that the reference
// analyzer measures on vertical-scroll reference captures (the operator's study
// folder, outside this repository). Both sides must agree or the comparison is
// meaningless, so the row rule, the noise floor, the luminance coefficients, the
// interior colour sampling, and the rounding all match it. Where this
// deliberately differs, the comment says so and says why.
//
// It reads GEOMETRY and COLOUR of the composed page, never the drawing, and
// needs no image provider: composition is the same deterministic code path
// `toony export stitched` uses, so the same episode always measures identically.
//
// Language-dependent craft — bubble size, line count, text density, font — is
// deliberately NOT measured here. See docs/CRAFT_MEASURE.md: those belong to the
// `craft/bubble-density`, `craft/line-wrap`, and overflow lints, which run on our
// own English content.

import type { SKRSContext2D } from "@napi-rs/canvas";
import { layoutTransition, rec709Luminance, resolveBandHeight } from "@toony/render";
import {
  type EpisodeBundle,
  GUTTER_HEIGHT_MAX_PX,
  IssueCollector,
  isArray,
  isBoolean,
  isFiniteNumber,
  isInteger,
  isPlainObject,
  isString,
  joinPath,
  resolveReferenceWidth,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
  type ValidationResult,
} from "@toony/schema";
import { stitchEpisode } from "./targets.js";

/**
 * A row counts as flat when its luminance barely varies across the width: it
 * carries no art, so it reads as inter-panel space. Drawn gutters are exactly
 * flat and captured ones are flat within compression noise, while art rows —
 * even a dark night sky — vary far more than this. The reference analyzer's own
 * threshold.
 *
 * Flatness is the whole rule. There is no test on how LIGHT the row is. Do not
 * add one, on either side. A lightness test measures page colour, and page
 * colour is not what makes a row empty. Toony transitions are authored colour
 * fields and a dark one is not light, so the clause reads every dark gap as
 * art: an episode whose gaps are all dark reports no gutters and one panel
 * spanning the page, which is the gutter metric going blind to the exact knob
 * it exists to grade. That is a property of the definition, not a number that
 * can drift. It holds at every flatness threshold and on any set of captures.
 * The clause has already caused one silent failure on flat-but-dark rows, and
 * the note on the transition mix further down this file has it.
 * `examples/dead-air` is the dark episode in this repository; what it measures
 * is pinned in `__tests__/craft-inset.test.ts` rather than quoted here.
 */
export const FLAT_ROW_STDDEV_MAX = 12;

/**
 * Flat runs shorter than this share of the render WIDTH are seams between
 * stacked art, not reading pauses.
 *
 * Width, never the screen height. This floor decides which runs exist, and every
 * metric is computed from the surviving run set, so keying it to the screen made
 * even the width-normalized metrics move with `--screen-aspect`. The value is
 * the old screen-relative one times four, so a 4:1 screen classifies exactly as
 * it did before, and 4 is the aspect every band derived from the reference
 * captures declares. The reference analyzer uses the same width-relative floor
 * at the same value, and the two sides have to classify identically or a band
 * cannot be compared to a render.
 */
export const GUTTER_MIN_RUN_FRACTION = 0.016;

/**
 * A non-flat run shorter than this share of the render width is not a panel: it
 * is something floating IN the gutter — a bubble or an SFX overlapping the empty
 * space between cuts, which Toony expresses as `placement: gutter`. Counting
 * those as panels shredded the reference's thriller numbers (panels per frame
 * read 6.9 and the median panel height came out a third of its true value), so
 * they are folded back into the gutter for rhythm and counted on their own.
 *
 * Width-relative, and rescaled by four, for the reason given on the gutter floor
 * above.
 */
export const PANEL_MIN_RUN_FRACTION = 0.16;

/**
 * Height of one reading screen as a multiple of the render width. Only
 * `panelsPerScreen` and `gutterIntrusionsPerScreen` read it, and they scale
 * linearly with it. Every other metric is a share of the width and measures the
 * same at every aspect, so two bands taken at different aspects are still
 * comparable on the nine metrics that are pure geometry and colour.
 */
export const DEFAULT_SCREEN_ASPECT = 2;

/** Rows read per `getImageData` call, so a tall episode stays bounded in memory. */
const ROW_BLOCK = 256;

/** At most this many art rows are sampled for colour, evenly spread. */
const COLOR_ROW_SAMPLES = 200;

/** Every Nth pixel of a sampled row's interior contributes colour. */
const COLOR_PIXEL_STRIDE = 8;

/**
 * Per-channel tolerance for "this pixel matches the anchor it is compared with".
 * Which pixel that anchor IS differs between the two callers below, so the
 * tolerance says nothing about which edge a run belongs to.
 */
const EDGE_MATCH_TOLERANCE = 10;

/** The metrics this command reports, in display order. */
export const CRAFT_METRIC_NAMES = [
  "gutterRatio",
  "gutterMedian",
  "panelHeightMedian",
  "panelHeightSpread",
  "panelsPerScreen",
  "gutterIntrusionsPerScreen",
  "panelInset",
  "valueMean",
  "valueSpread",
  "saturationMean",
  "hueBias",
] as const;

export type CraftMetricName = (typeof CRAFT_METRIC_NAMES)[number];

/**
 * The measured craft signals. Run lengths are a share of the width; `valueMean`
 * and `valueSpread` are 0..255 luminance; `saturationMean` is 0..1; `hueBias` is
 * degrees, or null when the sampled art carries no colour at all.
 */
export interface CraftMetrics {
  /** Share of episode height that is inter-panel space. */
  gutterRatio: number;
  /** Median gutter run, as a share of the width. */
  gutterMedian: number;
  /** Median panel run, as a share of the width. */
  panelHeightMedian: number;
  /** Standard deviation of the panel runs, same unit. */
  panelHeightSpread: number;
  /** Panels per screen of scrolling — how fast the eye moves. */
  panelsPerScreen: number;
  /** Elements floating in the gutter, per screen (`placement: gutter` lettering). */
  gutterIntrusionsPerScreen: number;
  /**
   * Share of the width left as flat margin at a panel's two edges, summed. Each
   * edge is measured against its own outermost pixel, so a page and its mirror
   * report the same number. The two runs are independent and are not clipped
   * against each other, so the sum is not bounded by 1.
   */
  panelInset: number;
  /** Mean luminance of the panel interiors. */
  valueMean: number;
  /** Standard deviation of that luminance. */
  valueSpread: number;
  /** Mean saturation of the panel interiors. */
  saturationMean: number;
  /** Mean hue of the panel interiors, in degrees. */
  hueBias: number | null;
}

/** One episode measured, with the render assumptions that produced the numbers. */
export interface CraftMeasurement {
  episodeId: string;
  /** Render width in px. */
  width: number;
  /** Composed episode height in px. */
  height: number;
  screenAspect: number;
  /** One screen in px: `round(width * screenAspect)`. */
  screenHeight: number;
  /** Cuts the episode sequence reads. */
  cuts: number;
  /**
   * How many of those have no image asset yet. Such a cut composes a flat
   * neutral background, which measures as empty space — so a mostly art-less
   * episode reports a high gutter ratio and a light value that describe the page
   * honestly but say nothing about the pack. Reported so that reading is never
   * mistaken for craft.
   */
  cutsWithoutImage: number;
  metrics: CraftMetrics;
  /**
   * Which kinds of gap the episode puts between its cuts. Read off the declared
   * transition records rather than off the composed page — see "The transition
   * vocabulary" below for why, and for what that choice cannot see.
   */
  transitions: TransitionMix;
}

export interface MeasureOptions {
  /** Render width in px. Defaults to the stitched export width. */
  width?: number;
  /** Screen height as a multiple of the width. Defaults to `DEFAULT_SCREEN_ASPECT`. */
  screenAspect?: number;
}

/**
 * Rec. 709 luminance, 0..255 — the coefficients the reference analyzer uses.
 * `@toony/lint`'s image analysis uses Rec. 601 for its own thresholds; the two
 * are deliberately not shared, because a craft number that does not use the
 * reference's coefficients cannot be compared with the reference's band.
 *
 * The formula itself is `@toony/render`'s `rec709Luminance` (#267), which the
 * render core's band-appearance buckets read a colour with. Those buckets are
 * the kind side of the same comparison this file's `transitionVocabulary`
 * grades, so a second copy here would be two definitions of one measured value.
 */
const luminance = rec709Luminance;

interface RowStats {
  mean: number;
  stddev: number;
}

interface Run {
  flat: boolean;
  start: number;
  length: number;
}

function runsOf(flags: readonly boolean[]): Run[] {
  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= flags.length; i++) {
    if (i === flags.length || flags[i] !== flags[start]) {
      runs.push({ flat: flags[start] === true, start, length: i - start });
      start = i;
    }
  }
  return runs;
}

/**
 * The reference analyzer's median: `sorted(xs)[len(xs) // 2]`, taken element-
 * wise and never averaged. On an EVEN count that is the UPPER of the two middle
 * values, not the lower — the comment here said "lower" and was wrong about its
 * own code, while the code has always matched the reference, which is the half
 * that has to be right.
 *
 * Worth saying out loud because it decides what an even-count median grades. A
 * vocabulary entry covering four gaps is graded on the third-smallest, so the
 * tallest is not itself bounded by the range and can carry arbitrary page
 * length; an entry covering two is graded on the taller one, which pushes such
 * a median toward the top of its range rather than the middle. Neither is a
 * defect against the reference — it is the same rule on both sides — but a band
 * author reading "median" as the conventional average of two middles will
 * expect a different number than this returns.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function stddev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - avg) ** 2;
  return Math.sqrt(sum / values.length);
}

/** Rounded to `digits`, the one rounding every reported figure goes through. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Per-row luminance mean and standard deviation for the whole page. */
function rowStats(ctx: SKRSContext2D, width: number, height: number): RowStats[] {
  const stats: RowStats[] = [];
  for (let top = 0; top < height; top += ROW_BLOCK) {
    const rows = Math.min(ROW_BLOCK, height - top);
    const { data } = ctx.getImageData(0, top, width, rows);
    for (let y = 0; y < rows; y++) {
      const base = y * width * 4;
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const i = base + x * 4;
        sum += luminance(data[i] as number, data[i + 1] as number, data[i + 2] as number);
      }
      const avg = sum / width;
      let variance = 0;
      for (let x = 0; x < width; x++) {
        const i = base + x * 4;
        const delta =
          luminance(data[i] as number, data[i + 1] as number, data[i + 2] as number) - avg;
        variance += delta * delta;
      }
      stats.push({ mean: avg, stddev: Math.sqrt(variance / width) });
    }
  }
  return stats;
}

/** One row's RGB samples, as a flat `[r, g, b, r, g, b, …]` array. */
function readRow(ctx: SKRSContext2D, y: number, width: number): Uint8ClampedArray {
  return ctx.getImageData(0, y, width, 1).data;
}

/**
 * How far one uniform colour reaches inward from one end of a row.
 *
 * `step` picks the end — `1` starts at x=0 and walks right, `-1` starts at
 * x=width-1 and walks left — and `anchor` is the pixel whose colour the run is
 * required to keep. The two are separate arguments because which pixel a run is
 * compared against is exactly what #255 turned out to be about.
 */
function edgeRun(row: Uint8ClampedArray, width: number, step: 1 | -1, anchor: number): number {
  const a = anchor * 4;
  let run = 0;
  let x = step === 1 ? 0 : width - 1;
  while (run < width) {
    const i = x * 4;
    let matches = true;
    for (let c = 0; c < 3; c++) {
      if (Math.abs((row[i + c] as number) - (row[a + c] as number)) >= EDGE_MATCH_TOLERANCE) {
        matches = false;
        break;
      }
    }
    if (!matches) break;
    run++;
    x += step;
  }
  return run;
}

/**
 * The flat page margin an inset panel leaves beside the art, per edge: how far
 * one colour reaches inward from an edge, EACH EDGE MEASURED AGAINST ITS OWN
 * outermost pixel. The two edges are independent: neither has to match the
 * other and neither is clipped by it, so a page margined on one side, on both,
 * or on neither is read for what each side is. A reserved band is always the
 * white `GUTTER_MARGIN_FILL`; a page whose two edges are DIFFERENT colours gets
 * that from its art, as `examples/dead-air` does.
 *
 * Each edge against itself, because until #255 both were compared against the
 * LEFT-most pixel and `panelInset` therefore answered a different question:
 * which side the reserved band sits on. A band on the left IS the left-most
 * pixel, so it registered at its full width; the same band on the right was
 * compared against art, so it registered as nothing. Two lanes measured the gap
 * independently — 0.1801 against 0.0013 on one scaffold, 0.106 against 0.0544
 * on another — and one shipped pack stopped grading the metric over it (#248).
 *
 * Per-edge anchoring makes the pair exactly mirror-symmetric. A mirrored row is
 * `row'[x] = row[width - 1 - x]`, so `row'`'s left-hand run walks the same
 * pixels against the same anchor as this row's right-hand run: the two swap,
 * and their SUM — which is all `panelInset` reports — is identical. Neither run
 * reads the other edge, so no ordering between them can leak in.
 *
 * The two runs are also never clipped against each other, so the sum is not
 * bounded by 1: a row of two flat tones reports essentially the whole width,
 * measured at 0.9967 on drawn art.
 *
 * This parted from the reference analyzer when #255 landed, and the reference
 * side has since adopted the same per-edge rule, so the two agree again — see
 * docs/CRAFT_MEASURE.md, "The loop this closes". The old convention anchored
 * both runs on the row's left-most pixel, and captures include full-bleed
 * pages, where the two read differently: a full-bleed gradient page measures
 * 0.0367 under it and 0.0750 under this rule. Both shipped `panelInset` ranges
 * were read under the old convention and were re-derived per edge (the table in
 * CRAFT_MEASURE.md carries the numbers).
 */
function rowMargins(row: Uint8ClampedArray, width: number): { left: number; right: number } {
  return { left: edgeRun(row, width, 1, 0), right: edgeRun(row, width, -1, width - 1) };
}

/**
 * The margin rule as it stood before #255: both runs anchored on the row's
 * LEFT-most pixel. Named, not inlined, so `git grep` finds both rules and no
 * reader has to work out which one a pair of bare arguments spells.
 *
 * Only `sampleColor` calls this, and it is the reference analyzer's own rule.
 * Nothing that reports geometry may use it — that is the defect #255 removed.
 */
function legacyLeftAnchoredMargins(
  row: Uint8ClampedArray,
  width: number,
): { left: number; right: number } {
  return { left: edgeRun(row, width, 1, 0), right: edgeRun(row, width, -1, 0) };
}

interface ColorSums {
  luminances: number[];
  saturations: number[];
  hues: number[];
}

/**
 * Sample colour from the panel INTERIOR only.
 *
 * This is the correction the reference analyzer records as its most important
 * one: sampling whole rows made every genre come back near-white, because an
 * inset panel leaves flat page background at both edges and the margin dominates
 * the average. Trimming each row's margins separated them immediately.
 *
 * The trim goes through `legacyLeftAnchoredMargins`: both runs on the row's
 * left-most pixel, the rule `rowMargins` carried before #255. It is kept for two
 * reasons, in this order.
 *
 * FIRST, it is one of the definitions this side is BUILT to share with the
 * reference analyzer, which anchors both runs on the left-most pixel. Moving
 * the trim on one side alone would end that. A band is a comparison between the
 * two sides, and every difference is a place that comparison leaks.
 *
 * SECOND, the re-basing cost, measured rather than guessed: anchoring the
 * right-hand run on the right-hand pixel moves `examples/dead-air` from 85.2 to
 * 86.0 mean luminance, 73.2 to 73.5 spread, 0.263 to 0.261 saturation and 159.2
 * to 156.8 hue, and the calm rhythm fixture from 209.6 to 210.4 and 0.173 to
 * 0.171.
 *
 * The cost of keeping it is real and is #257's: a reserved band on the right is
 * not recognised here, so its pixels are averaged into the palette, and the same
 * art measures a mean luminance of 76.4 with the band on the left and 110.0 with
 * it on the right.
 */
function sampleColor(ctx: SKRSContext2D, width: number, artRows: readonly number[]): ColorSums {
  const sums: ColorSums = { luminances: [], saturations: [], hues: [] };
  const stride = Math.max(1, Math.floor(artRows.length / COLOR_ROW_SAMPLES));
  for (let index = 0; index < artRows.length; index += stride) {
    const row = readRow(ctx, artRows[index] as number, width);
    const { left, right } = legacyLeftAnchoredMargins(row, width);
    const trimmed = left + right < width - 8;
    const from = trimmed ? left : 0;
    const to = trimmed ? width - right : width;
    for (let x = from; x < to; x += COLOR_PIXEL_STRIDE) {
      const i = x * 4;
      const r = row[i] as number;
      const g = row[i + 1] as number;
      const b = row[i + 2] as number;
      sums.luminances.push(luminance(r, g, b));
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      sums.saturations.push(max === 0 ? 0 : (max - min) / max);
      if (max === min) continue;
      // Hue in degrees, averaged linearly — the reference analyzer's own
      // definition. A linear mean of an angle is a bias indicator, not a
      // circular mean, but it is the number the reference band is stated in.
      if (max === r) sums.hues.push((60 * ((g - b) / (max - min)) + 360) % 360);
      else if (max === g) sums.hues.push(60 * ((b - r) / (max - min)) + 120);
      else sums.hues.push(60 * ((r - g) / (max - min)) + 240);
    }
  }
  return sums;
}

// --- The transition vocabulary ----------------------------------------------
//
// Everything above grades how much page is spent on empty space and how tall
// the runs are. None of it asks what is IN a gap — a band grades gutter heights
// and never looks at whether the gutter is page background, a black void, a
// mood field, or a card carrying a line. That is a separate convention of a
// work, and it is what a transition vocabulary declares.
//
// THIS SIDE READS THE DECLARED TYPE, NOT THE PIXELS, and the choice is
// deliberate. #236.
//
// The reference analyzer classifies a gap by its colour and by whether it
// carries content, because a capture is an image and has no metadata: flat and
// page-coloured is an empty gutter, flat under luminance 60 is a void, flat
// over saturation 0.18 is a colour field, content in the gap is a card. A toony
// episode does not have that problem. Every transition in the reading sequence
// declares its `type`, so the kind is read rather than inferred, and three
// things follow that a re-derivation from the composed page cannot give:
//
//   1. It is exact. The classifier is the part of this measurement that has
//      already been wrong in a way nothing caught: the reference side required
//      a flat row to be LIGHT as well as flat, which made `void` undetectable
//      by construction on a white-page work and reported 0% void for a whole
//      genre. Grading a pack against a re-derivation grades the classifier too.
//   2. It separates kinds a pixel rule cannot. `narration_card` and
//      `dialogue_card` are the same rectangle with different words in it, and a
//      `color_field` authored dark is a `void` to any luminance threshold.
//   3. It grades the PACK. A pack ships transition records; the art beside them
//      comes from a diffusion model. A page-derived mix would move with the art
//      — and `toony measure` already counts any flat region inside a panel as
//      page structure, so blank sky would arrive as extra empty gutter.
//
// What that costs, stated so a later reader does not have to find it out: this
// grades the SCRIPT, not the PAGE. A declared `void` whose band the renderer
// draws light is still counted here as a void. The geometry metrics above are
// the page-side check and they are read off pixels; these two sit side by side
// in one report precisely because neither one is the other.

/** One transition kind, as one episode uses it. */
export interface TransitionKindMix {
  kind: TransitionType;
  /** Gaps of this kind the episode draws. */
  count: number;
  /** Share of the episode's drawn gaps, 0..1. */
  share: number;
  /** Median drawn height of those gaps, as a share of the column width. */
  heightMedian: number;
  /**
   * Every one of those heights, in reading order, same unit.
   *
   * Carried rather than summarized because a vocabulary entry can cover several
   * kinds, and the height it grades is the median over their gaps POOLED. Built
   * from per-kind medians instead, that figure would weight a kind used once
   * exactly like a kind used thirty times. It is also the raw material for
   * authoring a range in the first place.
   */
  heights: number[];
}

/** Which kinds of gap an episode puts between its cuts, and how tall each runs. */
export interface TransitionMix {
  /** Transitions in the reading sequence that draw a gap. The share denominator. */
  gaps: number;
  /**
   * Transitions in the sequence that draw NOTHING. A plain gutter authored at
   * zero height composes no band at all, so it is not a gap: a share of the
   * gaps counting something with no extent is not the quantity the reference
   * measured, which counted gaps it could see.
   *
   * That is the rule, and it holds on the REFERENCE column, which is the column
   * the authored px mean something on and the one this is measured against. It
   * does not make the mix agree with every render: a gutter authored at 1px on
   * an 800px reference is a gap here and rounds away to nothing at `--width
   * 300`, so that page shows one fewer gap than the mix counts. Sub-pixel
   * gutters are the only case, and no column is the right one to privilege —
   * the reference column at least does not move with the export.
   *
   * Reported rather than dropped, for the same reason `cutsWithoutImage` is: an
   * episode whose transitions mostly vanish should not look like an episode
   * that has few of them.
   */
  undrawn: number;
  /** Every kind the episode draws, in `TRANSITION_TYPES` order. */
  kinds: TransitionKindMix[];
}

/**
 * Read an episode's transition vocabulary off its declared records.
 *
 * Heights go through `resolveBandHeight` — the shared function the export
 * canvas and the studio panel both size a band with — so what is measured is
 * the height the gap actually OCCUPIES, not the number that was typed. The two
 * differ: a card or a solid band authored below the legibility floor renders at
 * the floor, and grading the authored number would grade a height nobody sees.
 *
 * It is evaluated on the project's REFERENCE column, which is the column the
 * authored px mean something on. On any other column the same call returns the
 * same share of the width to within rounding, since both the scaled height and
 * the floor are proportional to it — so this number does not move with
 * `--width`, which is what makes it comparable to a range measured elsewhere.
 *
 * It takes the gaps IN READING ORDER rather than a bundle, because an episode is
 * not the only thing that has a reading order: a plan declares one before any
 * record exists (`./plan.ts`), and the two must be graded by one definition or a
 * plan's vocabulary verdict is a second implementation of this one. Pass
 * `sequencedTransitions(bundle)` for an episode.
 */
export function measureTransitionMix(
  transitions: readonly Transition[],
  referenceWidth: number,
): TransitionMix {
  const heights = new Map<TransitionType, number[]>();
  let gaps = 0;
  let undrawn = 0;
  for (const transition of transitions) {
    const drawn = resolveBandHeight(layoutTransition(transition), referenceWidth, referenceWidth);
    if (drawn <= 0) {
      undrawn++;
      continue;
    }
    gaps++;
    // Rounded ONCE, here. Everything downstream — the per-kind median below and
    // the pooled median a multi-kind entry is graded on — reads this same list,
    // so there is no second rounding for the two to disagree about.
    const height = round(drawn / referenceWidth, 4);
    const measured = heights.get(transition.type);
    if (measured === undefined) heights.set(transition.type, [height]);
    else measured.push(height);
  }
  const kinds: TransitionKindMix[] = [];
  for (const kind of TRANSITION_TYPES) {
    const measured = heights.get(kind);
    if (measured === undefined) continue;
    kinds.push({
      kind,
      count: measured.length,
      share: round(measured.length / gaps, 4),
      heightMedian: median(measured),
      heights: measured,
    });
  }
  return { gaps, undrawn, kinds };
}

/**
 * The transitions an episode's reading SEQUENCE reaches, in order.
 *
 * The sequence, not the record list: a transition the sequence never reaches is
 * not on the page, exactly as an unreferenced cut is not counted.
 */
export function sequencedTransitions(bundle: EpisodeBundle): Transition[] {
  const byId = new Map(bundle.transitions.map((transition) => [transition.id, transition]));
  const ordered: Transition[] = [];
  for (const item of bundle.episode.sequence) {
    if (item.type !== "transition") continue;
    const transition = byId.get(item.id);
    if (transition !== undefined) ordered.push(transition);
  }
  return ordered;
}

// --- The page's run structure -----------------------------------------------
//
// Everything from here to `measureEpisodeCraft` is the half of the measurement
// that reads a page's SHAPE: which rows are inter-panel space, which are panels,
// and what the run lengths come to. It is separated from the pixel reads around
// it for one reason — a plan has the same shape and no pixels (`./plan.ts`), and
// the ticket that asked for a plan-level grade asked for it to share this rule
// rather than restate it. Colour and `panelInset` stay in `measureEpisodeCraft`,
// because they are pixel reads and a plan has nothing to give them.

/** The five metrics a page's run structure alone decides. */
export const PAGE_GEOMETRY_METRIC_NAMES = [
  "gutterRatio",
  "gutterMedian",
  "panelHeightMedian",
  "panelHeightSpread",
  "panelsPerScreen",
] as const;

export type PageGeometryMetricName = (typeof PAGE_GEOMETRY_METRIC_NAMES)[number];

/** Those five metrics' values, with the same units `CraftMetrics` gives them. */
export type PageGeometryMetrics = Pick<CraftMetrics, PageGeometryMetricName>;

/** A page's runs after both floors have been applied. */
export interface PageRunStructure {
  /** Rows the page reads as inter-panel space. */
  gutterRows: number;
  /** Every gutter run, as a share of the width, in reading order. */
  gutterRuns: number[];
  /** Every panel run, as a share of the width, in reading order. */
  panelRuns: number[];
  /** The middle row of each panel run, in the same order — the row an inset is read on. */
  panelMiddleRows: number[];
  /** Non-flat runs too short to be panels, folded back into the gutter. */
  intrusions: number;
}

/**
 * Turn a page's per-row flat/not-flat flags into its run structure.
 *
 * `flags` is MUTATED in place: both floors work by reclassifying rows, and the
 * caller that has pixels reads its art rows off the same array afterwards, so
 * copying it would leave two answers to "which rows are art".
 *
 * Both floors are shares of the width. Nothing that decides which runs exist may
 * read the screen height, or the screen definition leaks into every metric
 * computed from the run set.
 */
export function classifyPageRows(flags: boolean[], width: number): PageRunStructure {
  const gutterMinRun = Math.max(2, Math.floor(width * GUTTER_MIN_RUN_FRACTION));
  const panelMinRun = Math.max(3, Math.floor(width * PANEL_MIN_RUN_FRACTION));

  // A flat run too short to be a reading pause is a seam inside the art.
  for (const run of runsOf(flags)) {
    if (!run.flat || run.length >= gutterMinRun) continue;
    for (let i = run.start; i < run.start + run.length; i++) flags[i] = false;
  }
  // A non-flat run too short to be a cut is something floating in the gutter:
  // fold it back into the gutter for rhythm and count it as its own signal.
  let intrusions = 0;
  for (const run of runsOf(flags)) {
    if (run.flat || run.length >= panelMinRun) continue;
    intrusions++;
    for (let i = run.start; i < run.start + run.length; i++) flags[i] = true;
  }

  const gutterRuns: number[] = [];
  const panelRuns: number[] = [];
  const panelMiddleRows: number[] = [];
  for (const run of runsOf(flags)) {
    // Normalize by WIDTH, matching the reference analyzer. Dividing by
    // screenHeight made these metrics scale inversely with --screen-aspect, so
    // the same page reported 0.28 at aspect 2 and 0.14 at aspect 4 — and neither
    // number was comparable to a reference band, which is expressed as a
    // multiple of column width. Only the per-screen counts may depend on the
    // screen definition.
    if (run.flat) {
      gutterRuns.push(run.length / width);
      continue;
    }
    panelRuns.push(run.length / width);
    panelMiddleRows.push(run.start + Math.floor(run.length / 2));
  }
  return {
    gutterRows: flags.reduce((count, flat) => (flat ? count + 1 : count), 0),
    gutterRuns,
    panelRuns,
    panelMiddleRows,
    intrusions,
  };
}

/** The five run-structure metrics, rounded exactly as the report carries them. */
export function pageGeometryMetrics(
  runs: PageRunStructure,
  height: number,
  screenHeight: number,
): PageGeometryMetrics {
  return {
    gutterRatio: round(runs.gutterRows / height, 4),
    gutterMedian: round(median(runs.gutterRuns), 4),
    panelHeightMedian: round(median(runs.panelRuns), 4),
    panelHeightSpread: round(stddev(runs.panelRuns), 4),
    panelsPerScreen: round(runs.panelRuns.length / (height / screenHeight), 2),
  };
}

/**
 * Measure one episode's craft signals from its rendered page.
 *
 * Renders through the same composition `toony export stitched` uses, so it needs
 * no prior export and no image provider, and the same episode always produces
 * the same numbers.
 */
export async function measureEpisodeCraft(
  root: string,
  episodeId: string,
  options: MeasureOptions = {},
): Promise<CraftMeasurement> {
  const screenAspect = options.screenAspect ?? DEFAULT_SCREEN_ASPECT;
  const stitched = await stitchEpisode(root, episodeId, options.width);
  const { canvas, width, height, bundle, project } = stitched;
  const ctx = canvas.getContext("2d");
  const screenHeight = Math.max(1, Math.round(width * screenAspect));

  const stats = rowStats(ctx, width, height);
  const flags = stats.map((row) => row.stddev < FLAT_ROW_STDDEV_MAX);
  // The run rule is shared with the plan-level grade (`./plan.ts`), which builds
  // the same flags by arithmetic. `flags` comes back reclassified by both floors,
  // so the art rows read below are the ones the runs were taken over.
  const runs = classifyPageRows(flags, width);

  const insets: number[] = [];
  for (const row of runs.panelMiddleRows) {
    const middle = readRow(ctx, row, width);
    const { left, right } = rowMargins(middle, width);
    insets.push((left + right) / width);
  }

  // Colour comes from the art rows; a page with no art at all (every row flat)
  // is sampled whole rather than left unmeasured.
  const artRows: number[] = [];
  for (let y = 0; y < height; y++) if (!flags[y]) artRows.push(y);
  const allRows = Array.from({ length: height }, (_, y) => y);
  const color = sampleColor(ctx, width, artRows.length > 0 ? artRows : allRows);
  const valueMean = mean(color.luminances);

  const cutsById = new Map(bundle.cuts.map((cut) => [cut.id, cut]));
  const readCuts = bundle.episode.sequence
    .filter((item) => item.type === "cut")
    .map((item) => cutsById.get(item.id))
    .filter((cut) => cut !== undefined);

  return {
    episodeId,
    width,
    height,
    screenAspect,
    screenHeight,
    cuts: readCuts.length,
    cutsWithoutImage: readCuts.filter(
      (cut) => (cut.image?.final ?? cut.image?.clean ?? null) === null,
    ).length,
    transitions: measureTransitionMix(
      sequencedTransitions(bundle),
      resolveReferenceWidth(project.webtoon.referenceWidth),
    ),
    metrics: {
      ...pageGeometryMetrics(runs, height, screenHeight),
      gutterIntrusionsPerScreen: round(runs.intrusions / (height / screenHeight), 2),
      panelInset: round(mean(insets), 4),
      valueMean: round(valueMean, 1),
      valueSpread: round(stddev(color.luminances), 1),
      saturationMean: round(mean(color.saturations), 3),
      hueBias: color.hues.length > 0 ? round(mean(color.hues), 1) : null,
    },
  };
}

// --- Band files -------------------------------------------------------------
//
// A band is the target an episode is graded against: a per-metric range a pack
// was built to hit. It is DATA, validated the same way a pack manifest is — a
// strict allowlist at every level, so an unknown key is a rejection rather than
// something quietly ignored.

/** The format version a band file must declare. */
export const CRAFT_BAND_FORMAT_VERSION = 1;

/** An inclusive range for one metric. At least one end must be given. */
export interface CraftBandRange {
  min?: number;
  max?: number;
}

/**
 * How the pages behind one studied work were captured.
 *
 * `contiguous` is every frame of an episode, in order; `sampled` is a subset.
 * The distinction is not bookkeeping: a median over run heights is read off
 * whole regions of a page, so dropping part of an episode moves it by more than
 * the differences such medians are used to argue about, and nothing in the
 * measured numbers themselves says which kind of capture produced them.
 */
export const CRAFT_CAPTURE_MODES = ["contiguous", "sampled"] as const;

export type CraftCaptureMode = (typeof CRAFT_CAPTURE_MODES)[number];

/**
 * One studied work a band was measured from, and how it was captured.
 *
 * The capture facts sit HERE rather than on the provenance, because they are
 * facts about a capture and a band can hold several. A band whose two works were
 * captured differently would otherwise have to state one answer and be wrong
 * about one of them — silently, since neither fact is visible in the numbers.
 *
 * The work is named by a NEUTRAL LABEL and nothing else. There is deliberately
 * no field for a title, for the place the pages came from, or for a link: a band
 * ships inside a pack, and a field that invites one of those is how one gets
 * published. The label is the operator's own handle for the work, the counts say
 * how much of it was measured, and that is the whole of what a grader needs.
 */
export interface CraftBandWork {
  /** The neutral label the work is studied under, e.g. "thriller work C". */
  label: string;
  /** Episodes of this work that were measured. */
  episodes: number;
  captureMode: CraftCaptureMode;
  /**
   * Whether every page captured from this work was the same column width. Every
   * run length in this measurement is a share of the width, so a capture set
   * with mixed widths normalizes each page by a different number and inflates
   * lengths across the set without any single number looking wrong.
   */
  constantColumnWidth: boolean;
  /** Language of the captured pages, as a short tag ("eng", "ko", "ko-KR"). */
  language?: string;
  /**
   * How much page this work contributed, as ONE extent in column widths —
   * summed episode height over column width. It is the sample size behind every
   * median in the band, and works differ in it by a factor of four at the same
   * episode count.
   */
  pageLengthInWidths?: number;
}

/** Where a band's numbers came from: the works, each with its own capture facts. */
export interface CraftBandProvenance {
  works: CraftBandWork[];
}

/**
 * One entry of a transition vocabulary: a set of transition kinds, the share of
 * the episode's gaps they take between them, and optionally how tall they run.
 *
 * The kinds are a SET rather than one name because that is the granularity the
 * reference was measured at. A capture is classified by colour and content, and
 * a card is a card — nothing in a captured page says whether its words are
 * narration or dialogue. An entry per schema name would force a pack to invent
 * a split between `narration_card` and `dialogue_card` that was never measured,
 * which is the exact defect this ticket exists to remove. A single-kind entry is
 * the same thing with a set of one.
 *
 * Every name is selected from `TRANSITION_TYPES`; a band can no more add a
 * transition kind than a pack can add an export engine. An entry has no name of
 * its own, so nothing here introduces vocabulary the core does not already have
 * — the report prints the kinds it covers.
 *
 * `share` is REQUIRED and `height` is not. A height range says how tall a gap of
 * these kinds runs WHEN ONE OCCURS and says nothing when none does, so an entry
 * carrying only a height range grades nothing at all against an episode that
 * uses none of its kinds. Requiring the share forces the band to STATE how
 * often, so zero is an answer the band gave rather than one it never addressed.
 *
 * It forces a range, not a floor: `{ "max": 0.3 }` is a share range and is
 * satisfied by zero of the kind. A band that means "this kind must appear"
 * writes a minimum; this rule only guarantees there is somewhere it could have.
 */
export interface TransitionVocabularyEntry {
  /** The transition kinds this entry covers, from `TRANSITION_TYPES`. */
  kinds: TransitionType[];
  /** Combined share of the episode's drawn gaps, 0..1. */
  share: CraftBandRange;
  /** Median drawn height of those gaps, in column widths. */
  height?: CraftBandRange;
}

/**
 * A target band: per-metric ranges, plus the screen the numbers assume.
 *
 * `metrics` is what the band GRADES. `recorded` is what it measured and chose
 * not to grade — kept because deleting a range that should not decide a verdict
 * also throws away the only record of what was measured.
 *
 * `transitionVocabulary` grades what is IN the gaps the geometry above measures
 * the size of. It lives on the band, and not on the pack manifest or on a genre
 * entry, because it is a GRADING TARGET measured from the same episodes of the
 * same work as `metrics`, over which `provenance` already makes one statement.
 */
export interface CraftBand {
  bandFormat: number;
  name?: string;
  /** Screen aspect the band was measured at; the measurement adopts it. */
  screenAspect?: number;
  metrics: Partial<Record<CraftMetricName, CraftBandRange>>;
  /** Measured ranges the band keeps but never grades against. */
  recorded?: Partial<Record<CraftMetricName, CraftBandRange>>;
  /** Which kinds of gap the work uses, in what proportion, at what heights. */
  transitionVocabulary?: TransitionVocabularyEntry[];
  provenance?: CraftBandProvenance;
}

/** One metric's verdict against the band. */
export interface CraftMetricVerdict {
  metric: CraftMetricName;
  value: number | null;
  min: number | null;
  max: number | null;
  inBand: boolean;
}

/**
 * One metric the band records without grading: the measured range beside the
 * value, and NO verdict field — a recorded metric cannot be summed into a
 * verdict by a caller that forgot the difference, because it carries none.
 */
export interface CraftRecordedMetric {
  metric: CraftMetricName;
  value: number | null;
  min: number | null;
  max: number | null;
}

/** One declared range of a vocabulary entry, measured and graded. */
export interface TransitionRangeVerdict {
  /** The measured figure. */
  value: number;
  min: number | null;
  max: number | null;
  inBand: boolean;
}

/**
 * A declared height range with no gap of its kinds to measure.
 *
 * It carries NO `inBand` field, which is the same device `CraftRecordedMetric`
 * uses: a reader diffing two reports cannot mistake "there was nothing to
 * grade" for "it passed", because there is no verdict to read. The text report
 * carried that distinction from the start and `--json` did not, so a consumer
 * comparing reports read a `true` as a pass.
 *
 * A height range grades the gaps that occur, and whether zero of them is
 * acceptable was already decided by `share`. That is why this is not the
 * `hueBias` case, where a null value FAILS: a page with no colour at all is a
 * degenerate page and the metric was measurable in principle, while using none
 * of a kind is an ordinary authoring outcome another range already grades.
 */
export interface TransitionRangeUngraded {
  value: null;
  min: number | null;
  max: number | null;
  /** Always false. Present so the two shapes are told apart by a field, not by a type. */
  graded: false;
}

/** One vocabulary entry's verdict: the kinds it covers, and what they did. */
export interface TransitionVocabularyVerdict {
  /** The kinds this entry covers, as the band listed them. */
  kinds: TransitionType[];
  /** Gaps of those kinds the episode drew. */
  count: number;
  share: TransitionRangeVerdict;
  /**
   * The height verdict: `null` when the entry declares no height range, and a
   * `TransitionRangeUngraded` when it declares one that no gap can be measured
   * against. Only the graded shape carries `inBand`.
   */
  height: TransitionRangeVerdict | TransitionRangeUngraded | null;
  inBand: boolean;
}

/** The full comparison: every graded metric, what was only recorded, the verdict. */
export interface CraftBandReport {
  name: string | null;
  inBand: boolean;
  metrics: CraftMetricVerdict[];
  recorded: CraftRecordedMetric[];
  /** Per vocabulary entry, in the order the band declared them. */
  transitions: TransitionVocabularyVerdict[];
  provenance: CraftBandProvenance | null;
}

const BAND_KEYS = [
  "bandFormat",
  "name",
  "screenAspect",
  "metrics",
  "recorded",
  "transitionVocabulary",
  "provenance",
] as const;
const VOCABULARY_ENTRY_KEYS = ["kinds", "share", "height"] as const;
const RANGE_KEYS = ["min", "max"] as const;
const PROVENANCE_KEYS = ["works"] as const;
const WORK_KEYS = [
  "label",
  "episodes",
  "captureMode",
  "constantColumnWidth",
  "language",
  "pageLengthInWidths",
] as const;

/**
 * A work label carries a link or a domain. Either one names the source the pages
 * came from, which is exactly what this field must not hold.
 *
 * This is a BACKSTOP, not a guarantee. It catches the obvious forms and misses
 * an IP address, an internationalized host, and any of the ways a domain can be
 * written to get past a pattern. The guarantee is structural and sits elsewhere:
 * no field exists for a source, so there is nowhere one belongs.
 */
const LABEL_LINK_PATTERN = /:\/\/|[A-Za-z0-9-]\.[A-Za-z]{2,}/;

/**
 * Anything a terminal reads as more than one line, or as a control sequence.
 *
 * A band's free text is printed straight into the report, so a label carrying a
 * newline can forge a verdict line above the real one. C0, DEL and C1 are all
 * refused: none of them belongs in a label or a band name. So are the Unicode
 * line separators, which anything that splits text the Unicode way reads as a
 * line break even where a terminal does not, and the bidi overrides, which
 * reverse the rest of a printed line.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

/**
 * A language tag as the docs promise it: a primary alpha tag, an optional
 * four-letter script, an optional region. Free subtags are not accepted —
 * an open-ended tail is room for a source shorthand to ride into a pack.
 */
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/;

/** Longest a band name or a work label may be. Both are printed in the report. */
const BAND_TEXT_MAX_LENGTH = 80;

/** Most works one band may list: far above any real study, far below a flood. */
const BAND_WORKS_MAX = 100;

/** Most episodes one work may declare. Above the longest work anyone publishes. */
const WORK_EPISODES_MAX = 10000;

/** Longest page extent one work may declare, in column widths. */
const WORK_PAGE_LENGTH_MAX = 1000000;

/**
 * Tallest gap a vocabulary entry may name, in column widths.
 *
 * Derived, not chosen: a gutter height is at most `GUTTER_HEIGHT_MAX_PX` and a
 * reference column is at least one pixel, so no episode can ever draw a gap
 * taller than this. A range above it grades every render OUT.
 */
const TRANSITION_HEIGHT_MAX = GUTTER_HEIGHT_MAX_PX;

function allowlistKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  what: string,
  c: IssueCollector,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    c.add(
      joinPath(path, key),
      "band.unexpected-field",
      `${what} allows only ${allowed.map((k) => `"${k}"`).join(", ")}; remove unexpected field "${key}".`,
    );
  }
}

/**
 * Text a band carries that the report prints verbatim.
 *
 * One line, bounded length. Without this a label of `work A\nverdict: IN BAND`
 * validates and prints a forged verdict above the real one — the report is
 * plain lines, so anything that can hold a newline can write one.
 */
function isBandText(value: unknown): value is string {
  return isString(value) && value.length <= BAND_TEXT_MAX_LENGTH && !hasControlCharacter(value);
}

function validateRange(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "band.range.type", "a metric range must be an object with min and/or max.");
    return;
  }
  allowlistKeys(value, RANGE_KEYS, path, "a metric range", c);
  const hasMin = value.min !== undefined;
  const hasMax = value.max !== undefined;
  if (!hasMin && !hasMax) {
    c.add(path, "band.range.empty", "a metric range must declare min, max, or both.");
    return;
  }
  if (hasMin && !isFiniteNumber(value.min)) {
    c.add(joinPath(path, "min"), "band.range.min", "min must be a finite number.");
  }
  if (hasMax && !isFiniteNumber(value.max)) {
    c.add(joinPath(path, "max"), "band.range.max", "max must be a finite number.");
  }
  if (
    isFiniteNumber(value.min) &&
    isFiniteNumber(value.max) &&
    (value.min as number) > (value.max as number)
  ) {
    c.add(path, "band.range.order", `min ${value.min} is greater than max ${value.max}.`);
  }
}

/**
 * Validate the metrics a band records without grading.
 *
 * `graded` is the band's own `metrics`, so a metric claimed on both sides is a
 * rejection: a band that both grades and records one metric says two different
 * things about whether it decides the verdict.
 */
function validateRecorded(
  value: unknown,
  graded: Record<string, unknown>,
  c: IssueCollector,
): void {
  const path = "band.recorded";
  if (!isPlainObject(value)) {
    c.add(path, "band.recorded.type", "recorded must be an object of metric ranges.");
    return;
  }
  if (Object.keys(value).length === 0) {
    c.add(path, "band.recorded.empty", "recorded must keep at least one metric, or be left out.");
  }
  for (const [key, range] of Object.entries(value)) {
    const keyPath = joinPath(path, key);
    if (!(CRAFT_METRIC_NAMES as readonly string[]).includes(key)) {
      c.add(
        keyPath,
        "band.metric.unknown",
        `"${key}" is not a measured metric; expected one of: ${CRAFT_METRIC_NAMES.join(", ")}.`,
      );
      continue;
    }
    if (Object.hasOwn(graded, key)) {
      c.add(
        keyPath,
        "band.recorded.graded",
        `"${key}" is already graded in metrics; a metric is graded or recorded, never both.`,
      );
    }
    validateRange(range, keyPath, c);
  }
}

/**
 * A range whose ends must also sit inside `[lo, hi]`.
 *
 * A share outside 0..1 and a negative height are not tight targets, they are
 * typos: nothing an episode can measure reaches them, so the band would grade
 * every render OUT and say nothing about why.
 */
function validateBoundedRange(
  value: unknown,
  path: string,
  code: string,
  lo: number,
  hi: number,
  what: string,
  c: IssueCollector,
): void {
  validateRange(value, path, c);
  if (!isPlainObject(value)) return;
  for (const end of RANGE_KEYS) {
    const bound = value[end];
    if (bound === undefined || !isFiniteNumber(bound)) continue;
    if ((bound as number) < lo || (bound as number) > hi) {
      c.add(joinPath(path, end), code, `${what} ${end} must be between ${lo} and ${hi}.`);
    }
  }
}

/**
 * Validate the transition vocabulary: which kinds, in what proportion, at what
 * heights.
 *
 * A kind belongs to at most ONE entry across the whole vocabulary. Two entries
 * claiming the same kind would each count the same gaps, so the shares would sum
 * past what the episode has and no reader could say what either verdict meant.
 *
 * Kinds NO entry claims are legal and are deliberately not an error: a band
 * grades what it declares, exactly as `metrics` does. Their gaps still count in
 * the denominator, because the share the reference measured is a share of all
 * the work's gaps, not of the ones it happened to name.
 */
function validateTransitionVocabulary(value: unknown, c: IssueCollector): void {
  const path = "band.transitionVocabulary";
  if (!isArray(value)) {
    c.add(
      path,
      "band.transitions.type",
      "transitionVocabulary must be an array of transition-kind entries.",
    );
    return;
  }
  if (value.length === 0) {
    c.add(
      path,
      "band.transitions.empty",
      "transitionVocabulary must declare at least one entry, or be left out.",
    );
    return;
  }
  // One entry per kind at most, so the vocabulary cannot be longer than the
  // vocabulary the core has. Reported and then carried on: returning here would
  // suppress every other diagnostic on the band, so one extra entry would hide
  // an unknown kind name and a malformed range behind a length complaint.
  if (value.length > TRANSITION_TYPES.length) {
    c.add(
      path,
      "band.transitions.count",
      `a vocabulary may declare at most ${TRANSITION_TYPES.length} entries; this one declares ${value.length}.`,
    );
  }
  const claimed = new Set<string>();
  let shareFloor = 0;
  let shareCeiling = 0;
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = joinPath(path, i);
    if (!isPlainObject(entry)) {
      c.add(entryPath, "band.transitions.entry.type", "a vocabulary entry must be an object.");
      continue;
    }
    allowlistKeys(entry, VOCABULARY_ENTRY_KEYS, entryPath, "a vocabulary entry", c);
    validateVocabularyKinds(entry.kinds, joinPath(entryPath, "kinds"), claimed, c);
    if (entry.share === undefined) {
      c.add(
        joinPath(entryPath, "share"),
        "band.transitions.share.required",
        "a vocabulary entry must declare a share range: a height range grades the gaps that occur, and only a share says whether zero of them is allowed.",
      );
    } else {
      const sharePath = joinPath(entryPath, "share");
      validateBoundedRange(entry.share, sharePath, "band.transitions.share", 0, 1, "share", c);
      if (isPlainObject(entry.share)) {
        // An absent end does not bind, so it contributes the widest thing it
        // could be: nothing to the floor, a whole episode to the ceiling.
        shareFloor += isFiniteNumber(entry.share.min) ? (entry.share.min as number) : 0;
        shareCeiling += isFiniteNumber(entry.share.max) ? (entry.share.max as number) : 1;
      }
    }
    if (entry.height !== undefined) {
      validateBoundedRange(
        entry.height,
        joinPath(entryPath, "height"),
        "band.transitions.height",
        0,
        TRANSITION_HEIGHT_MAX,
        "height",
        c,
      );
    }
  }
  // Shares are shares of ONE episode's gaps, so ranges that cannot add to 1
  // describe an episode that does not exist. A band no episode can pass is a
  // defect in the band, and it is invisible entry by entry.
  //
  // Both ends are compared at the precision the verdict is decided at.
  // `compareToTransitionVocabulary` rounds a measured share to four places, and
  // a floor summed in raw doubles does not: 0.197 + 0.687 + 0.116 is
  // 1.0000000000000002, which would refuse a band an episode satisfies exactly
  // — and refuse it with a message that rounds for display and so contradicts
  // the test that produced it.
  const floor = round(shareFloor, 4);
  if (floor > 1) {
    c.add(
      path,
      "band.transitions.unsatisfiable",
      `the declared share minimums add up to ${floor}; no episode can be more than 1 of its own gaps.`,
    );
  }
  // The ceiling only decides anything when the entries between them claim EVERY
  // kind: then every gap the episode can draw falls in some entry, the shares
  // must add to exactly 1, and a set of maxima adding to less than 1 grades
  // every episode out. With a kind left unclaimed the remainder has somewhere
  // to go, and no sum of maxima is impossible.
  const ceiling = round(shareCeiling, 4);
  if (claimed.size === TRANSITION_TYPES.length && ceiling < 1) {
    c.add(
      path,
      "band.transitions.unsatisfiable",
      `these entries claim every transition kind, so their shares must add up to 1, and the declared maximums add up to only ${ceiling}.`,
    );
  }
}

/** Validate one entry's kind list against the schema's own vocabulary. */
function validateVocabularyKinds(
  value: unknown,
  path: string,
  claimed: Set<string>,
  c: IssueCollector,
): void {
  if (!isArray(value) || value.length === 0) {
    c.add(
      path,
      "band.transitions.kinds",
      "kinds must be a non-empty array of transition kind names.",
    );
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const kind = value[i];
    const kindPath = joinPath(path, i);
    if (!isString(kind) || !(TRANSITION_TYPES as readonly string[]).includes(kind)) {
      c.add(
        kindPath,
        "band.transitions.kind.unknown",
        `"${String(kind)}" is not a transition kind; expected one of: ${TRANSITION_TYPES.join(", ")}. A band selects from the core's vocabulary and never extends it.`,
      );
      continue;
    }
    if (claimed.has(kind)) {
      c.add(
        kindPath,
        "band.transitions.kind.duplicate",
        `transition kind "${kind}" is already claimed by another entry; a kind belongs to one entry, or its gaps would be counted twice.`,
      );
      continue;
    }
    claimed.add(kind);
  }
}

function validateProvenanceWork(
  value: unknown,
  path: string,
  labels: Set<string>,
  c: IssueCollector,
): void {
  if (!isPlainObject(value)) {
    c.add(path, "band.provenance.work.type", "a studied work must be an object.");
    return;
  }
  allowlistKeys(value, WORK_KEYS, path, "a studied work", c);
  if (!isBandText(value.label) || value.label.length === 0) {
    c.add(
      joinPath(path, "label"),
      "band.provenance.work.label",
      `label must be one line of 1 to ${BAND_TEXT_MAX_LENGTH} characters: the neutral label the work is studied under.`,
    );
  } else if (LABEL_LINK_PATTERN.test(value.label)) {
    c.add(
      joinPath(path, "label"),
      "band.provenance.work.label.link",
      "label must be a neutral label, not a link or a domain.",
    );
  } else if (labels.has(value.label)) {
    c.add(
      joinPath(path, "label"),
      "band.provenance.work.duplicate",
      `duplicate work label "${value.label}" in this band.`,
    );
  } else {
    labels.add(value.label);
  }
  if (!isInteger(value.episodes) || value.episodes < 1 || value.episodes > WORK_EPISODES_MAX) {
    c.add(
      joinPath(path, "episodes"),
      "band.provenance.work.episodes",
      `episodes must be a whole number from 1 to ${WORK_EPISODES_MAX}.`,
    );
  }
  // Both capture facts are required, not optional detail: each one was invisible
  // in the measured numbers and each one silently moved them.
  if (
    !isString(value.captureMode) ||
    !(CRAFT_CAPTURE_MODES as readonly string[]).includes(value.captureMode)
  ) {
    c.add(
      joinPath(path, "captureMode"),
      "band.provenance.capture",
      `captureMode must be one of: ${CRAFT_CAPTURE_MODES.join(", ")}.`,
    );
  }
  if (!isBoolean(value.constantColumnWidth)) {
    c.add(
      joinPath(path, "constantColumnWidth"),
      "band.provenance.column-width",
      "constantColumnWidth must be true or false: whether every page captured from this work was one column width.",
    );
  }
  if (
    value.language !== undefined &&
    !(isString(value.language) && LANGUAGE_TAG_PATTERN.test(value.language))
  ) {
    c.add(
      joinPath(path, "language"),
      "band.provenance.work.language",
      'language must be a language tag: a primary tag, an optional script, an optional region ("ko", "eng", "ko-Hang-KR").',
    );
  }
  if (
    value.pageLengthInWidths !== undefined &&
    !(
      isFiniteNumber(value.pageLengthInWidths) &&
      value.pageLengthInWidths > 0 &&
      value.pageLengthInWidths <= WORK_PAGE_LENGTH_MAX
    )
  ) {
    c.add(
      joinPath(path, "pageLengthInWidths"),
      "band.provenance.work.page-widths",
      `pageLengthInWidths must be a number greater than 0 and at most ${WORK_PAGE_LENGTH_MAX}: how much page was measured, in column widths.`,
    );
  }
}

/** Validate what a band says it was measured from. */
function validateProvenance(value: unknown, c: IssueCollector): void {
  const path = "band.provenance";
  if (!isPlainObject(value)) {
    c.add(path, "band.provenance.type", "provenance must be an object.");
    return;
  }
  allowlistKeys(value, PROVENANCE_KEYS, path, "band provenance", c);
  const worksPath = joinPath(path, "works");
  if (!isArray(value.works)) {
    c.add(worksPath, "band.provenance.works.type", "works must be an array of studied works.");
    return;
  }
  if (value.works.length === 0) {
    c.add(worksPath, "band.provenance.works.empty", "provenance must name at least one work.");
  }
  if (value.works.length > BAND_WORKS_MAX) {
    c.add(
      worksPath,
      "band.provenance.works.count",
      `a band may list at most ${BAND_WORKS_MAX} works; this one lists ${value.works.length}.`,
    );
    return;
  }
  const labels = new Set<string>();
  for (let i = 0; i < value.works.length; i++) {
    validateProvenanceWork(value.works[i], joinPath(worksPath, i), labels, c);
  }
}

/** Validate a parsed band file. Never throws. */
export function validateCraftBandValue(value: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isPlainObject(value)) {
    c.add("band", "band.type", "a band file must be a JSON object.");
    return c.result();
  }
  allowlistKeys(value, BAND_KEYS, "band", "a band file", c);
  if (value.bandFormat !== CRAFT_BAND_FORMAT_VERSION) {
    c.add(
      "band.bandFormat",
      "band.format-version",
      `bandFormat must be ${CRAFT_BAND_FORMAT_VERSION}.`,
    );
  }
  // The name is printed in the verdict line, so it is held to the same rule a
  // work label is: one line, bounded. A newline here forges a verdict too.
  if (value.name !== undefined && (!isBandText(value.name) || value.name.length === 0)) {
    c.add(
      "band.name",
      "band.name",
      `name must be one line of 1 to ${BAND_TEXT_MAX_LENGTH} characters.`,
    );
  }
  if (value.screenAspect !== undefined) {
    if (!isFiniteNumber(value.screenAspect) || (value.screenAspect as number) <= 0) {
      c.add(
        "band.screenAspect",
        "band.screen-aspect",
        "screenAspect must be a positive finite number.",
      );
    }
  }
  // A band still has to GRADE something: recording metrics is an addition to a
  // target, never a way to ship one that decides nothing.
  if (!isPlainObject(value.metrics)) {
    c.add("band.metrics", "band.metrics.type", "metrics must be an object of metric ranges.");
  } else {
    const metrics = value.metrics;
    if (Object.keys(metrics).length === 0) {
      c.add("band.metrics", "band.metrics.empty", "a band must grade at least one metric.");
    }
    for (const [key, range] of Object.entries(metrics)) {
      const path = joinPath("band.metrics", key);
      if (!(CRAFT_METRIC_NAMES as readonly string[]).includes(key)) {
        c.add(
          path,
          "band.metric.unknown",
          `"${key}" is not a measured metric; expected one of: ${CRAFT_METRIC_NAMES.join(", ")}.`,
        );
        continue;
      }
      validateRange(range, path, c);
    }
  }
  if (value.recorded !== undefined) {
    validateRecorded(value.recorded, isPlainObject(value.metrics) ? value.metrics : {}, c);
  }
  if (value.transitionVocabulary !== undefined) {
    validateTransitionVocabulary(value.transitionVocabulary, c);
  }
  if (value.provenance !== undefined) validateProvenance(value.provenance, c);
  return c.result();
}

/**
 * Narrow an already-validated band value. Only call after validation passed.
 *
 * Every nested value is carried across whole, exactly as `metrics` is. Copying
 * provenance field by field would mean a field added to the allowlist and the
 * docs later validates, round-trips through a band file, and then disappears
 * here with nothing failing.
 */
export function asCraftBand(value: Record<string, unknown>): CraftBand {
  return {
    bandFormat: value.bandFormat as number,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.screenAspect === "number" ? { screenAspect: value.screenAspect } : {}),
    metrics: value.metrics as CraftBand["metrics"],
    ...(isPlainObject(value.recorded) ? { recorded: value.recorded as CraftBand["recorded"] } : {}),
    ...(isArray(value.transitionVocabulary)
      ? { transitionVocabulary: value.transitionVocabulary as TransitionVocabularyEntry[] }
      : {}),
    ...(isPlainObject(value.provenance)
      ? { provenance: value.provenance as unknown as CraftBandProvenance }
      : {}),
  };
}

/** Is `value` inside `range`? A range end the band left out does not bind. */
function within(value: number, range: CraftBandRange): boolean {
  return (
    (range.min === undefined || value >= range.min) &&
    (range.max === undefined || value <= range.max)
  );
}

/**
 * Grade one episode's transition mix against a declared vocabulary.
 *
 * An entry's share is the combined share of ALL the gaps the episode drew, not
 * of the gaps its own kinds account for: a work that is four fifths empty gutter
 * is four fifths empty gutter whether or not the band bothered to name the rest.
 * Kinds no entry claims therefore still count in the denominator, and they are
 * visible in the measured mix beside this.
 */
export function compareToTransitionVocabulary(
  mix: TransitionMix,
  vocabulary: readonly TransitionVocabularyEntry[],
): TransitionVocabularyVerdict[] {
  const byKind = new Map(mix.kinds.map((kind) => [kind.kind, kind]));
  return vocabulary.map((entry) => {
    const covered = entry.kinds
      .map((kind) => byKind.get(kind))
      .filter((kind) => kind !== undefined);
    const count = covered.reduce((sum, kind) => sum + kind.count, 0);
    const share = round(mix.gaps === 0 ? 0 : count / mix.gaps, 4);
    const shareVerdict: TransitionRangeVerdict = {
      value: share,
      min: entry.share.min ?? null,
      max: entry.share.max ?? null,
      inBand: within(share, entry.share),
    };
    let height: TransitionRangeVerdict | TransitionRangeUngraded | null = null;
    if (entry.height !== undefined) {
      // The median over the entry's kinds POOLED — the same figure the reference
      // read off a page, which never knew which of two card kinds it was looking
      // at. Taken over the per-kind medians instead it would weight a kind used
      // once exactly like a kind used thirty times.
      const heights = covered.flatMap((kind) => kind.heights);
      const min = entry.height.min ?? null;
      const max = entry.height.max ?? null;
      if (heights.length === 0) {
        height = { value: null, min, max, graded: false };
      } else {
        const measured = median(heights);
        height = { value: measured, min, max, inBand: within(measured, entry.height) };
      }
    }
    return {
      kinds: [...entry.kinds],
      count,
      share: shareVerdict,
      height,
      // An ungraded height carries no verdict, so it contributes none: the
      // share range above has already graded whether zero gaps was allowed.
      inBand: shareVerdict.inBand && (height === null || !("inBand" in height) || height.inBand),
    };
  });
}

/**
 * Grade a measured episode against a band. Only the metrics the band GRADES are
 * graded; a metric with no measurable value (an episode with no colour at all
 * has no hue) can never be inside a declared range, so it fails rather than
 * passing by absence.
 *
 * A recorded metric is measured against nothing. Its value and the range the
 * band measured are reported side by side, and the verdict is computed from
 * `verdicts` and the vocabulary alone — the recorded list is never read for it,
 * and its entries carry no verdict to read.
 *
 * This takes the whole MEASUREMENT rather than its metrics, and that is load
 * bearing: a band may declare a transition vocabulary, and a caller that could
 * hand over the metrics alone would grade such a band against nothing and pass
 * it. There is no shape of this function that can silently skip the vocabulary.
 */
export function compareToCraftBand(
  measured: Pick<CraftMeasurement, "metrics" | "transitions">,
  band: CraftBand,
): CraftBandReport {
  const { metrics } = measured;
  const verdicts: CraftMetricVerdict[] = [];
  const recorded: CraftRecordedMetric[] = [];
  for (const name of CRAFT_METRIC_NAMES) {
    const range = band.metrics[name];
    if (range !== undefined) {
      const value = metrics[name];
      const min = range.min ?? null;
      const max = range.max ?? null;
      const inBand = value !== null && within(value, range);
      verdicts.push({ metric: name, value, min, max, inBand });
    }
    const kept = band.recorded?.[name];
    if (kept !== undefined) {
      recorded.push({
        metric: name,
        value: metrics[name],
        min: kept.min ?? null,
        max: kept.max ?? null,
      });
    }
  }
  const transitions = compareToTransitionVocabulary(
    measured.transitions,
    band.transitionVocabulary ?? [],
  );
  return {
    name: band.name ?? null,
    inBand:
      verdicts.every((verdict) => verdict.inBand) && transitions.every((verdict) => verdict.inBand),
    metrics: verdicts,
    recorded,
    transitions,
    provenance: band.provenance ?? null,
  };
}
