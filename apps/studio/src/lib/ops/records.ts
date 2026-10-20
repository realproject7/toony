// Write an episode's records (cuts, lettering, transitions, reading order)
// after an edit, in an order that keeps every reference resolvable if the
// process stops between two files: new cuts land before anything names them,
// and removed cuts leave only after nothing names them any more. The worst
// interrupted state is an orphan record, which validation reports and the next
// save clears; the write path's snapshot restores the whole set on a failure.

import type { LoadedProject } from "@toony/project-io";
import {
  encodeJson,
  encodeYaml,
  writeCuts,
  writeLettering,
  writeTransitions,
} from "@toony/project-io";
import { type EpisodeBundle, validateProject } from "@toony/schema";
import { OpError } from "./errors.js";

function same(a: unknown, b: unknown, yaml = true): boolean {
  return yaml ? encodeYaml(a) === encodeYaml(b) : encodeJson(a) === encodeJson(b);
}

/** Refuse an edited episode that would not validate with its project. */
export function assertEpisodeValid(loaded: LoadedProject, next: EpisodeBundle): void {
  const index = loaded.project.episodes.findIndex((b) => b.episode.id === next.episode.id);
  const episodes = loaded.project.episodes.map((b, i) => (i === index ? next : b));
  const result = validateProject({ webtoon: loaded.project.webtoon, episodes });
  const prefix = `episodes[${index}]`;
  const own = result.issues.filter((issue) => issue.path.startsWith(prefix));
  if (own.length > 0) {
    const detail = own
      .slice(0, 3)
      .map((issue) => issue.message)
      .join(" ");
    throw new OpError("invalid", `This edit would leave the episode invalid: ${detail}`);
  }
}

export async function writeEpisodeRecords(
  root: string,
  before: EpisodeBundle,
  after: EpisodeBundle,
): Promise<void> {
  const episodeId = after.episode.id;
  const afterIds = new Set(after.cuts.map((cut) => cut.id));
  const removed = before.cuts.filter((cut) => !afterIds.has(cut.id));
  const union = [...after.cuts, ...removed];
  if (!same(before.cuts, union)) await writeCuts(root, episodeId, union);
  if (!same(before.lettering, after.lettering, false)) {
    await writeLettering(root, episodeId, after.lettering);
  }
  if (!same(before.transitions, after.transitions) || !same(before.episode, after.episode)) {
    await writeTransitions(root, episodeId, after.episode, after.transitions, after.cuts);
  }
  if (removed.length > 0) await writeCuts(root, episodeId, after.cuts);
}
