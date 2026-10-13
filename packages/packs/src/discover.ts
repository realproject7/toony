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
import {
  asLetteringTheme,
  asStyleLexicon,
  type EpisodeBundle,
  type LetteringTheme,
  type StyleLexicon,
  type ValidationIssue,
  validateLetteringThemeValue,
  validateStyleLexiconValue,
} from "@toony/schema";
import {
  PACK_MANIFEST_FILE,
  PACKS_ENV_VAR,
  type PackExportPreset,
  type PackManifest,
  type PackWorkflowReference,
  PROJECT_PACKS_DIR,
} from "./manifest.js";
import { asPackManifest, validateGenreScaffold, validatePackManifest } from "./validate.js";

/** A genre scaffold contributed by a pack: a ready-to-seed episode bundle. */
export interface PackGenre {
  id: string;
  title: string;
  bundle: EpisodeBundle;
  /**
   * The gutter strip width this genre letters in (#215), a fraction of the cut
   * width, or absent when the genre declares none. `toony init --genre <id>`
   * writes it into the new project's `webtoon.json`.
   */
  gutterBandWidth?: number;
}

/** The names one pack put into the merged content. */
export interface PackContributions {
  /** Workflow names. */
  workflows: readonly string[];
  /** Genre ids. */
  genres: readonly string[];
  /** Export preset ids. */
  exportPresets: readonly string[];
  /** Craft band ids. */
  craftBands: readonly string[];
  /** Lettering theme ids (#334). */
  letteringThemes: readonly string[];
  /** Style lexicon ids (#335). */
  styleLexicons: readonly string[];
}

/** One discovered, valid pack. */
export interface PackSummary {
  id: string;
  name: string;
  /** Absolute path to the pack directory. */
  dir: string;
  /** Absolute path to the pack root the directory was found in. */
  root: string;
  /**
   * What this pack contributed AFTER the merge, not what its manifest declared.
   * A name an earlier pack already claimed, and a file that could not be read,
   * are absent here and carried in `issues` instead.
   */
  contributes: PackContributions;
}

/** A problem with one pack. The pack is skipped; the core keeps working. */
export interface PackIssue extends ValidationIssue {
  /** Absolute path to the pack directory (or the manifest that failed to load). */
  pack: string;
}

/** Everything packs contribute, merged across all discovered packs. */
/** A lettering theme a pack contributed (#334), parsed and validated at discovery. */
export interface PackLetteringTheme {
  id: string;
  theme: LetteringTheme;
}

/** A style lexicon a pack contributed (#335), parsed and validated at discovery. */
export interface PackStyleLexicon {
  id: string;
  lexicon: StyleLexicon;
}

export interface PackContent {
  /** Named ComfyUI workflow graphs: workflow name → absolute JSON file path. */
  workflows: ReadonlyMap<string, string>;
  /** Workflows that take a reference sheet (#327): workflow name → the node input. */
  workflowReferences: ReadonlyMap<string, PackWorkflowReference>;
  genres: readonly PackGenre[];
  exportPresets: readonly PackExportPreset[];
  /** Craft bands (#196): band id → absolute JSON file path. */
  craftBands: ReadonlyMap<string, string>;
  letteringThemes: readonly PackLetteringTheme[];
  styleLexicons: readonly PackStyleLexicon[];
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
  workflowReferences: new Map(),
  letteringThemes: [],
  styleLexicons: [],
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

/**
 * Read + validate one pack directory's manifest. Returns the manifest or the
 * issues that made it unusable, with the same codes discovery reports, so a
 * caller checking a directory before discovery sees it fail the same way.
 */
export async function readPackManifest(dir: string): Promise<PackManifest | PackIssue[]> {
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
interface PackIssueLike {
  path: string;
  code: string;
  message: string;
}

/**
 * Read and validate a pack's `{ id, file }` contribution (#334, #335), the way
 * a genre scaffold is read: the file is parsed here because its format belongs
 * to `@toony/schema`, which this package already depends on.
 */
async function readJsonContribution<T>(
  dir: string,
  file: string,
  path: string,
  what: string,
  code: string,
  validate: (value: unknown) => { valid: boolean; issues: readonly PackIssueLike[] },
  narrow: (value: Record<string, unknown>) => T,
): Promise<T | PackIssue[]> {
  const abs = resolve(dir, file);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return [
      {
        pack: dir,
        path,
        code: `${code}.file-missing`,
        message: `${what} file "${file}" could not be read.`,
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
        code: `${code}.file-parse`,
        message: `${what} file "${file}" is not valid JSON.`,
      },
    ];
  }
  const result = validate(parsed);
  if (!result.valid) {
    return result.issues.map((issue) => ({ ...issue, pack: dir, path: `${path}: ${issue.path}` }));
  }
  return narrow(parsed as Record<string, unknown>);
}

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
  const workflowReferences = new Map<string, PackWorkflowReference>();
  const genres: PackGenre[] = [];
  const exportPresets: PackExportPreset[] = [];
  const craftBands = new Map<string, string>();
  const letteringThemes: PackLetteringTheme[] = [];
  const styleLexicons: PackStyleLexicon[] = [];
  const themeIds = new Set<string>();
  const lexiconIds = new Set<string>();
  const presetIds = new Set<string>();
  const genreIds = new Set<string>();
  const packIds = new Set<string>();

