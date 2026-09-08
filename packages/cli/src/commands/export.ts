// `toony export <platform|stitched|plotlink>` — render export targets.
//
// Headless export lives in `@toony/export`; this command parses args, dispatches
// to the right target, and reports the manifest summary. Studio UI is #6's scope.

import { relative, resolve } from "node:path";
import {
  ExportError,
  type ExportOptions,
  type ExportOutput,
  exportPlatform,
  exportPlotlink,
  exportStitched,
  listExportPresetIds,
  resolveExportPreset,
} from "@toony/export";
import { ProjectIoError } from "@toony/project-io";
import {
  EXPORT_QUALITY_MAX,
  EXPORT_QUALITY_MIN,
  EXPORT_WIDTH_MAX,
  EXPORT_WIDTH_MIN,
  validateExportInt,
} from "@toony/schema";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";
import { discoverPackContent } from "../packs.js";

export interface ExportIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Process environment; `TOONY_PACKS` names extra pack directories. */
  env?: Record<string, string | undefined>;
}

const VALUE_FLAGS = new Set(["--episode", "--width", "--format", "--quality"]);

const USAGE =
  "usage: toony export <platform|stitched|plotlink|preset> [path] --episode <id> [--width <px>] [--format png|jpg] [--quality <0-100>]";

interface Parsed {
  positional: string[];
  values: Map<string, string>;
}

function parse(args: string[]): Parsed | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg)) {
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
  return { positional, values };
}

function parseIntInRange(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined | { error: string } {
  if (value === undefined) return undefined;
  const n = Number(value);
  // Bounds + the integer-range check are shared with the Studio route via
  // @toony/schema so the CLI and the route cannot silently diverge (#87). A
  // non-numeric arg becomes NaN, which fails the integer check below.
  const error = validateExportInt(n, name, min, max);
  if (error) return { error };
  return n;
}

/** Run `toony export`. Returns the process exit code. */
export async function runExport(args: string[], io: ExportIo): Promise<number> {
  const parsed = parse(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[1] ?? ".");

  // The first argument names an export PRESET: one of the three built-ins, or
  // one contributed by an installed pack (#192). A preset selects a built-in
  // engine and pins render options; with no packs installed the registry holds
  // exactly the three built-ins with nothing pinned, so this resolves to the
  // same engine and the same options as before the seam existed.
  const packs = await discoverPackContent(root, io);
  const presetId = parsed.positional[0];
  const preset =
    presetId === undefined ? undefined : await resolveExportPreset(presetId, packs.exportPresets);
  if (preset === undefined) {
    const available = await listExportPresetIds(packs.exportPresets);
    io.err(`first argument must be one of: ${available.join(", ")}`);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const episodeId = parsed.values.get("--episode");
  if (episodeId === undefined) {
    io.err("missing required --episode <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const formatArg = parsed.values.get("--format");
  if (formatArg !== undefined && !["png", "jpg", "jpeg"].includes(formatArg)) {
    io.err('--format must be "png" or "jpg"');
    return EXIT_USAGE;
  }

  const width = parseIntInRange(
    parsed.values.get("--width"),
    "--width",
    EXPORT_WIDTH_MIN,
    EXPORT_WIDTH_MAX,
  );
  if (width !== undefined && typeof width === "object") {
    io.err(width.error);
    return EXIT_USAGE;
  }
  const quality = parseIntInRange(
    parsed.values.get("--quality"),
    "--quality",
    EXPORT_QUALITY_MIN,
    EXPORT_QUALITY_MAX,
  );
  if (quality !== undefined && typeof quality === "object") {
    io.err(quality.error);
    return EXIT_USAGE;
  }

  // An explicit flag always wins over what the preset pins; an option neither
  // supplies stays undefined so the engine applies its own default.
  const options: ExportOptions = {
    width: typeof width === "number" ? width : preset.options.width,
    format: formatArg === undefined ? preset.options.format : formatArg === "png" ? "png" : "jpeg",
    quality: typeof quality === "number" ? quality : preset.options.quality,
  };

  try {
    let result: ExportOutput;
    if (preset.target === "platform") result = await exportPlatform(root, episodeId, options);
    else if (preset.target === "stitched") result = await exportStitched(root, episodeId, options);
    else result = await exportPlotlink(root, episodeId, options);

    const { manifest } = result;
    io.out(
      `exported ${preset.id}: ${manifest.files.length} file(s) for ${episodeId} → ${relative(root, result.outDir)}`,
    );
    if (manifest.markdown) {
      io.out(`markdown: ${manifest.markdown.characters} chars at ${manifest.markdown.path}`);
    }
    return EXIT_OK;
  } catch (cause) {
    if (cause instanceof ExportError || cause instanceof ProjectIoError) {
      io.err(`export failed: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
}
