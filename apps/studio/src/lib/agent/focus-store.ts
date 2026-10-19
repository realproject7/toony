// Browser-side shared state between the human workspace and the agent panel.
// The workspace reports what the person is looking at; the panel shows it as a
// context chip and sends it with the next message. The workspace can also ask
// the panel to open a view (setup, settings, chat). No React or Node imports so
// both sides and Node tests can use it.

import type { AgentFocus } from "./protocol.js";

type Listener = () => void;

const DEFAULT_FOCUS: AgentFocus = { route: "library" };
let currentFocus: AgentFocus = DEFAULT_FOCUS;
const listeners = new Set<Listener>();

function sameFocus(a: AgentFocus, b: AgentFocus): boolean {
  return (
    a.route === b.route &&
    a.episodeId === b.episodeId &&
    a.cutId === b.cutId &&
    a.transitionId === b.transitionId &&
    a.characterId === b.characterId &&
    (a.bubbleIds ?? []).join(",") === (b.bubbleIds ?? []).join(",") &&
    JSON.stringify(a.labels ?? {}) === JSON.stringify(b.labels ?? {})
  );
}

/** Replace the current focus. Pages call this on route and selection changes. */
export function setAgentFocus(next: AgentFocus): void {
  if (sameFocus(currentFocus, next)) return;
  currentFocus = next;
  for (const listener of listeners) listener();
}

/** Merge a partial update into the current focus (for selection changes inside a page). */
export function updateAgentFocus(patch: Partial<AgentFocus>): void {
  setAgentFocus({ ...currentFocus, ...patch });
}

export function getAgentFocus(): AgentFocus {
  return currentFocus;
}

export function subscribeAgentFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Window event name the panel listens to. */
export const AGENT_PANEL_EVENT = "toony:agent-panel";

export interface AgentPanelRequest {
  view: "chat" | "setup" | "settings" | "history";
  /** Optional text placed in the composer without sending it. */
  prefill?: string;
}

/** Ask the agent panel to show itself (restoring it if hidden) and open a view. */
export function openAgentPanel(request: AgentPanelRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AgentPanelRequest>(AGENT_PANEL_EVENT, { detail: request }));
}
