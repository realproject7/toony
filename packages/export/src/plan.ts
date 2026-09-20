// Grade an episode's page geometry BEFORE any image exists.
//
// `measureEpisodeCraft` composes the page and reads its pixels. That is the real
// measurement and nothing here replaces it — but it costs what the art costs. A
// hundred-panel episode is three to four hours of generation against a local GPU
// (#233), and everything `toony measure` says about PAGE STRUCTURE is arithmetic
// on the cut and transition lists: the gutter budget, the median gutter and
// panel height, how much the panel heights vary, and how many panels a screen of
// scrolling holds. A plan that cannot hit its band is knowable in a second, and
// was being discovered after two full renders.
//
// Two rules this module is built on, both of them results someone already paid
// for:
//
//   A cut's height is resolved through `resolveCutAspect` and `cutHeightAt` —
//   the shipped resolver the export raster stages an ART-LESS cut with (#237,
//   #260) — and a gap's through `resolveBandHeight`, which is what the export
//   canvas sizes a band with. A second height rule here would be the defect, not
//   the feature: the plan grade and the rendered grade agree because they call
//   one resolver, not because two implementations were kept in step by hand.
//
//   There is no beat BAND. #241 measured four contiguous episodes and found beat
//   count, median beat length and pace curve varying as much within one author's
//   work as across authors. A beat here is a description format — a length in
//   cuts, the shape those cuts are declared at, and the gaps between them — and
//   nothing grades the beats themselves.
//
// WHAT A PLAN CANNOT CHECK is as much of this module's job as what it can. A
// plan has no pixels, so the four colour metrics and `panelInset` are out of
// reach, and `gutterIntrusionsPerScreen` counts things a plan does not model.
// Every report names those six, so a plan verdict can never be read as the whole
// one. See `PLAN_UNCHECKED_REASONS`.

import { loadProject } from "@toony/project-io";
import {
  type CutAspectSource,
  cutHeightAt,
  layoutTransition,
  resolveBandHeight,
  resolveCutAspect,
} from "@toony/render";
import {
  type EpisodeBundle,
  GUTTER_HEIGHT_MAX_PX,
  IssueCollector,
  isArray,
  isFiniteNumber,
  isInteger,
  isPlainObject,
  isString,
  joinPath,
  PANEL_ASPECT_MAX,
  PANEL_ASPECT_MIN,
  type Project,
  resolveReferenceWidth,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
  type ValidationResult,
} from "@toony/schema";
import {
  type CraftBand,
  type CraftBandProvenance,
  type CraftMetricName,
  type CraftMetricVerdict,
  type CraftRecordedMetric,
  classifyPageRows,
  compareToTransitionVocabulary,
  DEFAULT_SCREEN_ASPECT,
  type MeasureOptions,
  measureTransitionMix,
  PAGE_GEOMETRY_METRIC_NAMES,
  type PageGeometryMetricName,
  type PageGeometryMetrics,
  pageGeometryMetrics,
  round,
  type TransitionMix,
  type TransitionVocabularyVerdict,
} from "./craft.js";
import { STITCHED_DEFAULT_WIDTH } from "./defaults.js";
import { ExportError } from "./errors.js";

/** The format version an episode plan file must declare. */
export const EPISODE_PLAN_FORMAT_VERSION = 1;

/**
 * The tallest page a plan may be graded at, in rows.
 *
 * The run rule reads a page one row at a time, so this is a real allocation and
 * not a policy: a plan that validates can still name more rows than an array
 * holds. What it catches is a plan that is wrong rather than large, and it
 * catches it as an error the command reports instead of a crash wearing a
 * verdict's exit code.
 *
 * Twenty million is far past anything real — 16,667 column widths of page at the
 * 1200px default, where a measured episode runs about 138. IT IS NOT CHEAP,
 * though, and the figure is here so nobody raises the cap on the strength of the
 * ideal one. Pushing exactly this many rows peaked at 541 MB RSS here and 582 MB
 * on a reviewer's machine, against the 153 MB an exactly-sized array of them
 * would occupy: `push` grows its backing store geometrically, so the old store
 * and the new one are alive together at the moment it grows. Half a gigabyte,
 * not a sixth of one.
 *
 * Because the cap is on ROWS, its headroom in column widths shrinks linearly
 * with the column: 16,667 at the 1200px default, and 200 at `EXPORT_WIDTH_MAX`.
 * Two hundred is about 1.45x a measured episode, so at that column 103 cuts of
 * 1.4 still fit and 155 of them do not. Nothing the rendered path could itself
 * grade is refused at any column — a page that tall is past what a canvas will
 * allocate — so that is a note and not a defect.
 */
