// Pack discovery: find pack directories on the LOCAL filesystem, validate each
// manifest, and return the merged content the core registries consult.
//
// Pack roots are searched in this order, first claim winning:
//   1. every directory named by the `TOONY_PACKS` environment variable
//      (path-separated, like PATH) — an explicit, per-run operator instruction,
//      which is why it wins, matching how env beats config files elsewhere;
//   2. `<root>/.toony/packs`;
//   3. `<root>/../.toony/packs` — the workspace folder a project sits in, so a
//      pack installed once for a workspace is visible from inside each project,
//      the same parent lookup `toony generate` already does for the shared
//      ComfyUI config.
// A root that does not exist is simply skipped: with no packs installed this
// resolves to empty content and the core behaves exactly as it does without the
// seam. Within a root, pack directories are visited in sorted order so the
// result is deterministic.
//
// Nothing here reaches the network, spawns a process, or imports a module from a
// pack. It reads `toony-pack.json` plus the JSON data files that manifest names,
// and that is the whole of a pack's power.
//
// Discovery NEVER throws. A pack that is malformed is skipped and reported as an
// issue naming the pack, the path inside it, a machine code, and what to fix, so
// one bad pack can neither crash the core nor take the good packs down with it.

import { readdir, readFile, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import type { EpisodeBundle, ValidationIssue } from "@toony/schema";
import {
  PACK_MANIFEST_FILE,
  PACKS_ENV_VAR,
  type PackExportPreset,
  type PackManifest,
  PROJECT_PACKS_DIR,
} from "./manifest.js";
import { asPackManifest, validateGenreScaffold, validatePackManifest } from "./validate.js";

/** A genre scaffold contributed by a pack: a ready-to-seed episode bundle. */
export interface PackGenre {
  id: string;
  title: string;
  bundle: EpisodeBundle;
}

/** One discovered, valid pack. */
export interface PackSummary {
  id: string;
  name: string;
  /** Absolute path to the pack directory. */
  dir: string;
}

/** A problem with one pack. The pack is skipped; the core keeps working. */
export interface PackIssue extends ValidationIssue {
  /** Absolute path to the pack directory (or the manifest that failed to load). */
  pack: string;
}

/** Everything packs contribute, merged across all discovered packs. */
export interface PackContent {
  /** Named ComfyUI workflow graphs: workflow name → absolute JSON file path. */
  workflows: ReadonlyMap<string, string>;
  genres: readonly PackGenre[];
  exportPresets: readonly PackExportPreset[];
  /** Craft bands (#196): band id → absolute JSON file path. */
  craftBands: ReadonlyMap<string, string>;
}

/** Discovery result: the valid packs, their merged content, and any problems. */
export interface LoadedPacks {
  packs: readonly PackSummary[];
  content: PackContent;
  issues: readonly PackIssue[];
}

/** The empty content used when no packs are installed. */
export const EMPTY_PACK_CONTENT: PackContent = {
  workflows: new Map(),
  genres: [],
  exportPresets: [],
  craftBands: new Map(),
};

/** The pack root directories searched for `root`, highest precedence first. */
export function packRoots(root: string, env: Record<string, string | undefined> = {}): string[] {
  const roots: string[] = [];
  const fromEnv = env[PACKS_ENV_VAR];
  if (fromEnv !== undefined) {
    for (const entry of fromEnv.split(delimiter)) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) roots.push(isAbsolute(trimmed) ? trimmed : resolve(root, trimmed));
    }
  }
  const here = resolve(root);
  roots.push(resolve(here, PROJECT_PACKS_DIR));
  const parent = dirname(here);
  if (parent !== here) roots.push(resolve(parent, PROJECT_PACKS_DIR));
  return roots;
}

async function listPackDirs(packRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(packRoot, { withFileTypes: true });
    return (
      entries
        .filter((entry) => entry.isDirectory())
        // A pack collection is normally a git repository, so `.git` sits right
        // beside the packs. Reporting it as a pack missing its manifest fires a
        // guaranteed false warning on every command, and a warning channel that
        // is always wrong is one nobody reads when a real pack is malformed.
        .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
        .map((entry) => entry.name)
        .sort()
        .map((name) => resolve(packRoot, name))
    );
  } catch {
    // A missing or unreadable root is the normal zero-pack case, not an error.
    return [];
  }
}

function issuesFor(dir: string, issues: readonly ValidationIssue[]): PackIssue[] {
  return issues.map((issue) => ({ ...issue, pack: dir }));
}

/** Read + validate one pack's manifest. Returns the manifest or its issues. */
async function readManifest(dir: string): Promise<PackManifest | PackIssue[]> {
  const file = resolve(dir, PACK_MANIFEST_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [
      {
        pack: dir,
        path: PACK_MANIFEST_FILE,
        code: "pack.manifest-missing",
        message: `no ${PACK_MANIFEST_FILE} in this pack directory; every pack must declare one.`,
      },
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      {
        pack: dir,
        path: PACK_MANIFEST_FILE,
        code: "pack.manifest-parse",
        message: `${PACK_MANIFEST_FILE} is not valid JSON.`,
      },
    ];
  }
  const result = validatePackManifest(parsed);
  if (!result.valid) return issuesFor(dir, result.issues);
  return asPackManifest(parsed as Record<string, unknown>);
}

