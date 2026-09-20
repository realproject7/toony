// `toony measure [path] --episode <id>` — grade a rendered episode's craft.
//
// The second half of the style-pack build loop. A pack sets craft knobs — the
// transition gutter budget, cut height distribution, cut density, palette, and
// whether art reads full-bleed or inset — and every one of them is visible in the
// rendered page. This command reads them back as numbers, so a pack is finished
// when its output lands inside a target band instead of when it looks about right.
//
// Measurement lives in `@toony/export` (it composes the same page the stitched
// export encodes, so no provider and no prior export are needed); this command
// parses args, resolves the band, and reports.
//
// Exit codes: 0 measured (and, with --against, in band); 1 out of band; 2 usage
// or IO failure.

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  asCraftBand,
  type CraftBand,
  type CraftBandReport,
  type CraftMeasurement,
  compareToCraftBand,
  DEFAULT_SCREEN_ASPECT,
  ExportError,
  measureEpisodeCraft,
  validateCraftBandValue,
} from "@toony/export";
import { ProjectIoError } from "@toony/project-io";
import { EXPORT_WIDTH_MAX, EXPORT_WIDTH_MIN, validateExportInt } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { discoverPackContent } from "../packs.js";

export interface MeasureIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Process environment; `TOONY_PACKS` names extra pack directories. */
  env?: Record<string, string | undefined>;
}

const VALUE_FLAGS = new Set(["--episode", "--against", "--width", "--screen-aspect"]);

const USAGE =
  "usage: toony measure [path] --episode <id> [--against <band-id|band.json>] [--json] [--width <px>] [--screen-aspect <n>]";

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

/** A range end the band left open prints as `*`, the same as a metric's does. */
function rangeOf(verdict: { min: number | null; max: number | null }): string {
  return `${verdict.min ?? "*"}..${verdict.max ?? "*"}`;
}

/**
 * What kind of gap the episode puts between its cuts, and — when the band
 * declares a vocabulary — how that compares.
 *
 * The mix always prints, band or no band, because it is a measurement like the
 * table above it and because it is what you read to author a range in the first
 * place. It says on its own line that it comes from the declared transition
 * records: the numbers above are read off pixels and these are not, and a
 * reader who takes them for the same kind of evidence will trust the wrong one.
 */
function transitionLines(
  mix: CraftMeasurement["transitions"],
  graded: NonNullable<CraftBandReport["transitions"]>,
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
    if (entry.height === null) continue;
    // A height range with no gap of these kinds to measure is NOT a pass, and
    // must never print as one: the share range above already decided whether
    // zero of them was allowed, and this row has nothing left to say.
    const height = entry.height;
    const shown = height.value === null ? "—" : String(height.value);
    const mark = height.value === null ? "no gap of these kinds" : height.inBand ? "in" : "OUT";
    lines.push(`      height  ${shown.padStart(7)}  ${rangeOf(height).padEnd(16)} ${mark}`);
  }
  return lines;
}