export const PLAN_PAGE_ROWS_MAX = 20_000_000;

/**
 * One gap a plan puts between two cuts.
 *
 * Exactly the two fields of a `Transition` that decide the height it draws at
 * and the kind a vocabulary grades. Everything else a transition carries — text,
 * colour, gradient, fade, notes, review status — changes what is IN the band,
 * never how tall it is, and a plan checks no colour and no text.
 */
export interface PlanGap {
  type: TransitionType;
  /**
   * px on the plan's `referenceWidth` column, the same sense
   * `Transition.gutterHeight` carries. It is scaled to the graded column, and a
   * card or a solid band still draws no shorter than the legibility floor.
   */
  gutterHeight: number;
}

/**
 * One beat: a LENGTH IN CUTS, and the shape and spacing those cuts run at.
 *
 * This is the missing middle. An agent holding "the operator wants a thriller
 * about X" and an episode of a hundred panels has, today, nothing between the
 * intent and a hundred hand-written cut records. Around twenty of these describe
 * that episode's structure, and the geometry of the page they imply can be
 * graded before a prompt is chosen.
 *
 * TWENTY, NOT THREE, AND NOT EVENLY SIZED. The one contiguous capture of a
 * measured episode came to 19 beats over 103 panels, and their lengths ran from
 * 0.50 to 17.18 column widths inside that single episode — a spread of thirty
 * fold. So nothing here normalises a beat against its neighbours, nothing caps
 * the beat count at an act structure, and every beat carries its own shape and
 * its own spacing rather than inheriting an episode-wide one. A format that
 * assumed similar-sized beats would not fit a real episode, and a fixed small
 * number of them would not describe one.
 *
 * A SCENE BREAK IS NOT A KIND HERE. It is an ordinary gutter at about twice the
 * episode's own median, so it is written as a `gap` with a taller
 * `gutterHeight`; `TRANSITION_TYPES` already carries `scene-break` for an author
 * who wants the label. Neither needs a field of its own and neither gets one.
 *
 * It describes structure and NOTHING ELSE. Who the characters are and where the
 * twist sits are not geometry; a beat has a label so a reader knows which beat
 * is which, and no other story field.
 */
export interface PlanBeat {
  /** What this beat is, for the reader. Not graded. */
  label: string;
  /** How many cuts the beat runs. At least one. */
  cuts: number;
  /**
   * The shape every cut of the beat is declared at, as `Cut.panelAspect` is: the
   * cut's height as a multiple of its own width.
   *
   * ABSENT IS NOT NEUTRAL. The resolver falls back, so an absent declaration is
   * still graded — at a shape the plan never asked for. Every report counts the
   * cuts that landed on the fallback and names the aspect they were graded at.
   */
  panelAspect?: number;
  /** The gap between two cuts INSIDE the beat. Absent → the cuts butt together. */
  gap?: PlanGap;
  /** The gap that leads INTO the beat, if the beat opens on one. */
  openWith?: PlanGap;
}

/**
 * An episode's structure, as beats with lengths.
 *
 * `referenceWidth` is the column the gap heights are px on, exactly as
 * `webtoon.json`'s own `referenceWidth` is for a project: a plan that did not
 * carry it would grade its gaps on whatever column the report happened to use,
 * which is the #217 defect one level up.
 */
export interface EpisodePlan {
  planFormat: number;
  name?: string;
  referenceWidth: number;
  beats: PlanBeat[];
}

/** One metric a plan-level grade does not check, and why it cannot. */
export interface PlanUncheckedMetric {
  metric: CraftMetricName;
  reason: string;
}

