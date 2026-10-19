// What the story page shows, built on the server from the loaded project:
// episodes in reading order with progress and their last change, the cast with
// a portrait when a reference sheet exists, and the story text. Ids stay in
// links only; nothing here is shown raw.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedProject } from "@toony/project-io";
import { type EpisodeProgress, episodeProgress } from "./episode-progress.js";
import { episodeFiles } from "./ops/paths.js";
import { assetUrl } from "./project.js";

export interface StoryEpisode {
  id: string;
  number: number;
  title: string;
  progress: EpisodeProgress;
  /** ISO time of the newest episode file, or "" when unknown. */
  updatedAt: string;
}

export interface CastMember {
  id: string;
  name: string;
  role: string | null;
  portrait: string | null;
}

async function newest(root: string, files: string[]): Promise<string> {
  let best = 0;
  for (const file of files) {
    try {
      const info = await stat(join(root, file));
      if (info.mtimeMs > best) best = info.mtimeMs;
    } catch {
      // A missing file does not count.
    }
  }
  return best > 0 ? new Date(best).toISOString() : "";
}

export async function storyEpisodes(root: string, loaded: LoadedProject): Promise<StoryEpisode[]> {
  return Promise.all(
    loaded.project.episodes.map(async (bundle, index) => {
      const files = episodeFiles(bundle.episode.id);
      return {
        id: bundle.episode.id,
        number: index + 1,
        title: bundle.episode.title?.trim() || `Episode ${index + 1}`,
        progress: episodeProgress(bundle),
        updatedAt: await newest(root, [
          files.episode,
          files.cuts,
          files.transitions,
          files.lettering,
        ]),
      };
    }),
  );
}

export function castMembers(workId: string, root: string, loaded: LoadedProject): CastMember[] {
  return (loaded.project.webtoon.characters ?? []).map((character) => ({
    id: character.id,
    name: character.name,
    role: character.development?.role?.trim() || null,
    portrait:
      (character.references ?? [])
        .map((path) => assetUrl(workId, root, path))
        .find((url): url is string => url !== null) ?? null,
  }));
}
