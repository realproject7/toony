// Read a Toony project folder from disk into the in-memory model and validate it.
//
// This is the single shared loader consumed by the CLI (`toony validate`,
// `toony studio`), the studio app, and downstream tickets (#6 preview, #7, #10).
// It reads YAML content files and JSON structural files, assembles the
// `@toony/schema` `Project`, and runs `validateProject`. IO/parse failures throw
// `ProjectIoError`; schema problems are returned in `validation`.

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import {
  type EpisodeBundle,
  type Project,
  type ValidationResult,
  validateProject,
} from "@toony/schema";
import { ProjectIoError } from "./errors.js";
import { decodeJson, decodeYaml } from "./format.js";
import {
  cutsFile,
  episodeFile,
  episodesDir,
  letteringFile,
  transitionsFile,
  webtoonPath,
} from "./paths.js";

/** Outcome of a successful read: the assembled model plus its validation result. */
export interface LoadedProject {
  root: string;
  project: Project;
  validation: ValidationResult;
}

type Codec = (text: string) => unknown;

async function readWith(file: string, codec: Codec, kind: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not read ${file}: ${reason}`, file);
  }
  try {
    return codec(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`invalid ${kind} in ${file}: ${reason}`, file);
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
    throw new ProjectIoError(`could not read episodes directory: ${reason}`, episodesDir(root));
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Read and assemble a project from disk, then validate it.
 *
 * Throws `ProjectIoError` for IO/parse failures (the caller maps these to a
 * usage/IO exit code). Schema violations are NOT thrown — they are returned in
 * `validation` so callers can report them and exit with the validation code.
 */
export async function loadProject(root: string): Promise<LoadedProject> {
  const webtoon = await readWith(webtoonPath(root), decodeJson, "JSON");

  const episodeIds = await listEpisodeIds(root);
  const episodes: EpisodeBundle[] = [];
  for (const id of episodeIds) {
    const episode = await readWith(episodeFile(root, id), decodeYaml, "YAML");
    const cuts = await readWith(cutsFile(root, id), decodeYaml, "YAML");
    const transitions = await readWith(transitionsFile(root, id), decodeYaml, "YAML");
    const lettering = await readWith(letteringFile(root, id), decodeJson, "JSON");
    episodes.push({
      // The validator type-checks every field; parsed values are kept as-is so
      // structural problems surface as actionable issues rather than throws.
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

/** Per-episode counts derived from a loaded project, for overview UIs. */
export interface EpisodeSummary {
  id: string;
  title: string;
  cutCount: number;
  transitionCount: number;
}

/** Reduce a loaded project's episodes to id/title/cut/transition counts. */
export function summarizeEpisodes(loaded: LoadedProject): EpisodeSummary[] {
  return loaded.project.episodes.map((bundle) => ({
    id: bundle.episode.id,
    title: bundle.episode.title,
    cutCount: bundle.cuts.length,
    transitionCount: bundle.transitions.length,
  }));
}