/** Read + validate one genre scaffold file. Returns the bundle or its issues. */
async function readScaffold(
  dir: string,
  file: string,
  path: string,
): Promise<EpisodeBundle | PackIssue[]> {
  const abs = resolve(dir, file);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return [
      {
        pack: dir,
        path,
        code: "pack.genre.file-missing",
        message: `genre scaffold file "${file}" could not be read.`,
      },
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      {
        pack: dir,
        path,
        code: "pack.genre.file-parse",
        message: `genre scaffold file "${file}" is not valid JSON.`,
      },
    ];
  }
  const result = validateGenreScaffold(parsed);
  if (!result.valid) {
    return result.issues.map((issue) => ({
      ...issue,
      pack: dir,
      path: `${path}: ${issue.path}`,
    }));
  }
  return parsed as EpisodeBundle;
}

/**
 * Discover the packs visible to `root` and return their merged content.
 *
 * Async from the first version — every registry lookup built on this returns a
 * Promise — so replacing local files with any other resolution later is a change
 * inside this module, not a refactor of every consumer.
 *
 * Merge rule: the first pack to claim a workflow name, genre id, or preset id
 * keeps it, and a later pack claiming the same one is reported and skipped
 * rather than silently shadowing it. The CORE's own built-in genres and export
 * targets always win over any pack; that is enforced where they are merged, so a
 * pack can never redefine what the core already does.
 */
export async function loadPacks(
  root: string,
  env: Record<string, string | undefined> = {},
): Promise<LoadedPacks> {
  const packs: PackSummary[] = [];
  const issues: PackIssue[] = [];
  const workflows = new Map<string, string>();
  const genres: PackGenre[] = [];
  const exportPresets: PackExportPreset[] = [];
  const craftBands = new Map<string, string>();
  const presetIds = new Set<string>();
  const genreIds = new Set<string>();
  const packIds = new Set<string>();

  for (const packRoot of packRoots(root, env)) {
    for (const dir of await listPackDirs(packRoot)) {
      const manifest = await readManifest(dir);
      if (Array.isArray(manifest)) {
        issues.push(...manifest);
        continue;
      }
      if (packIds.has(manifest.id)) {
        issues.push({
          pack: dir,
          path: "pack.id",
          code: "pack.duplicate",
          message: `pack id "${manifest.id}" is already provided by an earlier pack; this one is skipped.`,
        });
        continue;
      }

      const claimed: PackIssue[] = [];
      const contributedWorkflows: [string, string][] = [];
      for (const workflow of manifest.workflows) {
        const abs = resolve(dir, workflow.file);
        if (workflows.has(workflow.name)) {
          claimed.push({
            pack: dir,
            path: `workflows.${workflow.name}`,
            code: "pack.workflow.claimed",
            message: `workflow name "${workflow.name}" is already provided by an earlier pack; rename it in this pack.`,
          });
          continue;
        }
        try {
          await stat(abs);
        } catch {
          claimed.push({
            pack: dir,
            path: `workflows.${workflow.name}`,
            code: "pack.workflow.file-missing",
            message: `workflow file "${workflow.file}" could not be read.`,
          });
          continue;
        }
        contributedWorkflows.push([workflow.name, abs]);
      }

      const contributedGenres: PackGenre[] = [];
      for (const genre of manifest.genres) {
        if (genreIds.has(genre.id)) {
          claimed.push({
            pack: dir,
            path: `genres.${genre.id}`,
            code: "pack.genre.claimed",
            message: `genre id "${genre.id}" is already provided by an earlier pack; rename it in this pack.`,
          });
          continue;
        }
        const bundle = await readScaffold(dir, genre.file, `genres.${genre.id}`);
        if (Array.isArray(bundle)) {
          claimed.push(...bundle);
          continue;
        }
        contributedGenres.push({ id: genre.id, title: genre.title, bundle });
      }

      const contributedPresets: PackExportPreset[] = [];
      for (const preset of manifest.exportPresets) {
        if (presetIds.has(preset.id)) {
          claimed.push({
            pack: dir,
            path: `exportPresets.${preset.id}`,
            code: "pack.export-preset.claimed",
            message: `export preset id "${preset.id}" is already provided by an earlier pack; rename it in this pack.`,
          });
          continue;
        }
        contributedPresets.push(preset);
      }

      // A band is carried as a FILE PATH, like a workflow graph: `@toony/export`
      // owns the band format, so discovery checks the file is there and leaves
      // parsing to the consumer that has the measurement.
      const contributedBands: [string, string][] = [];
      for (const band of manifest.craftBands) {
        const abs = resolve(dir, band.file);
        if (craftBands.has(band.id)) {
          claimed.push({
            pack: dir,
            path: `craftBands.${band.id}`,
            code: "pack.craft-band.claimed",
            message: `craft band id "${band.id}" is already provided by an earlier pack; rename it in this pack.`,
          });
          continue;
        }
        try {
          await stat(abs);
        } catch {
          claimed.push({
            pack: dir,
            path: `craftBands.${band.id}`,
            code: "pack.craft-band.file-missing",
            message: `craft band file "${band.file}" could not be read.`,
          });
          continue;
        }
        contributedBands.push([band.id, abs]);
      }

      issues.push(...claimed);
      for (const [id, abs] of contributedBands) craftBands.set(id, abs);
      for (const [name, abs] of contributedWorkflows) workflows.set(name, abs);
      for (const genre of contributedGenres) {
        genreIds.add(genre.id);
        genres.push(genre);
      }
      for (const preset of contributedPresets) {
        presetIds.add(preset.id);
        exportPresets.push(preset);
      }
      packIds.add(manifest.id);
      packs.push({ id: manifest.id, name: manifest.name, dir });
    }
  }

  return { packs, content: { workflows, genres, exportPresets, craftBands }, issues };
}