function textReport(
  root: string,
  measurement: CraftMeasurement,
  report: CraftBandReport | null,
): string[] {
  const screens = measurement.height / measurement.screenHeight;
  const lines = [
    `measured ${measurement.episodeId} in ${root}`,
    `  ${measurement.width}x${measurement.height}px — ${screens.toFixed(2)} screens at aspect ${measurement.screenAspect}`,
  ];
  if (measurement.cutsWithoutImage > 0) {
    lines.push(
      `  note: ${measurement.cutsWithoutImage} of ${measurement.cuts} cuts have no image asset; their neutral fill measures as empty space.`,
    );
  }
  // What the band was measured from, before the numbers it produced: a range
  // read off two sampled episodes and one read off twenty whole ones are not
  // the same claim, and only this says which one is on screen.
  const provenance = report?.provenance ?? null;
  if (provenance !== null) {
    const episodes = provenance.works.reduce((sum, work) => sum + work.episodes, 0);
    lines.push(`  measured from ${provenance.works.length} work(s), ${episodes} episode(s)`);
    // The capture facts are per work, so they print per work: two works captured
    // differently would be misreported by any single summary line.
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
  const graded = new Map(report?.metrics.map((verdict) => [verdict.metric, verdict]) ?? []);
  const kept = new Map(report?.recorded.map((entry) => [entry.metric, entry]) ?? []);
  const names = Object.keys(measurement.metrics) as (keyof CraftMeasurement["metrics"])[];
  const width = Math.max(...names.map((name) => name.length));
  for (const name of names) {
    const value = measurement.metrics[name];
    const shown = value === null ? "—" : String(value);
    const verdict = graded.get(name);
    if (verdict) {
      const range = `${verdict.min ?? "*"}..${verdict.max ?? "*"}`;
      lines.push(
        `  ${name.padEnd(width)}  ${shown.padStart(8)}  ${range.padEnd(14)} ${verdict.inBand ? "in" : "OUT"}`,
      );
      continue;
    }
    // A recorded metric shows the range the band measured in the same column,
    // marked so it can never be read as a passed or failed grade.
    const entry = kept.get(name);
    if (entry) {
      const range = `${entry.min ?? "*"}..${entry.max ?? "*"}`;
      lines.push(
        `  ${name.padEnd(width)}  ${shown.padStart(8)}  ${range.padEnd(14)} recorded, not graded`,
      );
      continue;
    }
    lines.push(`  ${name.padEnd(width)}  ${shown.padStart(8)}`);
  }
  lines.push(...transitionLines(measurement.transitions, report?.transitions ?? []));
  if (report) {
    const outMetrics = report.metrics.filter((verdict) => !verdict.inBand).length;
    const outEntries = report.transitions.filter((verdict) => !verdict.inBand).length;
    const label = report.name === null ? "band" : `band "${report.name}"`;
    const also =
      report.recorded.length === 0
        ? ""
        : ` (${report.recorded.length} further metric(s) recorded, not graded)`;
    // With no vocabulary declared, these two lines are what they always were: a
    // band that does not use the field reports exactly as it did before it.
    const graded =
      report.transitions.length === 0
        ? `${report.metrics.length} metric(s)`
        : `${report.metrics.length} metric(s) and ${report.transitions.length} transition entry(s)`;
    const outside =
      report.transitions.length === 0
        ? `${outMetrics} of ${report.metrics.length} metric(s)`
        : `${outMetrics} of ${report.metrics.length} metric(s) and ${outEntries} of ${report.transitions.length} transition entry(s)`;
    lines.push(
      report.inBand
        ? `verdict: IN BAND — ${graded} graded against ${label}${also}`
        : `verdict: OUT OF BAND — ${outside} outside ${label}${also}`,
    );
  }
  return lines;
}

/** Run `toony measure`. Returns the process exit code. */
export async function runMeasure(args: string[], io: MeasureIo): Promise<number> {
  const parsed = parse(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  const episodeId = parsed.values.get("--episode");
  if (episodeId === undefined) {
    io.err("missing required --episode <id>");
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

  // A band names either a pack-contributed band id or a band file on disk. The
  // pack registry is consulted first, exactly as `toony export` resolves a
  // preset id before anything else, so a pack ships the target it was built to
  // hit and the operator names it rather than a path (#192 seam).
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

  // Precedence for the reading viewport: an explicit flag, then the band's own
  // aspect (a band is only comparable at the aspect it was measured at), then
  // the default.
  const aspect = screenAspect ?? band?.screenAspect ?? DEFAULT_SCREEN_ASPECT;

  let measurement: CraftMeasurement;
  try {
    measurement = await measureEpisodeCraft(root, episodeId, { width, screenAspect: aspect });
  } catch (cause) {
    if (cause instanceof ExportError || cause instanceof ProjectIoError) {
      io.err(`measure failed: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }

  const report = band === null ? null : compareToCraftBand(measurement, band);
  if (parsed.json) {
    io.out(
      JSON.stringify(
        {
          root,
          episodeId: measurement.episodeId,
          width: measurement.width,
          height: measurement.height,
          screenAspect: measurement.screenAspect,
          screenHeight: measurement.screenHeight,
          cuts: measurement.cuts,
          cutsWithoutImage: measurement.cutsWithoutImage,
          metrics: measurement.metrics,
          transitions: measurement.transitions,
          band: report,
        },
        null,
        2,
      ),
    );
  } else {
    for (const line of textReport(relative(io.cwd, root) || ".", measurement, report)) {
      io.out(line);
    }
  }
  return report !== null && !report.inBand ? EXIT_VALIDATION : EXIT_OK;
}
