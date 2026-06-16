// `toony lint [path]` and `toony lint-episode <id> [path]` — run the headless
// `@toony/lint` checks against a loaded project.
//
// All lint logic lives in `@toony/lint` (schema/sequence, image analysis,
// bubble-text overflow via `@toony/render`, export-manifest completeness via
// `@toony/export`'s manifest contract). This command loads the project from disk
// via `@toony/project-io`, resolves cut images and export manifests, aggregates
// findings, and reports them with agent-readable exit codes.
//
// Exit codes: 0 when no error/warning findings (advisory `info` findings, such
// as skipped pixel analysis on non-PNG assets, do not change the code); 1 when
// any error/warning finding is present; 2 for usage or IO failure.

import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EXPORT_TARGET_KINDS, MANIFEST_FILE } from "@toony/export";
import {
  analyzeImageBuffer,
  type Finding,
  finding,
  lintBubbleOverflow,
  lintManifestCompleteness,
  lintProjectSchema,
  type ManifestFileProbe,
  sortFindings,
} from "@toony/lint";
import { loadProject, ProjectIoError } from "@toony/project-io";
import type { EpisodeBundle } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

export interface LintIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

const LINT_EPISODE_USAGE = "usage: toony lint-episode <episode-id> [path] [--json]";

interface ParsedArgs {
  json: boolean;
  positional: string[];
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let json = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { error: `unknown option: ${arg}` };
    else positional.push(arg);
  }
  return { json, positional };
}

/** Cut's preferred image ref: the final art if present, else the clean plate. */
function cutImageRef(bundle: EpisodeBundle, cutId: string): string | null {
  const cut = bundle.cuts.find((c) => c.id === cutId);
  return cut?.image?.final ?? cut?.image?.clean ?? null;
}

/** Read every cut's image bytes once; unreadable refs become an error finding. */
async function resolveCutImages(
  root: string,
  bundle: EpisodeBundle,
  findings: Finding[],
): Promise<Map<string, Uint8Array | null>> {
  const images = new Map<string, Uint8Array | null>();
  for (const cut of bundle.cuts) {
    const ref = cutImageRef(bundle, cut.id);
    if (ref === null) {
      images.set(cut.id, null);
      continue;
    }
    try {
      images.set(cut.id, new Uint8Array(await readFile(`${root}/${ref}`)));
    } catch {
      images.set(cut.id, null);
      findings.push(
        finding(
          "error",
          "asset/unreadable",
          cut.id,
          `cut "${cut.id}" references an image that could not be read.`,
        ),
      );
    }
  }
  return images;
}

/** Lint export manifests that exist under the episode's `exports/<target>` dirs. */
async function lintEpisodeManifests(root: string, episodeId: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const target of EXPORT_TARGET_KINDS) {
    const rel = `episodes/${episodeId}/exports/${target}/${MANIFEST_FILE}`;
    let text: string;
    try {
      text = await readFile(`${root}/${rel}`, "utf8");
    } catch {
      // No export for this target — not a finding; exports are optional.
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      findings.push(finding("error", "manifest/invalid", rel, "manifest is not valid JSON."));
      continue;
    }
    const resolveFile = (path: string): ManifestFileProbe | null => {
      try {
        const stat = statSync(`${root}/${path}`);
        return { exists: stat.isFile(), byteSize: stat.size };
      } catch {
        return { exists: false, byteSize: 0 };
      }
    };
    findings.push(...lintManifestCompleteness(parsed, rel, resolveFile));
  }
  return findings;
}

/** Run image, overflow, and manifest checks for one well-formed episode. */
async function lintEpisode(root: string, bundle: EpisodeBundle): Promise<Finding[]> {
  const findings: Finding[] = [];
  const images = await resolveCutImages(root, bundle, findings);

  for (const cut of bundle.cuts) {
    const bytes = images.get(cut.id);
    if (bytes) findings.push(...analyzeImageBuffer(bytes, cut.id));
  }

  findings.push(...lintBubbleOverflow(bundle, (cutId) => images.get(cutId) ?? null));
  findings.push(...(await lintEpisodeManifests(root, bundle.episode.id)));
  return findings;
}

/** True when any finding is blocking (error/warning); info findings are advisory. */
function hasBlockingFindings(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "error" || f.severity === "warning");
}

function textLintReport(label: string, findings: readonly Finding[]): string {
  if (findings.length === 0) return `clean: ${label}`;
  const lines = [`${findings.length} finding(s): ${label}`];
  for (const f of findings) {
    lines.push(`  [${f.severity}] ${f.code} ${f.targetId}`);
    lines.push(`    ${f.message}`);
  }
  return lines.join("\n");
}

async function lintAndReport(
  root: string,
  episodeId: string | null,
  json: boolean,
  io: LintIo,
): Promise<number> {
  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(root);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      if (json) {
        io.out(JSON.stringify({ root, episodeId, clean: false, error: cause.message }, null, 2));
      } else {
        io.err(`load error: ${cause.message}`);
      }
      return EXIT_USAGE;
    }
    throw cause;
  }

  const findings: Finding[] = [];
  // Schema/sequence validity is project-wide and a precondition for the deeper
  // checks, which assume well-formed records. Report schema findings always; run
  // image/overflow/manifest checks only when the project is structurally valid.
  findings.push(...lintProjectSchema(loaded.project));

  let bundles = loaded.project.episodes;
  if (episodeId !== null) {
    const bundle = bundles.find((b) => b.episode.id === episodeId);
    if (!bundle) {
      const message = `episode not found: ${episodeId}`;
      if (json) io.out(JSON.stringify({ root, episodeId, clean: false, error: message }, null, 2));
      else io.err(message);
      return EXIT_USAGE;
    }
    bundles = [bundle];
  }

  if (loaded.validation.valid) {
    for (const bundle of bundles) findings.push(...(await lintEpisode(root, bundle)));
  }

  const sorted = sortFindings(findings);
  const blocking = hasBlockingFindings(sorted);
  const label = episodeId === null ? root : `${root} (episode ${episodeId})`;
  if (json) {
    io.out(
      JSON.stringify(
        { root, episodeId, clean: !blocking, findingCount: sorted.length, findings: sorted },
        null,
        2,
      ),
    );
  } else {
    io.out(textLintReport(label, sorted));
  }
  return blocking ? EXIT_VALIDATION : EXIT_OK;
}

/** Run `toony lint [path] [--json]` over the whole project. */
export async function runLint(args: string[], io: LintIo): Promise<number> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  return lintAndReport(root, null, parsed.json, io);
}

/** Run `toony lint-episode <id> [path] [--json]` over a single episode. */
export async function runLintEpisode(args: string[], io: LintIo): Promise<number> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(LINT_EPISODE_USAGE);
    return EXIT_USAGE;
  }
  const episodeId = parsed.positional[0];
  if (episodeId === undefined) {
    io.err("missing required <episode-id>");
    io.err(LINT_EPISODE_USAGE);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[1] ?? ".");
  return lintAndReport(root, episodeId, parsed.json, io);
}
