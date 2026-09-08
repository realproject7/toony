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
  isFiniteNumber,
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

/** Flat runs shorter than this share of a screen are seams between stacked art. */
export const GUTTER_MIN_RUN_FRACTION = 0.004;

/**
 * A non-flat run shorter than this share of a screen is not a panel: it is
 * something floating IN the gutter — a bubble or an SFX overlapping the empty
 * space between cuts, which Toony expresses as `placement: gutter`. Counting
 * those as panels shredded the reference's thriller numbers (panels per frame
 * read 6.9 and the median panel height came out a third of its true value), so
 * they are folded back into the gutter for rhythm and counted on their own.
 */
export const PANEL_MIN_RUN_FRACTION = 0.04;

/**
 * Height of one reading screen as a multiple of the render width. Run lengths
 * are reported as a share of a screen — the unit the reference analyzer uses for
 * its per-capture numbers — so this is the viewport the measurement assumes. A
 * band measured at another aspect is not comparable, which is why a band file may
 * pin its own.
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
 * The measured craft signals. Run lengths are a share of one screen; `valueMean`
 * and `valueSpread` are 0..255 luminance; `saturationMean` is 0..1; `hueBias` is
 * degrees, or null when the sampled art carries no colour at all.
 */
export interface CraftMetrics {
  /** Share of episode height that is inter-panel space. */
  gutterRatio: number;
  /** Median gutter run, as a share of one screen. */
  gutterMedian: number;
  /** Median panel run, as a share of one screen. */
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
  const gutterMinRun = Math.max(2, Math.floor(screenHeight * GUTTER_MIN_RUN_FRACTION));
  const panelMinRun = Math.max(3, Math.floor(screenHeight * PANEL_MIN_RUN_FRACTION));

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

/** A target band: per-metric ranges, plus the screen the numbers assume. */
export interface CraftBand {
  bandFormat: number;
  name?: string;
  /** Screen aspect the band was measured at; the measurement adopts it. */
  screenAspect?: number;
  metrics: Partial<Record<CraftMetricName, CraftBandRange>>;
}

/** One metric's verdict against the band. */
export interface CraftMetricVerdict {
  metric: CraftMetricName;
  value: number | null;
  min: number | null;
  max: number | null;
  inBand: boolean;
}

/** The full comparison: every graded metric, plus the overall verdict. */
export interface CraftBandReport {
  name: string | null;
  inBand: boolean;
  metrics: CraftMetricVerdict[];
}

const BAND_KEYS = ["bandFormat", "name", "screenAspect", "metrics"] as const;
const RANGE_KEYS = ["min", "max"] as const;

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
  if (value.name !== undefined && !isString(value.name)) {
    c.add("band.name", "band.name", "name must be a string.");
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
  if (!isPlainObject(value.metrics)) {
    c.add("band.metrics", "band.metrics.type", "metrics must be an object of metric ranges.");
    return c.result();
  }
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
  return c.result();
}

/** Narrow an already-validated band value. Only call after validation passed. */
export function asCraftBand(value: Record<string, unknown>): CraftBand {
  return {
    bandFormat: value.bandFormat as number,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.screenAspect === "number" ? { screenAspect: value.screenAspect } : {}),
    metrics: value.metrics as CraftBand["metrics"],
  };
}

/**
 * Grade measured metrics against a band. Only the metrics the band declares are
 * graded; a metric with no measurable value (an episode with no colour at all
 * has no hue) can never be inside a declared range, so it fails rather than
 * passing by absence.
 */
export function compareToCraftBand(metrics: CraftMetrics, band: CraftBand): CraftBandReport {
  const verdicts: CraftMetricVerdict[] = [];
  for (const name of CRAFT_METRIC_NAMES) {
    const range = band.metrics[name];
    if (range === undefined) continue;
    const value = metrics[name];
    const min = range.min ?? null;
    const max = range.max ?? null;
    const inBand =
      value !== null && (min === null || value >= min) && (max === null || value <= max);
    verdicts.push({ metric: name, value, min, max, inBand });
  }
  return {
    name: band.name ?? null,
    inBand: verdicts.every((verdict) => verdict.inBand),
    metrics: verdicts,
  };
}