/**
 * Why each metric outside `PAGE_GEOMETRY_METRIC_NAMES` is beyond a plan.
 *
 * Typed as a TOTAL record over exactly those metrics, so a metric added to
 * `CRAFT_METRIC_NAMES` that a plan cannot compute fails to build until someone
 * writes down why. An unchecked metric nobody listed is the one failure this
 * module exists to make impossible, and a runtime check would find it after the
 * report had already been believed.
 */
const PLAN_UNCHECKED_REASONS: Record<Exclude<CraftMetricName, PageGeometryMetricName>, string> = {
  gutterIntrusionsPerScreen:
    "counts short non-flat runs inside empty space — a card's own text, a break's divider, a bubble over an art-less cut. All three are drawn, and a plan models regions rather than what is drawn in them.",
  panelInset:
    "is the flat margin at a panel's two edges. On a render that is whatever the art left flat near the border, which three pages of one pack spread 0.070 across; nothing declared decides it.",
  valueMean: "is luminance sampled from the panel interiors. A palette field is not a pixel.",
  valueSpread: "is the spread of that luminance. A palette field is not a pixel.",
  saturationMean: "is saturation sampled from the panel interiors. A palette field is not a pixel.",
  hueBias: "is the mean hue of the panel interiors. A palette field is not a pixel.",
};

/** Every metric a plan-level grade leaves unchecked, with the reason, in report order. */
export const PLAN_UNCHECKED_METRICS: readonly PlanUncheckedMetric[] = Object.entries(
  PLAN_UNCHECKED_REASONS,
).map(([metric, reason]) => ({ metric: metric as CraftMetricName, reason }));

/**
 * One beat, measured: what it is, how many cuts it runs, and how much page that
 * comes to.
 *
 * `lengthInWidths` is the beat's own span as a share of the column width — the
 * unit every run length in a craft measurement is already expressed in, so a
 * beat's length and a panel's are one number. It covers the beat's cuts and the
 * gaps between them, and NOT the gap it opens on: that gap separates this beat
 * from the one before and belongs to neither.
 *
 * Reported per beat and never summarised, because the lengths of a real
 * episode's beats are not similar to each other. A median over them says almost
 * nothing, and an author checking whether a plan has the unevenness a real
 * episode has needs the list.
 */
export interface PlanBeatMeasurement {
  label: string;
  cuts: number;
  lengthInWidths: number;
}

/** One stacked region of a planned page, in reading order. */
interface PlanRegion {
  /** A cut reads as art; a gap reads as inter-panel space. */
  kind: "panel" | "gap";
  /** What the region draws at, in px, on the graded column. */
  height: number;
  /** For a cut: which of the resolver's answers gave its shape. */
  aspectSource?: CutAspectSource;
}

/** A plan measured: the geometry it decides, and everything it does not. */
export interface PlanMeasurement {
  /** The episode this plan was read off, or null for a plan file. */
  episodeId: string | null;
  /** The plan file's name, or null when the plan came from an episode. */
  planName: string | null;
  /** Column the plan was graded at, in px. */
  width: number;
  /** Page height the plan comes to, in px. */
  height: number;
  screenAspect: number;
  /** One screen in px: `round(width * screenAspect)`. */
  screenHeight: number;
  /** Cuts the plan reads. */
  cuts: number;
  /**
   * How many of those declare no shape and were graded on the fallback.
   *
   * Reported for the same reason `cutsWithoutImage` is on a measurement: a
   * number that describes a shape the pack never asked for must not pass for one
   * it did. A plan whose cuts are all undeclared is a plan graded entirely on
   * `FALLBACK_CUT_ASPECT`, and its panel figures say more about that constant
   * than about the pack.
   */
  cutsWithoutDeclaredShape: number;
  /** The aspect those cuts were graded at. */
  fallbackAspect: number;
  /**
   * Each beat's own span, for a plan stated as beats.
   *
   * Null for an episode read off its cut list, and that is a SCOPE BOUNDARY
   * rather than an unfinished path. Deriving beats from an episode means finding
   * its scene breaks in a page that already exists, which is a measurement
   * feature; this command runs before the episode exists, and an agent authoring
   * a plan states its beats rather than asking to be told them.
   */
  beats: PlanBeatMeasurement[] | null;
  metrics: PageGeometryMetrics;
  /** Every metric this grade did not check, with the reason. Never empty. */
  unchecked: readonly PlanUncheckedMetric[];
  /**
   * The gaps the plan declares. Read off declared records exactly as
   * `toony measure` reads an episode's, through the same function — so this half
   * of a band is graded identically before and after the art exists.
   */
  transitions: TransitionMix;
}

