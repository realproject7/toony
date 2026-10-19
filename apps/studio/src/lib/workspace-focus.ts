// The focus the human workspace reports to the agent panel: which page, and in
// the episode editor which cut or transition and which bubbles. Pure helpers so
// the reported shape is tested; the pages call setAgentFocus with the result.

import type { AgentFocus } from "./agent/protocol.js";

export function episodeFocus(
  episodeId: string,
  selection: { type: "cut" | "transition"; id: string } | null,
  bubbleIds: readonly string[] = [],
): AgentFocus {
  const focus: AgentFocus = { route: "episode", episodeId };
  if (selection?.type === "cut") {
    focus.cutId = selection.id;
    if (bubbleIds.length > 0) focus.bubbleIds = [...bubbleIds];
  } else if (selection?.type === "transition") {
    focus.transitionId = selection.id;
  }
  return focus;
}

/** Focus for a page without a selection. */
export function pageFocus(route: AgentFocus["route"], episodeId?: string): AgentFocus {
  return episodeId === undefined ? { route } : { route, episodeId };
}
