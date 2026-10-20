// Short, human labels for change summaries: "Cut 3", "Episode 2".
// Cuts are numbered by their place in the episode's reading order.

import type { LoadedProject } from "@toony/project-io";
import type { EpisodeBundle } from "@toony/schema";

export function findEpisode(loaded: LoadedProject, episodeId: string): EpisodeBundle | undefined {
  return loaded.project.episodes.find((bundle) => bundle.episode.id === episodeId);
}

/** The episode's title, or its id when it has none. */
export function episodeLabel(bundle: EpisodeBundle | undefined, episodeId: string): string {
  const title = bundle?.episode.title?.trim();
  return title ? title : episodeId;
}

/** 1-based position of a cut in reading order, or 0 when it is not in the episode. */
export function cutNumber(bundle: EpisodeBundle | undefined, cutId: string): number {
  if (bundle === undefined) return 0;
  const ordered = bundle.episode.sequence
    .filter((item) => item.type === "cut")
    .map((item) => item.id);
  const index = ordered.indexOf(cutId);
  if (index !== -1) return index + 1;
  const fallback = bundle.cuts.findIndex((cut) => cut.id === cutId);
  return fallback === -1 ? 0 : fallback + 1;
}

/** "Cut 3 of Episode 2", or "a cut of Episode 2" when the cut is unknown. */
export function cutLabel(loaded: LoadedProject, episodeId: string, cutId: string): string {
  const bundle = findEpisode(loaded, episodeId);
  const n = cutNumber(bundle, cutId);
  return `${n > 0 ? `Cut ${n}` : "a cut"} of ${episodeLabel(bundle, episodeId)}`;
}
