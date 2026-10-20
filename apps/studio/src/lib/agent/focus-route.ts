// What the person is looking at, from the browser location: the work, the page
// and the editor's selection (`?item=cut:<id>` / `?item=transition:<id>`, which
// the episode editor keeps in the URL). Pages can refine it further with
// `updateAgentFocus` (selected bubbles, a character). A page for an episode
// that does not exist yet still yields a usable focus: the server words it as
// a new episode instead of refusing the message. No Node or React imports.

import type { AgentFocus } from "./protocol.js";

export interface LocationFocus {
  /** The work the page belongs to, or null in the library and settings. */
  workId: string | null;
  focus: AgentFocus;
}

const SAFE = /^(?!\.{1,2}$)[\p{L}\p{N}_.-]{1,100}$/u;

function segment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  return SAFE.test(decoded) ? decoded : undefined;
}

/** Focus from a pathname and its query string (with or without the leading `?`). */
export function focusFromLocation(pathname: string, search = ""): LocationFocus {
  const parts = pathname.split("?")[0]?.split("/").filter(Boolean) ?? [];
  if (parts[0] === "settings") return { workId: null, focus: { route: "settings" } };
  if (parts[0] !== "w") return { workId: null, focus: { route: "library" } };
  const workId = segment(parts[1]);
  if (workId === undefined) return { workId: null, focus: { route: "library" } };
  const section = parts[2];
  if (section === undefined) return { workId, focus: { route: "story" } };
  if (section === "characters") return { workId, focus: { route: "characters" } };
  if (section !== "episodes") return { workId, focus: { route: "story" } };
  const episodeId = segment(parts[3]);
  if (episodeId === undefined) return { workId, focus: { route: "episode" } };
  const page = parts[4];
  const focus: AgentFocus = {
    route: page === "read" ? "preview" : page === "export" ? "export" : "episode",
    episodeId,
  };
  if (page === "cuts") {
    const cutId = segment(parts[5]);
    if (cutId) focus.cutId = cutId;
  }
  const item = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("item");
  if (item && focus.route === "episode") {
    const [kind, id] = item.split(":", 2);
    const safe = segment(id);
    if (safe && kind === "cut") focus.cutId = safe;
    else if (safe && kind === "transition") focus.transitionId = safe;
  }
  return { workId, focus };
}
