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
import {
  IssueCollector,
  isArray,
  isBoolean,
  isFiniteNumber,
  isInteger,
  isPlainObject,
  isString,
  joinPath,
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
 * The reference additionally requires a flat row to be LIGHT (close to the
 * lightest row on the page), because a Korean webtoon page sets its panels on
 * white. THIS IS THE ONE PLACE THE TWO SIDES DIFFER. Toony transitions are
 * authored colour fields that are usually dark, so keeping that clause makes the
 * gutter metric blind to the very knob it exists to grade: on
 * `examples/dead-air` it reports a 0.0 gutter ratio and one panel spanning the
 * whole episode, at every flatness threshold. Dropping it moves the reference
 * captures' own numbers by at most 0.006 of the gutter ratio and changes none of
 * their genre conclusions, so "flat" alone is the definition both sides share.
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

/** Per-channel tolerance for "this pixel matches the row's edge colour". */
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
  /** Share of the width left as flat margin at a panel's edges. */
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
 */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

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

/** Lower median, matching the reference analyzer's `sorted(xs)[len(xs) // 2]`. */
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

function round(value: number, digits: number): number {
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
 * How many pixels at each edge of a row match its outermost pixel — the flat page
 * margin an inset panel leaves beside the art.
 */
function rowMargins(row: Uint8ClampedArray, width: number): { left: number; right: number } {
  const matches = (x: number): boolean => {
    const i = x * 4;
    for (let c = 0; c < 3; c++) {
      if (Math.abs((row[i + c] as number) - (row[c] as number)) >= EDGE_MATCH_TOLERANCE) {
        return false;
      }
    }
    return true;
  };
  let left = 0;
  while (left < width && matches(left)) left++;
  let right = 0;
  while (right < width && matches(width - 1 - right)) right++;
  return { left, right };
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
 */
function sampleColor(ctx: SKRSContext2D, width: number, artRows: readonly number[]): ColorSums {
  const sums: ColorSums = { luminances: [], saturations: [], hues: [] };
  const stride = Math.max(1, Math.floor(artRows.length / COLOR_ROW_SAMPLES));
  for (let index = 0; index < artRows.length; index += stride) {
    const row = readRow(ctx, artRows[index] as number, width);
    const { left, right } = rowMargins(row, width);
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
  const { canvas, width, height, bundle } = stitched;
  const ctx = canvas.getContext("2d");
  const screenHeight = Math.max(1, Math.round(width * screenAspect));
  // Both floors are shares of the width. Nothing that decides which runs exist
  // may read screenHeight, or the screen definition leaks into every metric
  // computed from the run set.
  const gutterMinRun = Math.max(2, Math.floor(width * GUTTER_MIN_RUN_FRACTION));
  const panelMinRun = Math.max(3, Math.floor(width * PANEL_MIN_RUN_FRACTION));

  const stats = rowStats(ctx, width, height);
  const flags = stats.map((row) => row.stddev < FLAT_ROW_STDDEV_MAX);
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

  const gutterRows = flags.reduce((count, flat) => (flat ? count + 1 : count), 0);
  const gutterRuns: number[] = [];
  const panelRuns: number[] = [];
  const insets: number[] = [];
  for (const run of runsOf(flags)) {
    if (run.flat) {
      // Normalize by WIDTH, matching the reference analyzer. Dividing by
      // screenHeight made these two metrics scale inversely with --screen-aspect,
      // so the same page reported 0.28 at aspect 2 and 0.14 at aspect 4 — and
      // neither number was comparable to a reference band, which is expressed as
      // a multiple of column width. Only the per-screen counts below may depend
      // on the screen definition.
      gutterRuns.push(run.length / width);
      continue;
    }
    panelRuns.push(run.length / width);
    const middle = readRow(ctx, run.start + Math.floor(run.length / 2), width);
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
    metrics: {
      gutterRatio: round(gutterRows / height, 4),
      gutterMedian: round(median(gutterRuns), 4),
      panelHeightMedian: round(median(panelRuns), 4),
      panelHeightSpread: round(stddev(panelRuns), 4),
      panelsPerScreen: round(panelRuns.length / (height / screenHeight), 2),
      gutterIntrusionsPerScreen: round(intrusions / (height / screenHeight), 2),
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
 * A target band: per-metric ranges, plus the screen the numbers assume.
 *
 * `metrics` is what the band GRADES. `recorded` is what it measured and chose
 * not to grade — kept because deleting a range that should not decide a verdict
 * also throws away the only record of what was measured.
 */
export interface CraftBand {
  bandFormat: number;
  name?: string;
  /** Screen aspect the band was measured at; the measurement adopts it. */
  screenAspect?: number;
  metrics: Partial<Record<CraftMetricName, CraftBandRange>>;
  /** Measured ranges the band keeps but never grades against. */
  recorded?: Partial<Record<CraftMetricName, CraftBandRange>>;
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

/** The full comparison: every graded metric, what was only recorded, the verdict. */
export interface CraftBandReport {
  name: string | null;
  inBand: boolean;
  metrics: CraftMetricVerdict[];
  recorded: CraftRecordedMetric[];
  provenance: CraftBandProvenance | null;
}

const BAND_KEYS = [
  "bandFormat",
  "name",
  "screenAspect",
  "metrics",
  "recorded",
  "provenance",
] as const;
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
    ...(isPlainObject(value.provenance)
      ? { provenance: value.provenance as unknown as CraftBandProvenance }
      : {}),
  };
}

/**
 * Grade measured metrics against a band. Only the metrics the band GRADES are
 * graded; a metric with no measurable value (an episode with no colour at all
 * has no hue) can never be inside a declared range, so it fails rather than
 * passing by absence.
 *
 * A recorded metric is measured against nothing. Its value and the range the
 * band measured are reported side by side, and the verdict is computed from
 * `verdicts` alone — the recorded list is never read for it, and its entries
 * carry no verdict to read.
 */
export function compareToCraftBand(metrics: CraftMetrics, band: CraftBand): CraftBandReport {
  const verdicts: CraftMetricVerdict[] = [];
  const recorded: CraftRecordedMetric[] = [];
  for (const name of CRAFT_METRIC_NAMES) {
    const range = band.metrics[name];
    if (range !== undefined) {
      const value = metrics[name];
      const min = range.min ?? null;
      const max = range.max ?? null;
      const inBand =
        value !== null && (min === null || value >= min) && (max === null || value <= max);
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
  return {
    name: band.name ?? null,
    inBand: verdicts.every((verdict) => verdict.inBand),
    metrics: verdicts,
    recorded,
    provenance: band.provenance ?? null,
  };
}
