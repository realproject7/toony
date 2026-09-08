// `toony validate [path]` — load and validate a project folder.
//
// `--require-images` adds an OPT-IN completeness check (#204). It is opt-in
// because `image: null` is legitimate mid-production and the shipped examples
// depend on it: making it an error by default would fail a valid project. The
// check exists so a partially generated episode is caught before export or
// measurement, rather than surfacing later as a band figure that was partly
// measuring blank space.

import { resolve } from "node:path";
import { loadProject, ProjectIoError } from "@toony/project-io";
import type { Project } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { jsonReport, textReport } from "../report.js";

export interface ValidateIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** A cut that an episode renders but has no image asset for. */
export interface CutWithoutImage {
  episodeId: string;
  cutId: string;
}

/**
 * Every cut an episode would RENDER with no image asset behind it.
 *
 * Both halves match what the renderer and `toony measure` already do, so this
 * reports the same cuts that would compose as neutral fill: a cut is scoped by
 * the episode's `sequence` (a cut left out of it never renders), and its asset
 * is `final` falling back to `clean`.
 */
export function cutsWithoutImage(project: Project): CutWithoutImage[] {
  const missing: CutWithoutImage[] = [];
  for (const bundle of project.episodes) {
    const byId = new Map(bundle.cuts.map((cut) => [cut.id, cut]));
    for (const item of bundle.episode.sequence) {
      if (item.type !== "cut") continue;
      const cut = byId.get(item.id);
      if (cut === undefined) continue;
      if ((cut.image?.final ?? cut.image?.clean ?? null) === null) {
        missing.push({ episodeId: bundle.episode.id, cutId: cut.id });
      }
    }
  }
  return missing;
}

/** Run `toony validate`. Returns the process exit code. */
export async function runValidate(args: string[], io: ValidateIo): Promise<number> {
  let json = false;
  let requireImages = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--require-images") requireImages = true;
    else if (arg.startsWith("-")) {
      io.err(`unknown option: ${arg}`);
      return EXIT_USAGE;
    } else positional.push(arg);
  }

  const root = resolve(io.cwd, positional[0] ?? ".");

  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(root);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      if (json) io.out(JSON.stringify({ root, valid: false, error: cause.message }, null, 2));
      else io.err(`load error: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }

  const missing = requireImages ? cutsWithoutImage(loaded.project) : null;

  if (json) {
    const report = jsonReport(root, loaded.validation);
    // Only present when the check ran, so the default payload is unchanged.
    io.out(JSON.stringify(missing === null ? report : { ...report, missing }, null, 2));
  } else {
    io.out(textReport(root, loaded.validation));
    if (missing !== null) {
      if (missing.length === 0) io.out("every rendered cut has an image asset.");
      else {
        io.out(`${missing.length} cut(s) with no image asset:`);
        for (const cut of missing) io.out(`  - ${cut.episodeId} ${cut.cutId}`);
      }
    }
  }
  return loaded.validation.valid && (missing === null || missing.length === 0)
    ? EXIT_OK
    : EXIT_VALIDATION;
}