/** What every plan-against-band report carries, graded or not. */
interface PlanBandCommon {
  name: string | null;
  /** The band's graded metrics that a plan can check. */
  metrics: CraftMetricVerdict[];
  /** The band's recorded ranges for metrics a plan can compute. */
  recorded: CraftRecordedMetric[];
  /** The band's GRADED metrics that a plan cannot check, with the reason. */
  unchecked: PlanUncheckedMetric[];
  /** The vocabulary entries, graded in full: a mix needs no pixels. */
  transitions: TransitionVocabularyVerdict[];
  provenance: CraftBandProvenance | null;
}

/**
 * A plan graded against a band that grades at least one thing a plan can check.
 *
 * It is NOT a `CraftBandReport` and carries no `inBand`. The missing field is
 * the point: a plan checks five of eleven metrics, so a caller that summed a
 * plan report into one verdict would be reporting a partial check as a whole
 * one.
 */
export interface PlanBandGraded extends PlanBandCommon {
  /** True when every metric this grade COULD check is in band. Never the whole answer. */
  checkedInBand: boolean;
}

/**
 * A band that grades NOTHING a plan can check, and therefore carries no verdict
 * at all — not even `checkedInBand`.
 *
 * A band whose every graded metric is colour, `panelInset` or
 * `gutterIntrusionsPerScreen`, and which declares no transition vocabulary,
 * leaves a plan with an empty verdict list. `[].every(...)` is `true`, so a
 * single boolean would have said the plan passed, from a run that checked
 * nothing — and an agent running `toony plan --against <band> && generate` would
 * take the green light and pay the hours this command exists to save.
 *
 * "Nothing was checked" is the most partial verdict there is, so it gets the
 * treatment the repo already gives the other two. `validateCraftBandValue`
 * rejects a band with an empty `metrics` because recording is an addition to a
 * target and never a way to ship one that decides nothing;
 * `TransitionRangeUngraded` omits `inBand` so a reader cannot mistake "there was
 * nothing to grade" for "it passed". This omits it for the same reason, and
 * `toony plan` turns it into a usage error rather than a pass.
 */
export interface PlanBandUngraded extends PlanBandCommon {
  /** Always false. Present so the two shapes are told apart by a field, not by a type. */
  graded: false;
}

/** A plan graded against a band, or a band that gave it nothing to grade. */
export type PlanBandReport = PlanBandGraded | PlanBandUngraded;

/**
 * The `Transition` a plan gap stands for.
 *
 * A plan compresses a gap to the two fields that decide its height and its kind,
 * and the shipped height rule takes a whole record. The rest is filled with the
 * values that draw nothing — no text, no SFX, no notes, no imported band image —
 * so the record resolves to exactly the height and kind the gap declared. Every
 * field set here belongs to what is IN the band, which a plan neither checks nor
 * could honour.
 */
function gapTransition(gap: PlanGap, id: string): Transition {
  return {
    id,
    type: gap.type,
    gutterHeight: gap.gutterHeight,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  };
}

/**
 * A gap's drawn height on `width`, through the same resolver the export canvas
 * sizes the band with. Zero means the transition draws no band at all, and the
 * caller drops it from the page exactly as `stitchEpisode` does.
 */
function gapHeight(transition: Transition, width: number, referenceWidth: number): number {
  return resolveBandHeight(layoutTransition(transition), width, referenceWidth);
}

/** One cut's planned region, resolved with NO image offered. */
function panelRegion(panelAspect: number | undefined, width: number): PlanRegion {
  const resolved = resolveCutAspect(panelAspect, null);
  return {
    kind: "panel",
    height: cutHeightAt(width, resolved.aspect),
    aspectSource: resolved.source,
  };
}

