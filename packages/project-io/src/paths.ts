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
export const PROJECT_DIRS = ["characters", "assets", "logs"] as const;
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
