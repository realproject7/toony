// Change scopes as stable string keys, and the two questions the browser asks
// about them:
//   - does a change touch what this page shows (`changeTouchesView`)?
//   - does a change overlap what an open editor holds unsaved (`scopesOverlap`)?
//
// Key format, one per `ChangeScope` kind:
//   work | story | characters | episodes
//   episode:<episodeId> | sequence:<episodeId> | export:<episodeId>
//   cut:<episodeId>/<cutId> | lettering:<episodeId>/<cutId> | artwork:<episodeId>/<cutId>
// Editors register their dirty state under these keys (`registerEditorScope`).

import type { ChangeScope } from "../agent/protocol.js";

export function scopeKey(scope: ChangeScope): string {
  switch (scope.kind) {
    case "work":
    case "story":
    case "characters":
    case "episodes":
      return scope.kind;
    case "episode":
    case "sequence":
    case "export":
      return `${scope.kind}:${scope.episodeId}`;
    case "cut":
    case "lettering":
    case "artwork":
      return `${scope.kind}:${scope.episodeId}/${scope.cutId}`;
  }
}

/** Parse a key made by `scopeKey`. Returns null for anything else. */
export function parseScopeKey(key: string): ChangeScope | null {
  if (key === "work" || key === "story" || key === "characters" || key === "episodes") {
    return { kind: key };
  }
  const match = /^(episode|sequence|export|cut|lettering|artwork):([^/]+)(?:\/(.+))?$/.exec(key);
  if (!match) return null;
  const [, kind, episodeId, cutId] = match;
  if (episodeId === undefined) return null;
  if (kind === "episode" || kind === "sequence" || kind === "export") {
    return cutId === undefined ? { kind, episodeId } : null;
  }
  if ((kind === "cut" || kind === "lettering" || kind === "artwork") && cutId !== undefined) {
    return { kind, episodeId, cutId };
  }
  return null;
}

function episodeOf(scope: ChangeScope): string | null {
  return "episodeId" in scope ? scope.episodeId : null;
}

/**
 * Whether a change to `a` can invalidate unsaved edits held for `b` (or the
 * reverse). Equal scopes overlap, and a whole-episode scope overlaps every scope
 * inside that episode (an episode deleted, renamed or rebuilt replaces them
 * all). Exports change no project data and overlap nothing.
 */
export function scopesOverlap(a: ChangeScope, b: ChangeScope): boolean {
  if (a.kind === "export" || b.kind === "export") return false;
  if (scopeKey(a) === scopeKey(b)) return true;
  const episode = episodeOf(a);
  if (episode === null || episode !== episodeOf(b)) return false;
  return a.kind === "episode" || b.kind === "episode";
}

/**
 * Whether a change with `changeScopes` touches a page showing `view`. `"all"`
 * is a page that summarizes the whole work (the story page, the library card).
 * `work` changes (a rename) touch every page of the work, since every page
 * shows its title.
 */
export function changeTouchesView(
  view: readonly ChangeScope[] | "all",
  changeScopes: readonly ChangeScope[],
): boolean {
  if (view === "all") return true;
  if (changeScopes.some((scope) => scope.kind === "work")) return true;
  return changeScopes.some((change) =>
    view.some((shown) => scopesOverlap(shown, change) || containsScope(shown, change)),
  );
}

/** A page showing `outer` also shows everything listed under it. */
function containsScope(outer: ChangeScope, inner: ChangeScope): boolean {
  if (outer.kind === "episodes") return inner.kind === "episodes" || "episodeId" in inner;
  if (outer.kind === "cut" && (inner.kind === "lettering" || inner.kind === "artwork")) {
    return outer.episodeId === inner.episodeId && outer.cutId === inner.cutId;
  }
  return false;
}
