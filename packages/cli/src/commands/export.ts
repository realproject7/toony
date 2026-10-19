// `toony export <episode> --output <id>`: write an episode strip, cut images or
// social frames.
//
// Headless export lives in `@toony/export`; this command parses arguments,
// resolves the output (a built-in or a pack preset), checks that every flag
// applies to it, runs it, and reports the files and any notes.

import { relative, resolve } from "node:path";
import {
  ExportError,
  type ExportOptions,
  exportWithPreset,
  listExportPresetIds,
  resolveExportPreset,
} from "@toony/export";
import { ProjectIoError } from "@toony/project-io";
import {
  EXPORT_QUALITY_MAX,
  EXPORT_QUALITY_MIN,
  EXPORT_WIDTH_MAX,
  EXPORT_WIDTH_MIN,
  type ExportTargetKind,
  validateExportInt,
  validateExportMargin,
  validateExportMaxBytes,
  validateExportSliceHeight,
} from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { discoverPackContent } from "../packs.js";

export interface ExportIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Process environment; `TOONY_PACKS` names extra pack directories. */
  env?: Record<string, string | undefined>;
}

const VALUE_FLAGS = new Set([
  "--output",
  "--target",
  "--episode",
  "--width",
  "--slice-height",
  "--max-bytes",
  "--format",
  "--quality",
  "--margin",
  "--tall-cuts",
]);
const BOOLEAN_FLAGS = new Set(["--text-cards"]);

const USAGE =
  "usage: toony export <episode> [path] --output <strip|cuts|instagram|instagram-square|x|webtoon|preset> [--width <px>] [--slice-height <px>] [--format png|jpg] [--quality <0-100>] [--margin <px>]";

/** Which engines each option flag applies to. */
const FLAG_KINDS: Record<string, readonly ExportTargetKind[]> = {
  "--width": ["strip", "cuts"],
  "--slice-height": ["strip"],
  "--max-bytes": ["strip"],
  "--margin": ["cuts"],
  "--text-cards": ["cuts"],
  "--tall-cuts": ["social"],
};

interface Parsed {
  positional: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

function parse(args: string[]): Parsed | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: `${arg} requires a value` };
      values.set(arg, value);
      i++;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg);
    } else if (arg.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, flags };
}

function parseIntFlag(
  value: string | undefined,
  check: (value: number, name: string) => string | null,
  name: string,
): number | undefined | { error: string } {
  if (value === undefined) return undefined;
  // Bounds and the integer-range check are shared with the Studio route and
  // pack presets via @toony/schema, so they cannot silently diverge (#87). A
  // non-numeric arg becomes NaN, which fails the integer check.
  const n = Number(value);
  const error = check(n, name);
  return error ? { error } : n;
}

