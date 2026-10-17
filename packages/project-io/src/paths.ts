// Canonical on-disk layout for a Toony project folder.
//
// `@toony/schema` owns the in-memory `Project` model and its validators; it
// deliberately does not touch the filesystem. This module is the single
// definition of how that model maps onto a folder of files, so the reader and
// the writer in this package cannot drift apart.
//
// Per PROJECT_FORMAT.md the on-disk format is hybrid:
//   - YAML for episode content: `episode.yaml`, `cuts.yaml`, `transitions.yaml`
//   - JSON for structural/data files: `webtoon.json`, `lettering.json`

import { join } from "node:path";
import { isPathSafeId } from "@toony/schema";

/** Project root manifest (JSON). */
export const WEBTOON_FILE = "webtoon.json";

/** Directory holding one folder per episode. */
export const EPISODES_DIR = "episodes";

/** Per-episode content files (YAML). */
export const EPISODE_FILE = "episode.yaml";
export const CUTS_FILE = "cuts.yaml";
export const TRANSITIONS_FILE = "transitions.yaml";

/** Per-episode lettering overlays (JSON). */
export const LETTERING_FILE = "lettering.json";

/** Story-bible / style documents at the project root. */
export const STORY_BIBLE_FILE = "story-bible.md";
export const STYLE_GUIDE_FILE = "style-guide.md";

/**
 * Folders that always exist in a scaffolded project, as path segments.
 * Per-episode asset/export/log folders live under each episode directory.
 */
export const PROJECT_DIRS = ["assets", "logs"] as const;
export const EPISODE_DIRS = [
  "assets/clean",
  "assets/final",
  "exports/plotlink",
  "exports/platform",
  "exports/stitched",
  "logs",
] as const;

export function webtoonPath(root: string): string {
  return join(root, WEBTOON_FILE);
}

export function episodesDir(root: string): string {
  return join(root, EPISODES_DIR);
}

export function episodeDir(root: string, episodeId: string): string {
  // Defense in depth: the episode id is the only path segment derived from
  // project data here, and every per-episode path helper routes through this
  // function. Refuse an unsafe id (`..`, `/`, absolute, etc.) so a write or read
  // can never escape `episodes/` even if an upstream guard is missed (#74).
  if (!isPathSafeId(episodeId)) {
    throw new Error(`unsafe episode id: ${JSON.stringify(episodeId)}`);
  }
  return join(root, EPISODES_DIR, episodeId);
}

export function episodeFile(root: string, episodeId: string): string {
  return join(episodeDir(root, episodeId), EPISODE_FILE);
}

export function cutsFile(root: string, episodeId: string): string {
  return join(episodeDir(root, episodeId), CUTS_FILE);
}

export function transitionsFile(root: string, episodeId: string): string {
  return join(episodeDir(root, episodeId), TRANSITIONS_FILE);
}

export function letteringFile(root: string, episodeId: string): string {
  return join(episodeDir(root, episodeId), LETTERING_FILE);
}

// --- Authored planning artifacts (optional) ---------------------------------
//
// One folder holds the whole family, so "nothing else in a project reads this"
// is a single testable claim. It is created only by an explicit write of one of
// these artifacts: `writeProject` does not scaffold it, and a project without it
// loads, validates and exports exactly as it always did.

/** Folder holding the project's authored planning artifacts. */
export const SCRIPT_DIR = "script";

/** Project-level production brief (JSON), inside `SCRIPT_DIR`. */
export const BRIEF_FILE = "brief.json";

/** Folder holding one episode script per episode id, inside `SCRIPT_DIR`. */
export const SCRIPT_EPISODES_DIR = "episodes";

/** Filename suffix of one episode script. */
export const SCRIPT_FILE_SUFFIX = ".json";

export function scriptDir(root: string): string {
  return join(root, SCRIPT_DIR);
}

export function briefPath(root: string): string {
  return join(root, SCRIPT_DIR, BRIEF_FILE);
}

export function scriptEpisodesDir(root: string): string {
  return join(root, SCRIPT_DIR, SCRIPT_EPISODES_DIR);
}

export function episodeScriptFile(root: string, episodeId: string): string {
  // Same defense in depth as `episodeDir`: the episode id is the only path
  // segment derived from artifact data here, so an unsafe id is refused before
  // it is ever joined.
  if (!isPathSafeId(episodeId)) {
    throw new Error(`unsafe episode id: ${JSON.stringify(episodeId)}`);
  }
  return join(scriptEpisodesDir(root), `${episodeId}${SCRIPT_FILE_SUFFIX}`);
}