/** What a stack of regions was built from: the page, and the gaps it declares. */
interface PlannedPage {
  regions: PlanRegion[];
  /** The gaps in reading order, including the ones that draw nothing. */
  gaps: Transition[];
  referenceWidth: number;
  /** Present only for a page built from beats. */
  beats: PlanBeatMeasurement[] | null;
}

/** The page a beat list stacks into, and what each beat's own span comes to. */
function beatPage(plan: EpisodePlan, width: number): PlannedPage {
  const regions: PlanRegion[] = [];
  const gaps: Transition[] = [];
  const beats: PlanBeatMeasurement[] = [];
  const pushGap = (gap: PlanGap): void => {
    const transition = gapTransition(gap, `gap-${String(gaps.length + 1).padStart(3, "0")}`);
    gaps.push(transition);
    const height = gapHeight(transition, width, plan.referenceWidth);
    if (height > 0) regions.push({ kind: "gap", height });
  };
  for (const beat of plan.beats) {
    if (beat.openWith !== undefined) pushGap(beat.openWith);
    // The span is measured from HERE, after the opening gap. That gap separates
    // this beat from the one before it and belongs to neither: a scene break is
    // the boundary a beat map cuts on, not part of the beat it introduces, and
    // counting it would make every beat but the first longer than the beat map
    // it is meant to be comparable with.
    const from = regions.length;
    for (let i = 0; i < beat.cuts; i++) {
      if (i > 0 && beat.gap !== undefined) pushGap(beat.gap);
      regions.push(panelRegion(beat.panelAspect, width));
    }
    // The beat's own span: its cuts and the gaps between them, in column widths
    // — the unit the page is measured in, so a beat length and a panel height
    // compare directly.
    const span = regions.slice(from).reduce((sum, region) => sum + region.height, 0);
    beats.push({ label: beat.label, cuts: beat.cuts, lengthInWidths: round(span / width, 4) });
  }
  return { regions, gaps, referenceWidth: plan.referenceWidth, beats };
}

/**
 * The page an episode's own cut and transition lists stack into.
 *
 * The same walk `stitchEpisode` makes over the reading sequence, minus the
 * pixels: a record the sequence never reaches is not on the page, and a cut is
 * sized from its declaration whether or not it already has art.
 */
function episodePage(project: Project, bundle: EpisodeBundle, width: number): PlannedPage {
  const referenceWidth = resolveReferenceWidth(project.webtoon.referenceWidth);
  const cutsById = new Map(bundle.cuts.map((cut) => [cut.id, cut]));
  const transitionsById = new Map(bundle.transitions.map((t) => [t.id, t]));
  const regions: PlanRegion[] = [];
  const gaps: Transition[] = [];
  for (const item of bundle.episode.sequence) {
    if (item.type === "cut") {
      const cut = cutsById.get(item.id);
      if (cut !== undefined) regions.push(panelRegion(cut.panelAspect, width));
      continue;
    }
    const transition = transitionsById.get(item.id);
    if (transition === undefined) continue;
    gaps.push(transition);
    const height = gapHeight(transition, width, referenceWidth);
    if (height > 0) regions.push({ kind: "gap", height });
  }
  return { regions, gaps, referenceWidth, beats: null };
}

/**
 * Measure a planned page.
 *
 * Every row of a cut is art and every row of a gap is empty space — which is
 * what the declaration says and all a declaration can say. Those flags then go
 * through the SAME run rule a rendered page's rows do, floors and all, so a gap
 * too short to be a reading pause merges its neighbours here exactly as it does
 * on the page.
 */
