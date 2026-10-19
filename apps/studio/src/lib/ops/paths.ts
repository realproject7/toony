// Project-relative paths a write may touch. Every path a write plan names is
// built by ops code from ids that were checked first; this module refuses any
// path that is absolute, climbs out, or names a reserved place.

import { isAbsolute, join, normalize, sep } from "node:path";
import { isPathSafeId } from "@toony/schema";
import { OpError } from "./errors.js";

/** Join a checked project-relative path onto the project root. */
export function projectPath(root: string, relative: string): string {
  const normal = normalize(relative);
  if (
    relative === "" ||
    isAbsolute(relative) ||
    normal.startsWith("..") ||
    normal.split(sep).includes("..") ||
    normal !== relative.split("/").join(sep)
  ) {
    throw new OpError("failed", "Toony refused an unsafe file path.");
  }
  return join(root, normal);
}

/** Refuse an episode or cut id that cannot name a folder or file. */
export function assertSafeId(id: string, what: string): void {
  if (!isPathSafeId(id)) throw new OpError("not-found", `This ${what} does not exist.`);
}

export const episodeFiles = (episodeId: string) => ({
  episode: `episodes/${episodeId}/episode.yaml`,
  cuts: `episodes/${episodeId}/cuts.yaml`,
  transitions: `episodes/${episodeId}/transitions.yaml`,
  lettering: `episodes/${episodeId}/lettering.json`,
  folder: `episodes/${episodeId}`,
  script: `script/episodes/${episodeId}.json`,
  draft: `.toony/drafts/${episodeId}.json`,
});
