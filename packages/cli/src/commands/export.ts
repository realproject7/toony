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
} from "@toony/export";
import { ProjectIoError } from "@toony/project-io";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

export interface ExportIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

const TARGETS = new Set(["platform", "stitched", "plotlink"]);
const VALUE_FLAGS = new Set(["--episode", "--width", "--format", "--quality"]);

const USAGE =
  "usage: toony export <platform|stitched|plotlink> [path] --episode <id> [--width <px>] [--format png|jpg] [--quality <0-100>]";

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

function parsePositiveInt(
  value: string | undefined,
  name: string,
): number | undefined | { error: string } {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return { error: `${name} must be a positive integer` };
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

  const target = parsed.positional[0];
  if (target === undefined || !TARGETS.has(target)) {
    io.err("first argument must be one of: platform, stitched, plotlink");
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

  const width = parsePositiveInt(parsed.values.get("--width"), "--width");
  if (width !== undefined && typeof width === "object") {
    io.err(width.error);
    return EXIT_USAGE;
  }
  const quality = parsePositiveInt(parsed.values.get("--quality"), "--quality");
  if (quality !== undefined && typeof quality === "object") {
    io.err(quality.error);
    return EXIT_USAGE;
  }

  const options: ExportOptions = {
    width: typeof width === "number" ? width : undefined,
    format: formatArg === undefined ? undefined : formatArg === "png" ? "png" : "jpeg",
    quality: typeof quality === "number" ? quality : undefined,
  };

  const root = resolve(io.cwd, parsed.positional[1] ?? ".");

  try {
    let result: ExportOutput;
    if (target === "platform") result = await exportPlatform(root, episodeId, options);
    else if (target === "stitched") result = await exportStitched(root, episodeId, options);
    else result = await exportPlotlink(root, episodeId, options);

    const { manifest } = result;
    io.out(
      `exported ${target}: ${manifest.files.length} file(s) for ${episodeId} → ${relative(root, result.outDir)}`,
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