function measurePage(
  page: PlannedPage,
  width: number,
  screenAspect: number,
): Omit<PlanMeasurement, "episodeId" | "planName"> {
  // Summed before anything is allocated. The run rule takes a per-row array, so
  // a page of a billion rows is a `RangeError` from `Array.push` — a crash with
  // a stack trace, and an exit code this CLI documents as an out-of-band
  // verdict, which is how a scripted gate would read it. Refused here instead,
  // with the one error type the command already turns into a usage failure.
  const rows = page.regions.reduce((sum, region) => sum + region.height, 0);
  if (rows > PLAN_PAGE_ROWS_MAX) {
    throw new ExportError(
      "plan-too-large",
      `this plan comes to ${rows} rows at a ${width}px column, over the ${PLAN_PAGE_ROWS_MAX} a plan may be graded at (${Math.round(PLAN_PAGE_ROWS_MAX / width)} column widths of page here, where a measured episode runs about 138). Grade it at a narrower --width, or state fewer or shorter cuts.`,
    );
  }
  const flags: boolean[] = [];
  for (const region of page.regions) {
    const flat = region.kind === "gap";
    for (let row = 0; row < region.height; row++) flags.push(flat);
  }
  const height = Math.max(1, flags.length);
  const screenHeight = Math.max(1, Math.round(width * screenAspect));
  const runs = classifyPageRows(flags, width);
  const panels = page.regions.filter((region) => region.kind === "panel");
  return {
    width,
    height,
    screenAspect,
    screenHeight,
    cuts: panels.length,
    cutsWithoutDeclaredShape: panels.filter((region) => region.aspectSource !== "declared").length,
    fallbackAspect: resolveCutAspect(undefined, null).aspect,
    beats: page.beats,
    metrics: pageGeometryMetrics(runs, height, screenHeight),
    unchecked: PLAN_UNCHECKED_METRICS,
    transitions: measureTransitionMix(page.gaps, page.referenceWidth),
  };
}

/**
 * Measure a plan file's geometry.
 *
 * The page it describes is never composed: each cut becomes a region of the
 * height the shipped resolver gives its declared shape, each gap a region of the
 * height the shipped band rule gives its declared kind, and the run rule reads
 * that stack exactly as it reads a rendered page's rows.
 */
export function measurePlan(plan: EpisodePlan, options: MeasureOptions = {}): PlanMeasurement {
  const width = Math.max(1, Math.round(options.width ?? STITCHED_DEFAULT_WIDTH));
  return {
    episodeId: null,
    planName: plan.name ?? null,
    ...measurePage(beatPage(plan, width), width, options.screenAspect ?? DEFAULT_SCREEN_ASPECT),
  };
}

/**
 * Measure an episode's geometry from its cut and transition lists alone.
 *
 * No image is read and no canvas is created, so this answers for an episode
 * whose art does not exist yet — which is the only moment the answer is worth
 * anything. On an episode that HAS art it still resolves each cut's shape from
 * the declaration, so what it reports is the shape the pack asked for and the
 * difference from `toony measure` is the art.
 */
export async function measureEpisodePlan(
  root: string,
  episodeId: string,
  options: MeasureOptions = {},
): Promise<PlanMeasurement> {
  const loaded = await loadProject(root);
  if (!loaded.validation.valid) {
    throw new ExportError(
      "invalid-project",
      "project does not pass validation; run `toony validate`.",
    );
  }
  const bundle = loaded.project.episodes.find((episode) => episode.episode.id === episodeId);
  if (!bundle) {
    throw new ExportError("episode-not-found", `episode not found: ${episodeId}`);
  }
  const width = Math.max(1, Math.round(options.width ?? STITCHED_DEFAULT_WIDTH));
  return {
    episodeId,
    planName: null,
    ...measurePage(
      episodePage(loaded.project, bundle, width),
      width,
      options.screenAspect ?? DEFAULT_SCREEN_ASPECT,
    ),
  };
}

function within(value: number, range: { min?: number; max?: number }): boolean {
  return (
    (range.min === undefined || value >= range.min) &&
    (range.max === undefined || value <= range.max)
  );
}

/**
 * Grade a plan against a band, checking only what a plan can check.
 *
 * A band metric outside the five goes into `unchecked` rather than being graded
 * against a number a plan does not have. It is not skipped quietly and it is not
 * failed: failing it would say the plan misses a range it never measured, and
 * skipping it would let five of eleven metrics pass for a verdict.
 *
 * The transition vocabulary IS graded in full. It is read off declared records,
 * needs no pixels, and goes through the same comparison `toony measure` uses, so
 * that half of a band is decided identically before and after generation.
 */
