// `toony plan [path] (--episode <id> | --spec <file>)` — grade an episode's
// geometry before a single image is generated.
//
// The cheap half of the loop `toony measure` closes. `measure` composes the page
// and reads its pixels, which costs what the art costs: a hundred-panel episode
// is hours of generation, and two full renders were spent learning things the cut
// and transition lists already implied. This reads the same page structure off
// the declarations — each cut's shape through the shipped resolver, each gap
// through the shipped band rule — and grades it in a second.
//
// It checks FIVE of the eleven metrics and says so every time it runs. A plan
// has no pixels, so it cannot see colour, it cannot see the flat margin beside a
// panel, and it cannot count what is drawn inside a gap. A verdict here is a
// verdict about the five, and the report never lets it read as more.
//
// Exit codes: 0 planned (and, with --against, in band on what it checked); 1 out
// of band on a metric it checked; 2 usage or IO failure.

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  asCraftBand,
  asEpisodePlan,
  type CraftBand,
  comparePlanToCraftBand,
  DEFAULT_SCREEN_ASPECT,
  type EpisodePlan,
  ExportError,
  measureEpisodePlan,
  measurePlan,
  type PlanBandReport,
  type PlanMeasurement,
  validateCraftBandValue,
  validateEpisodePlanValue,
} from "@toony/export";
import { decodeYaml, ProjectIoError } from "@toony/project-io";
import { EXPORT_WIDTH_MAX, EXPORT_WIDTH_MIN, validateExportInt } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { discoverPackContent } from "../packs.js";

export interface PlanIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Process environment; `TOONY_PACKS` names extra pack directories. */
  env?: Record<string, string | undefined>;
}

const VALUE_FLAGS = new Set(["--episode", "--spec", "--against", "--width", "--screen-aspect"]);

const USAGE =
  "usage: toony plan [path] (--episode <id> | --spec <file>) [--against <band-id|band.json>] [--json] [--width <px>] [--screen-aspect <n>]";

interface Parsed {
  positional: string[];
  values: Map<string, string>;
  json: boolean;
}

function parse(args: string[]): Parsed | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--json") {
      json = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: `${arg} requires a value` };
      values.set(arg, value);
      i++;
    } else if (arg.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, json };
}

