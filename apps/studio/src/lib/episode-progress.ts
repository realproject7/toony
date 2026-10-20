// What the story page says about an episode's progress: how many cuts it has,
// how many have artwork, how many are lettered and how many the person marked
// final. Pure over the loaded episode, so it is unit tested.

import type { EpisodeBundle } from "@toony/schema";

export interface EpisodeProgress {
  cuts: number;
  withArt: number;
  lettered: number;
  final: number;
}

export function episodeProgress(bundle: EpisodeBundle): EpisodeProgress {
  const letteredCuts = new Set(bundle.lettering.map((overlay) => overlay.cutId));
  let withArt = 0;
  let lettered = 0;
  let final = 0;
  for (const cut of bundle.cuts) {
    if (cut.image?.final || cut.image?.clean) withArt += 1;
    if (letteredCuts.has(cut.id)) lettered += 1;
    if (cut.reviewStatus === "final") final += 1;
  }
  return { cuts: bundle.cuts.length, withArt, lettered, final };
}

/** One short line, for example "4 cuts · 2 with art · 1 lettered". */
export function progressLine(progress: EpisodeProgress): string {
  if (progress.cuts === 0) return "No cuts yet";
  const parts = [`${progress.cuts} ${progress.cuts === 1 ? "cut" : "cuts"}`];
  parts.push(progress.withArt === 0 ? "no art yet" : `${progress.withArt} with art`);
  if (progress.lettered > 0) parts.push(`${progress.lettered} lettered`);
  if (progress.final > 0) parts.push(`${progress.final} final`);
  return parts.join(" · ");
}
