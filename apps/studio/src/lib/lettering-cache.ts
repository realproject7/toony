// Which lettering an open cut editor should start from, and when it must
// remount. The episode page renders every cut's saved lettering from disk; a
// cut editor in this tab may have saved newer lettering since. The episode
// editor keeps what it saved per cut and keys each cut editor by the saved
// revision it started from:
//   - the editor's own saves never remount it (its undo history survives);
//   - a newer revision written elsewhere (the agent, another tab) remounts it
//     with the server's lettering;
//   - "Reload it" bumps a nonce to force a remount.

import type { LetteringOverlay } from "@toony/schema";

export interface SavedCut {
  /** The server revision the editor was mounted from. */
  base: string;
  /** The newest revision this tab saved. */
  revision: string;
  /** Every revision this editor started from or saved, newest last. */
  known: string[];
  bubbles: LetteringOverlay[];
}

const KNOWN_MAX = 50;

/** Whether the server's revision is one this tab already holds for the cut. */
export function cacheMatches(cached: SavedCut | undefined, serverRevision: string): boolean {
  return cached?.known.includes(serverRevision) === true;
}

/** Record a save made by the open editor. The base stays while the cache still matches. */
export function rememberSave(
  previous: SavedCut | undefined,
  serverRevision: string,
  bubbles: LetteringOverlay[],
  revision: string,
): SavedCut {
  const keep = previous !== undefined && cacheMatches(previous, serverRevision);
  const base = keep ? previous.base : serverRevision;
  const known = [...(keep ? previous.known : [serverRevision]), revision].slice(-KNOWN_MAX);
  return { base, revision, known, bubbles };
}

/** The lettering and revision an editor for this cut starts from. */
export function startingLettering(
  serverBubbles: LetteringOverlay[],
  serverRevision: string,
  cached: SavedCut | undefined,
): { bubbles: LetteringOverlay[]; revision: string } {
  return cached && cacheMatches(cached, serverRevision)
    ? { bubbles: cached.bubbles, revision: cached.revision }
    : { bubbles: serverBubbles, revision: serverRevision };
}

/** The React key for a cut editor: stable across own saves, new for outside changes. */
export function letteringEditorKey(
  cutId: string,
  serverRevision: string,
  cached: SavedCut | undefined,
  nonce = 0,
): string {
  const revision = cached && cacheMatches(cached, serverRevision) ? cached.base : serverRevision;
  return `${cutId}:${revision}:${nonce}`;
}