  for (const packRoot of packRoots(root, env)) {
    for (const dir of await listPackDirs(packRoot)) {
      const manifest = await readPackManifest(dir);
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
      const contributedWorkflows: [string, string, PackWorkflowReference | undefined][] = [];
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
        contributedWorkflows.push([workflow.name, abs, workflow.reference]);
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
        contributedGenres.push({
          id: genre.id,
          title: genre.title,
          bundle,
          ...(genre.gutterBandWidth === undefined
            ? {}
            : { gutterBandWidth: genre.gutterBandWidth }),
        });
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

      const contributedThemes: PackLetteringTheme[] = [];
      for (const entry of manifest.letteringThemes) {
        if (themeIds.has(entry.id)) {
          claimed.push({
            pack: dir,
            path: `letteringThemes.${entry.id}`,
            code: "pack.lettering-theme.claimed",
            message: `lettering theme id "${entry.id}" is already provided by an earlier pack; rename it in this pack.`,
          });
          continue;
        }
        const theme = await readJsonContribution(
          dir,
          entry.file,
          `letteringThemes.${entry.id}`,
          "lettering theme",
          "pack.lettering-theme",
          validateLetteringThemeValue,
          asLetteringTheme,
        );
        if (Array.isArray(theme)) {
          claimed.push(...theme);
          continue;
        }
        contributedThemes.push({ id: entry.id, theme });
      }

      const contributedLexicons: PackStyleLexicon[] = [];
      for (const entry of manifest.styleLexicons) {
        if (lexiconIds.has(entry.id)) {
          claimed.push({
            pack: dir,
            path: `styleLexicons.${entry.id}`,
            code: "pack.style-lexicon.claimed",
            message: `style lexicon id "${entry.id}" is already provided by an earlier pack; rename it in this pack.`,
          });
          continue;
        }
        const lexicon = await readJsonContribution(
          dir,
          entry.file,
          `styleLexicons.${entry.id}`,
          "style lexicon",
          "pack.style-lexicon",
          validateStyleLexiconValue,
          asStyleLexicon,
        );
        if (Array.isArray(lexicon)) {
          claimed.push(...lexicon);
          continue;
        }
        contributedLexicons.push({ id: entry.id, lexicon });
      }

      issues.push(...claimed);
      for (const [id, abs] of contributedBands) craftBands.set(id, abs);
      for (const theme of contributedThemes) {
        themeIds.add(theme.id);
        letteringThemes.push(theme);
      }
      for (const lexicon of contributedLexicons) {
        lexiconIds.add(lexicon.id);
        styleLexicons.push(lexicon);
      }
      for (const [name, abs, reference] of contributedWorkflows) {
        workflows.set(name, abs);
        if (reference !== undefined) workflowReferences.set(name, reference);
      }
      for (const genre of contributedGenres) {
        genreIds.add(genre.id);
        genres.push(genre);
      }
      for (const preset of contributedPresets) {
        presetIds.add(preset.id);
        exportPresets.push(preset);
      }
      packIds.add(manifest.id);
      packs.push({
        id: manifest.id,
        name: manifest.name,
        dir,
        root: packRoot,
        contributes: {
          workflows: contributedWorkflows.map(([name]) => name),
          genres: contributedGenres.map((genre) => genre.id),
          exportPresets: contributedPresets.map((preset) => preset.id),
          craftBands: contributedBands.map(([id]) => id),
          letteringThemes: contributedThemes.map((theme) => theme.id),
          styleLexicons: contributedLexicons.map((lexicon) => lexicon.id),
        },
      });
    }
  }

  return {
    packs,
    content: {
      workflows,
      workflowReferences,
      genres,
      exportPresets,
      craftBands,
      letteringThemes,
      styleLexicons,
    },
    issues,
  };
}
