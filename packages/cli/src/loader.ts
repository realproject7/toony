// Server-side project loader.
//
// Reads a Toony project folder from disk, assembles the in-memory `Project`
// model, and runs `@toony/schema`'s `validateProject`. This is the data layer
// shared by `toony validate`, `toony studio`, and the studio app (#6 consumes
// `loadProject` directly). It does not print or exit — callers decide that.

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import {
  type EpisodeBundle,
  type Project,
  type ValidationResult,
  validateProject,
} from "@toony/schema";
import {
  cutsFile,
  episodeFile,
  episodesDir,
  letteringFile,
  transitionsFile,
  webtoonPath,
} from "./paths.js";

/** A file-system or JSON-parse failure while reading the project. */
export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "ProjectLoadError";
  }
}

/** Outcome of a successful read: the assembled model plus its validation result. */
export interface LoadedProject {
  root: string;
  project: Project;
  validation: ValidationResult;
}

async function readJsonFile(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectLoadError(`could not read ${file}: ${reason}`, file);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectLoadError(`invalid JSON in ${file}: ${reason}`, file);
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** List episode directory names in deterministic (sorted) order. */
async function listEpisodeIds(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(episodesDir(root), { withFileTypes: true });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectLoadError(`could not read episodes directory: ${reason}`, episodesDir(root));
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Read and assemble a project from disk, then validate it.
 *
 * Throws `ProjectLoadError` for IO/parse failures (the caller maps these to a
 * usage/IO exit code). Schema violations are NOT thrown — they are returned in
 * `validation` so callers can report them and exit with the validation code.
 */
export async function loadProject(root: string): Promise<LoadedProject> {
  const webtoon = await readJsonFile(webtoonPath(root));

  const episodeIds = await listEpisodeIds(root);
  const episodes: EpisodeBundle[] = [];
  for (const id of episodeIds) {
    const episode = await readJsonFile(episodeFile(root, id));
    const cuts = await readJsonFile(cutsFile(root, id));
    const transitions = await readJsonFile(transitionsFile(root, id));
    const lettering = await readJsonFile(letteringFile(root, id));
    episodes.push({
      // The validator type-checks every field; we keep the parsed values as-is
      // so structural problems surface as actionable issues rather than throws.
      episode: episode as EpisodeBundle["episode"],
      cuts: asArray(cuts) as EpisodeBundle["cuts"],
      transitions: asArray(transitions) as EpisodeBundle["transitions"],
      lettering: asArray(lettering) as EpisodeBundle["lettering"],
    });
  }

  const project = { webtoon, episodes } as Project;
  const validation = validateProject(project);
  return { root, project, validation };
}