/** Read, parse, and validate a band file. Returns the band or a message. */
async function readBand(file: string): Promise<CraftBand | { error: string[] }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { error: [`band file could not be read: ${file}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: [`band file is not valid JSON: ${file}`] };
  }
  const result = validateCraftBandValue(parsed);
  if (!result.valid) {
    return {
      error: result.issues.map(
        (issue) => `band error [${issue.code}] ${issue.path}: ${issue.message}`,
      ),
    };
  }
  return asCraftBand(parsed as Record<string, unknown>);
}

/**
 * Read, parse, and validate a plan file. YAML or JSON — the episode-level files
 * an author writes beside it are YAML, and YAML reads JSON.
 */
async function readPlan(file: string): Promise<EpisodePlan | { error: string[] }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { error: [`plan file could not be read: ${file}`] };
  }
  let parsed: unknown;
  try {
    parsed = decodeYaml(text);
  } catch {
    return { error: [`plan file is not valid YAML or JSON: ${file}`] };
  }
  const result = validateEpisodePlanValue(parsed);
  if (!result.valid) {
    return {
      error: result.issues.map(
        (issue) => `plan error [${issue.code}] ${issue.path}: ${issue.message}`,
      ),
    };
  }
  return asEpisodePlan(parsed as Record<string, unknown>);
}

function rangeOf(verdict: { min: number | null; max: number | null }): string {
  return `${verdict.min ?? "*"}..${verdict.max ?? "*"}`;
}

/**
 * What kind of gap the plan puts between its cuts, and how that compares.
 *
 * A mix is read off declared records and needs no pixels, so a plan grades this
 * half of a band in FULL — the same numbers, from the same function, that
 * `toony measure` will report once the art exists.
 */
function transitionLines(
  mix: PlanMeasurement["transitions"],
  graded: PlanBandReport["transitions"],
): string[] {
  const lines = [`  transition mix — ${mix.gaps} gap(s) drawn, from the declared kinds`];
  if (mix.undrawn > 0) {
    lines.push(
      `    note: ${mix.undrawn} transition(s) draw no band at all and are not counted as gaps.`,
    );
  }
  const kindWidth = Math.max(4, ...mix.kinds.map((kind) => kind.kind.length));
  for (const kind of mix.kinds) {
    lines.push(
      `    ${kind.kind.padEnd(kindWidth)}  ${String(kind.count).padStart(3)}  share ${String(kind.share).padStart(6)}  height ${String(kind.heightMedian).padStart(6)}`,
    );
  }
  if (graded.length === 0) return lines;
  lines.push(`  transition vocabulary — ${graded.length} entry(s) graded`);
  for (const entry of graded) {
    lines.push(`    ${entry.kinds.join("+")}  ${entry.count} gap(s)`);
    lines.push(
      `      share   ${String(entry.share.value).padStart(7)}  ${rangeOf(entry.share).padEnd(16)} ${entry.share.inBand ? "in" : "OUT"}`,
    );
    const height = entry.height;
    if (height === null) continue;
    const isGraded = "inBand" in height;
    const shown = isGraded ? String(height.value) : "—";
    const mark = !isGraded ? "no gap of these kinds" : height.inBand ? "in" : "OUT";
    lines.push(`      height  ${shown.padStart(7)}  ${rangeOf(height).padEnd(16)} ${mark}`);
  }
  return lines;
}

function textReport(
  where: string,
  measurement: PlanMeasurement,
  report: PlanBandReport | null,
): string[] {
  const screens = measurement.height / measurement.screenHeight;
  const subject =
    measurement.episodeId !== null
      ? `planned ${measurement.episodeId} in ${where}`
      : `planned ${measurement.planName ?? "an episode"} from ${where}`;
  const lines = [
    subject,
    `  ${measurement.width}x${measurement.height}px — ${screens.toFixed(2)} screens at aspect ${measurement.screenAspect}`,
    `  ${measurement.cuts} cut(s), ${measurement.transitions.gaps} gap(s) drawn — from the declarations, no image read`,
  ];
  // A cut with no declared shape is graded on the fallback, which is a shape
  // nobody asked for. Said here rather than left to the panel figures, which is
  // where it would otherwise be invisible.
  if (measurement.cutsWithoutDeclaredShape > 0) {
    lines.push(
      `  note: ${measurement.cutsWithoutDeclaredShape} of ${measurement.cuts} cuts declare no panelAspect; they were graded at the fallback ${measurement.fallbackAspect}, not at a shape the pack asked for.`,
    );
  }
  const provenance = report?.provenance ?? null;
  if (provenance !== null) {
    const episodes = provenance.works.reduce((sum, work) => sum + work.episodes, 0);
    lines.push(`  measured from ${provenance.works.length} work(s), ${episodes} episode(s)`);
    for (const work of provenance.works) {
      const detail = [
        `${work.episodes} episode(s)`,
        `${work.captureMode} capture`,
        `${work.constantColumnWidth ? "constant" : "varying"} column width`,
      ];
      if (work.language !== undefined) detail.push(work.language);
      if (work.pageLengthInWidths !== undefined) {
        detail.push(`${work.pageLengthInWidths} column widths of page`);
      }
      lines.push(`    ${work.label} — ${detail.join(", ")}`);
    }
  }
  // Each beat's own span, never a median over them: the lengths of a real
  // episode's beats are not similar to each other — one contiguous capture ran
  // from 0.50 to 17.18 column widths inside a single episode — so a summary
  // would hide exactly the unevenness an author is checking for.
  if (measurement.beats !== null) {
    lines.push(`  beats — ${measurement.beats.length}, in column widths`);
    const labelWidth = Math.max(4, ...measurement.beats.map((beat) => beat.label.length));
    for (const beat of measurement.beats) {
      lines.push(
        `    ${beat.label.padEnd(labelWidth)}  ${String(beat.cuts).padStart(3)} cut(s)  ${String(beat.lengthInWidths).padStart(8)}`,
      );
    }
  }
  const graded = new Map(report?.metrics.map((verdict) => [verdict.metric, verdict]) ?? []);
  const kept = new Map(report?.recorded.map((entry) => [entry.metric, entry]) ?? []);
  const names = Object.keys(measurement.metrics) as (keyof PlanMeasurement["metrics"])[];
  const width = Math.max(...names.map((name) => name.length));
  for (const name of names) {
    const shown = String(measurement.metrics[name]);
    const verdict = graded.get(name);
    if (verdict) {
      lines.push(
        `  ${name.padEnd(width)}  ${shown.padStart(8)}  ${rangeOf(verdict).padEnd(14)} ${verdict.inBand ? "in" : "OUT"}`,
      );
      continue;
    }
    const entry = kept.get(name);
    if (entry) {
      lines.push(
        `  ${name.padEnd(width)}  ${shown.padStart(8)}  ${rangeOf(entry).padEnd(14)} recorded, not graded`,
      );
      continue;
    }
    lines.push(`  ${name.padEnd(width)}  ${shown.padStart(8)}`);
  }
  lines.push(...transitionLines(measurement.transitions, report?.transitions ?? []));
  // Always, band or no band. The five figures above are a page-structure check
  // and nothing else, and a reader who does not see the other six named will
  // take them for the measurement.
  lines.push("  NOT CHECKED — a plan has no pixels. `toony measure` reads these once art exists:");
  for (const entry of measurement.unchecked) {
    lines.push(`    ${entry.metric} ${entry.reason}`);
  }
  if (report) {
    const out = report.metrics.filter((verdict) => !verdict.inBand).length;
    const outEntries = report.transitions.filter((verdict) => !verdict.inBand).length;
    const label = report.name === null ? "band" : `band "${report.name}"`;
    const checked =
      report.transitions.length === 0
        ? `${report.metrics.length} metric(s)`
        : `${report.metrics.length} metric(s) and ${report.transitions.length} transition entry(s)`;
    // The unchecked count comes FIRST in the failing line and is never omitted
    // from either, so neither reads as a whole verdict.
    const skipped =
      report.unchecked.length === 0
        ? " — the band grades nothing a plan cannot check"
        : ` — ${report.unchecked.length} further metric(s) the band grades NOT CHECKED (${report.unchecked.map((entry) => entry.metric).join(", ")})`;
    lines.push(
      report.checkedInBand
        ? `plan verdict: IN BAND ON WHAT A PLAN CHECKS — ${checked} against ${label}${skipped}`
        : `plan verdict: OUT OF BAND — ${out} of ${report.metrics.length} metric(s) and ${outEntries} of ${report.transitions.length} transition entry(s) outside ${label}${skipped}`,
    );
  }
  return lines;
}

/** Run `toony plan`. Returns the process exit code. */
export async function runPlan(args: string[], io: PlanIo): Promise<number> {
  const parsed = parse(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  const episodeId = parsed.values.get("--episode");
  const specArg = parsed.values.get("--spec");
  if ((episodeId === undefined) === (specArg === undefined)) {
    io.err("give exactly one of --episode <id> (an episode's own lists) or --spec <file> (a plan)");
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const widthArg = parsed.values.get("--width");
  let width: number | undefined;
  if (widthArg !== undefined) {
    const error = validateExportInt(
      Number(widthArg),
      "--width",
      EXPORT_WIDTH_MIN,
      EXPORT_WIDTH_MAX,
    );
    if (error) {
      io.err(error);
      return EXIT_USAGE;
    }
    width = Number(widthArg);
  }

  const aspectArg = parsed.values.get("--screen-aspect");
  let screenAspect: number | undefined;
  if (aspectArg !== undefined) {
    const value = Number(aspectArg);
    if (!Number.isFinite(value) || value <= 0) {
      io.err("--screen-aspect must be a positive number");
      return EXIT_USAGE;
    }
    screenAspect = value;
  }

  // A band names either a pack-contributed band id or a band file on disk, and
  // is resolved exactly as `toony measure` resolves it — the same target, graded
  // earlier, has to be named the same way.
  let band: CraftBand | null = null;
  const against = parsed.values.get("--against");
  if (against !== undefined) {
    const packs = await discoverPackContent(root, io);
    const file = packs.craftBands.get(against) ?? resolve(io.cwd, against);
    const loaded = await readBand(file);
    if ("error" in loaded) {
      for (const line of loaded.error) io.err(line);
      return EXIT_USAGE;
    }
    band = loaded;
  }

  const aspect = screenAspect ?? band?.screenAspect ?? DEFAULT_SCREEN_ASPECT;

  let measurement: PlanMeasurement;
  let where: string;
  if (specArg !== undefined) {
    const specFile = resolve(io.cwd, specArg);
    const plan = await readPlan(specFile);
    if ("error" in plan) {
      for (const line of plan.error) io.err(line);
      return EXIT_USAGE;
    }
    measurement = measurePlan(plan, { width, screenAspect: aspect });
    where = relative(io.cwd, specFile) || specFile;
  } else {
    try {
      measurement = await measureEpisodePlan(root, episodeId as string, {
        width,
        screenAspect: aspect,
      });
    } catch (cause) {
      if (cause instanceof ExportError || cause instanceof ProjectIoError) {
        io.err(`plan failed: ${cause.message}`);
        return EXIT_USAGE;
      }
      throw cause;
    }
    where = relative(io.cwd, root) || ".";
  }

  const report = band === null ? null : comparePlanToCraftBand(measurement, band);
  if (parsed.json) {
    io.out(
      JSON.stringify(
        {
          root,
          episodeId: measurement.episodeId,
          planName: measurement.planName,
          width: measurement.width,
          height: measurement.height,
          screenAspect: measurement.screenAspect,
          screenHeight: measurement.screenHeight,
          cuts: measurement.cuts,
          cutsWithoutDeclaredShape: measurement.cutsWithoutDeclaredShape,
          fallbackAspect: measurement.fallbackAspect,
          beats: measurement.beats,
          metrics: measurement.metrics,
          unchecked: measurement.unchecked,
          transitions: measurement.transitions,
          band: report,
        },
        null,
        2,
      ),
    );
  } else {
    for (const line of textReport(where, measurement, report)) io.out(line);
  }
  return report !== null && !report.checkedInBand ? EXIT_VALIDATION : EXIT_OK;
}
