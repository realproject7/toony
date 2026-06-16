// Canonical on-disk layout for a Toony project folder.
//
// The schema package (`@toony/schema`) owns the in-memory `Project` model and
// its validators; it deliberately does not read files. This module is the single
// definition of how that model maps onto a folder of files so the loader (read)
// and the scaffolder (write) cannot drift apart.
//
// Structured records are stored as JSON. The project format draft sketches YAML
// for some files, but JSON keeps the loader dependency-free, round-trips
// byte-stably through `@toony/schema` serialization, and stays Node 20 portable.

import { join } from "node:path";

/** Name of the project root manifest. */
export const WEBTOON_FILE = "webtoon.json";

/** Directory holding one folder per episode. */
export const EPISODES_DIR = "episodes";

/** Per-episode record file names. */
export const EPISODE_FILE = "episode.json";
export const CUTS_FILE = "cuts.json";
export const TRANSITIONS_FILE = "transitions.json";
export const LETTERING_FILE = "lettering.json";

/** Story-bible / style documents at the project root. */
export const STORY_BIBLE_FILE = "story-bible.md";
export const STYLE_GUIDE_FILE = "style-guide.md";

/**
 * Folders that always exist in a scaffolded project, expressed as path segments.
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