export function comparePlanToCraftBand(
  measured: Pick<PlanMeasurement, "metrics" | "transitions">,
  band: CraftBand,
): PlanBandReport {
  const metrics: CraftMetricVerdict[] = [];
  const recorded: CraftRecordedMetric[] = [];
  for (const name of PAGE_GEOMETRY_METRIC_NAMES) {
    const value = measured.metrics[name];
    const range = band.metrics[name];
    if (range !== undefined) {
      metrics.push({
        metric: name,
        value,
        min: range.min ?? null,
        max: range.max ?? null,
        inBand: within(value, range),
      });
    }
    const kept = band.recorded?.[name];
    if (kept !== undefined) {
      recorded.push({ metric: name, value, min: kept.min ?? null, max: kept.max ?? null });
    }
  }
  // Every metric the band GRADES that is not one of the five above. The list is
  // exhaustive by construction, because `PLAN_UNCHECKED_REASONS` is a total
  // record over exactly the metrics that are not in `PAGE_GEOMETRY_METRIC_NAMES`.
  const unchecked = PLAN_UNCHECKED_METRICS.filter(
    (entry) => band.metrics[entry.metric] !== undefined,
  );
  const transitions = compareToTransitionVocabulary(
    measured.transitions,
    band.transitionVocabulary ?? [],
  );
  const common: PlanBandCommon = {
    name: band.name ?? null,
    metrics,
    recorded,
    unchecked,
    transitions,
    provenance: band.provenance ?? null,
  };
  // Nothing to grade is not a pass. Both lists can be empty at once — a band may
  // grade only colour, `panelInset` and `gutterIntrusionsPerScreen`, and declare
  // no vocabulary — and `[].every(...)` is `true`, so a verdict computed here
  // would say the plan passed a check it never made. It gets no verdict instead.
  if (metrics.length === 0 && transitions.length === 0) {
    return { ...common, graded: false };
  }
  return {
    ...common,
    checkedInBand:
      metrics.every((verdict) => verdict.inBand) && transitions.every((verdict) => verdict.inBand),
  };
}

// --- Plan files -------------------------------------------------------------
//
// A plan is DATA, validated the same way a band and a pack manifest are: a
// strict allowlist at every level, so an unknown key is a rejection rather than
// something quietly ignored. A misspelled `panelAspect` must not silently grade
// a beat on the fallback.

const PLAN_KEYS = ["planFormat", "name", "referenceWidth", "beats"] as const;
const BEAT_KEYS = ["label", "cuts", "panelAspect", "gap", "openWith"] as const;
const GAP_KEYS = ["type", "gutterHeight"] as const;

const PLAN_TEXT_MAX_LENGTH = 80;
const PLAN_BEATS_MAX = 500;
const PLAN_BEAT_CUTS_MAX = 1000;
/**
 * Cuts a whole plan may name, summed over its beats.
 *
 * The per-beat and per-plan caps bound each field and not their product: 500
 * beats of 1000 cuts validates at half a million cuts, which is not an episode
 * and cannot be graded at any column. A measured episode runs about a hundred
 * panels (#233), so two thousand is twenty times a real one and still catches
 * the plan that is wrong by an order of magnitude — at validation, where the
 * message can name the field, rather than at the row cap, where it can only name
 * a size.
 */
const PLAN_CUTS_MAX = 2000;
const PLAN_REFERENCE_WIDTH_MIN = 1;
const PLAN_REFERENCE_WIDTH_MAX = 20000;

function allowlistKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  c: IssueCollector,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    c.add(joinPath(path, key), "plan.unknown-key", `unknown key: ${key}`);
  }
}

/** A single-line label of bounded length, the same shape a band's text fields take. */
function isPlanText(value: unknown): value is string {
  if (!isString(value) || value.length === 0 || value.length > PLAN_TEXT_MAX_LENGTH) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function validateGap(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "plan.gap", "a gap must be an object.");
    return;
  }
  allowlistKeys(value, GAP_KEYS, path, c);
  if (!isString(value.type) || !(TRANSITION_TYPES as readonly string[]).includes(value.type)) {
    c.add(
      joinPath(path, "type"),
      "plan.gap-type",
      `type must be one of: ${TRANSITION_TYPES.join(", ")}.`,
    );
  }
  const height = value.gutterHeight;
  if (!isInteger(height) || height < 0 || height > GUTTER_HEIGHT_MAX_PX) {
    c.add(
      joinPath(path, "gutterHeight"),
      "plan.gap-height",
      `gutterHeight must be a whole number from 0 to ${GUTTER_HEIGHT_MAX_PX}, in px on the plan's referenceWidth column.`,
    );
  }
}

