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
  const graded = new Map(report?.metrics.map((verdict) => [verdict.metric, verdict]) ?? []);
  const names = Object.keys(measurement.metrics) as (keyof CraftMeasurement["metrics"])[];
  const width = Math.max(...names.map((name) => name.length));
  for (const name of names) {
    const value = measurement.metrics[name];
    const shown = value === null ? "—" : String(value);
    const verdict = graded.get(name);
    if (!verdict) {
      lines.push(`  ${name.padEnd(width)}  ${shown.padStart(8)}`);
      continue;
    }
    const range = `${verdict.min ?? "*"}..${verdict.max ?? "*"}`;
    lines.push(
      `  ${name.padEnd(width)}  ${shown.padStart(8)}  ${range.padEnd(14)} ${verdict.inBand ? "in" : "OUT"}`,
    );
  }
  if (report) {
    const out = report.metrics.filter((verdict) => !verdict.inBand).length;
    const label = report.name === null ? "band" : `band "${report.name}"`;
    lines.push(
      report.inBand
        ? `verdict: IN BAND — ${report.metrics.length} metric(s) graded against ${label}`
        : `verdict: OUT OF BAND — ${out} of ${report.metrics.length} metric(s) outside ${label}`,
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

  const report = band === null ? null : compareToCraftBand(measurement.metrics, band);
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