/** Run `toony export`. Returns the process exit code. */
export async function runExport(args: string[], io: ExportIo): Promise<number> {
  const parsed = parse(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const positional = [...parsed.positional];
  const flagEpisode = parsed.values.get("--episode");
  const flagOutput = parsed.values.get("--output") ?? parsed.values.get("--target");
  if (parsed.values.has("--output") && parsed.values.has("--target")) {
    io.err("use --output or --target, not both");
    return EXIT_USAGE;
  }
  // `toony export <episode> [path] --output <id>`. The earlier form
  // `toony export <output> [path] --episode <id>` still works: with --episode
  // and no --output, the first argument names the output.
  const episodeId = flagEpisode ?? positional.shift();
  const outputId =
    flagOutput ?? (flagEpisode !== undefined ? positional.shift() : undefined) ?? "strip";
  const root = resolve(io.cwd, positional.shift() ?? ".");
  if (positional.length > 0) {
    io.err(`unexpected argument: ${positional[0]}`);
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if (episodeId === undefined) {
    io.err("missing episode: name the episode to export, for example ep-001");
    io.err(USAGE);
    return EXIT_USAGE;
  }

  // The output is an export PRESET: a built-in, the alias stitched or
  // platform, or one an installed pack contributes (#192).
  const packs = await discoverPackContent(root, io);
  const preset = await resolveExportPreset(outputId, packs.exportPresets);
  if (preset === undefined) {
    const available = await listExportPresetIds(packs.exportPresets);
    io.err(`--output must be one of: ${available.join(", ")}`);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  // A flag that does not apply to the chosen engine is a usage error rather
  // than something silently ignored.
  for (const [flag, kinds] of Object.entries(FLAG_KINDS)) {
    const given = parsed.values.has(flag) || parsed.flags.has(flag);
    if (given && !kinds.includes(preset.target)) {
      io.err(`${flag} does not apply to ${preset.id} (${preset.target} output)`);
      return EXIT_USAGE;
    }
  }

  const formatArg = parsed.values.get("--format");
  if (formatArg !== undefined && !["png", "jpg", "jpeg"].includes(formatArg)) {
    io.err('--format must be "png" or "jpg"');
    return EXIT_USAGE;
  }
  const tallCuts = parsed.values.get("--tall-cuts");
  if (tallCuts !== undefined && tallCuts !== "split" && tallCuts !== "fit") {
    io.err('--tall-cuts must be "split" or "fit"');
    return EXIT_USAGE;
  }

  const numbers = {
    width: parseIntFlag(
      parsed.values.get("--width"),
      (n, name) => validateExportInt(n, name, EXPORT_WIDTH_MIN, EXPORT_WIDTH_MAX),
      "--width",
    ),
    quality: parseIntFlag(
      parsed.values.get("--quality"),
      (n, name) => validateExportInt(n, name, EXPORT_QUALITY_MIN, EXPORT_QUALITY_MAX),
      "--quality",
    ),
    sliceHeight: parseIntFlag(
      parsed.values.get("--slice-height"),
      validateExportSliceHeight,
      "--slice-height",
    ),
    maxBytes: parseIntFlag(parsed.values.get("--max-bytes"), validateExportMaxBytes, "--max-bytes"),
    margin: parseIntFlag(parsed.values.get("--margin"), validateExportMargin, "--margin"),
  };
  for (const value of Object.values(numbers)) {
    if (value !== undefined && typeof value === "object") {
      io.err(value.error);
      return EXIT_USAGE;
    }
  }

  // An explicit flag always wins over what the preset pins; an option neither
  // supplies stays undefined so the engine applies its own default.
  const options: ExportOptions = {
    width: numbers.width as number | undefined,
    quality: numbers.quality as number | undefined,
    sliceHeight: numbers.sliceHeight as number | undefined,
    maxBytes: numbers.maxBytes as number | undefined,
    margin: numbers.margin as number | undefined,
    format: formatArg === undefined ? undefined : formatArg === "png" ? "png" : "jpeg",
    textCards: parsed.flags.has("--text-cards") ? true : undefined,
    tallCuts: tallCuts as ExportOptions["tallCuts"],
  };
  const format = options.format ?? preset.options.format ?? "png";
  if (options.quality !== undefined && format !== "jpeg") {
    io.err("--quality applies to JPEG only; add --format jpg");
    return EXIT_USAGE;
  }

  try {
    const result = await exportWithPreset(root, episodeId, preset, options);
    const { manifest } = result;
    io.out(
      `exported ${preset.id}: ${manifest.files.length} file(s) for ${episodeId} → ${relative(root, result.outDir)}`,
    );
    for (const warning of manifest.warnings) io.out(`note: ${warning.message}`);
    return EXIT_OK;
  } catch (cause) {
    if (cause instanceof ExportError || cause instanceof ProjectIoError) {
      io.err(`export failed: ${cause.message}`);
      return cause instanceof ExportError && cause.code === "invalid-project"
        ? EXIT_VALIDATION
        : EXIT_USAGE;
    }
    throw cause;
  }
}