function validateBeat(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "plan.beat", "a beat must be an object.");
    return;
  }
  allowlistKeys(value, BEAT_KEYS, path, c);
  if (!isPlanText(value.label)) {
    c.add(
      joinPath(path, "label"),
      "plan.beat-label",
      `label must be a non-empty single-line string of at most ${PLAN_TEXT_MAX_LENGTH} characters.`,
    );
  }
  const cuts = value.cuts;
  if (!isInteger(cuts) || cuts < 1 || cuts > PLAN_BEAT_CUTS_MAX) {
    c.add(
      joinPath(path, "cuts"),
      "plan.beat-cuts",
      `cuts must be a whole number from 1 to ${PLAN_BEAT_CUTS_MAX} — how many cuts the beat runs.`,
    );
  }
  if (value.panelAspect !== undefined) {
    const aspect = value.panelAspect;
    if (!isFiniteNumber(aspect) || aspect < PANEL_ASPECT_MIN || aspect > PANEL_ASPECT_MAX) {
      c.add(
        joinPath(path, "panelAspect"),
        "plan.beat-aspect",
        `panelAspect must be a number between ${PANEL_ASPECT_MIN} and ${PANEL_ASPECT_MAX} — the cut's height as a multiple of its width.`,
      );
    }
  }
  if (value.gap !== undefined) validateGap(value.gap, joinPath(path, "gap"), c);
  if (value.openWith !== undefined) validateGap(value.openWith, joinPath(path, "openWith"), c);
}

/** Validate an untrusted value as an episode plan. */
export function validateEpisodePlanValue(value: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isPlainObject(value)) {
    c.add("", "plan.root", "a plan file must be an object.");
    return c.result();
  }
  allowlistKeys(value, PLAN_KEYS, "", c);
  if (value.planFormat !== EPISODE_PLAN_FORMAT_VERSION) {
    c.add("planFormat", "plan.format", `planFormat must be ${EPISODE_PLAN_FORMAT_VERSION}.`);
  }
  if (value.name !== undefined && !isPlanText(value.name)) {
    c.add(
      "name",
      "plan.name",
      `name must be a non-empty single-line string of at most ${PLAN_TEXT_MAX_LENGTH} characters.`,
    );
  }
  const referenceWidth = value.referenceWidth;
  if (
    !isInteger(referenceWidth) ||
    referenceWidth < PLAN_REFERENCE_WIDTH_MIN ||
    referenceWidth > PLAN_REFERENCE_WIDTH_MAX
  ) {
    c.add(
      "referenceWidth",
      "plan.reference-width",
      `referenceWidth must be a whole number from ${PLAN_REFERENCE_WIDTH_MIN} to ${PLAN_REFERENCE_WIDTH_MAX} — the column the gap heights are px on.`,
    );
  }
  const beats = value.beats;
  if (!isArray(beats) || beats.length === 0 || beats.length > PLAN_BEATS_MAX) {
    c.add(
      "beats",
      "plan.beats",
      `beats must be an array of 1 to ${PLAN_BEATS_MAX} beats. A plan with no beats describes no episode.`,
    );
    return c.result();
  }
  beats.forEach((beat, index) => {
    validateBeat(beat, `beats[${index}]`, c);
  });
  // Only the beats that named a whole number are summed; the rest already have
  // their own issue, and counting them as zero keeps this from reporting a
  // second problem for the same field.
  let cuts = 0;
  for (const beat of beats) {
    if (isPlainObject(beat) && isInteger(beat.cuts)) cuts += beat.cuts;
  }
  if (cuts > PLAN_CUTS_MAX) {
    c.add(
      "beats",
      "plan.cuts",
      `a plan may name ${PLAN_CUTS_MAX} cuts in all and this one names ${cuts}. A measured episode runs about a hundred panels.`,
    );
  }
  return c.result();
}

/** Narrow a value that already passed `validateEpisodePlanValue`. */
export function asEpisodePlan(value: Record<string, unknown>): EpisodePlan {
  return value as unknown as EpisodePlan;
}
