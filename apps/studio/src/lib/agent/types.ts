// Server-side validation for what the browser sends the agent route, and the
// error type the agent runtime throws. Messages are plain sentences a person can
// act on; they never carry paths, ids of other people or provider output.

import {
  type AgentPreferences,
  type AgentProvider,
  DEFAULT_PREFERENCES,
  type AgentFocus as FocusOfMessage,
} from "./protocol.js";

export class AgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/**
 * Duck-typed check for an `AgentError`. Next bundles route handlers separately,
 * so an error thrown by the runtime (created in one bundle) can reach a route
 * whose `AgentError` class is a different object.
 */
export function isAgentError(error: unknown): error is AgentError {
  return (
    error instanceof Error &&
    error.name === "AgentError" &&
    typeof (error as AgentError).code === "string" &&
    typeof (error as AgentError).status === "number"
  );
}

export const PROVIDERS: readonly AgentProvider[] = ["claude", "codex"];

export function isProvider(value: unknown): value is AgentProvider {
  return value === "claude" || value === "codex";
}

/** Model names the CLIs accept: no spaces, no leading dash (it would read as an option). */
const MODEL = /^(?:[A-Za-z0-9._:/[\]][A-Za-z0-9._:/[\]-]{0,99})?$/;

export function isModelName(value: unknown): value is string {
  return typeof value === "string" && MODEL.test(value);
}

/** Preferences from the browser. Unknown keys are dropped; absent switches take the defaults. */
export function agentPreferences(value: unknown): AgentPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentError("preferences", "Choose Claude or Codex to connect.");
  }
  const v = value as Record<string, unknown>;
  if (!isProvider(v.provider))
    throw new AgentError("preferences", "Choose Claude or Codex to connect.");
  const model = v.model === undefined ? "" : v.model;
  if (!isModelName(model)) {
    throw new AgentError(
      "preferences",
      "Use a model name your CLI accepts (letters, digits, dots, dashes), or leave it empty.",
    );
  }
  const flag = (key: "autoApply" | "viewArtwork" | "retainHistory"): boolean => {
    const raw = v[key];
    if (raw === undefined) return DEFAULT_PREFERENCES[key];
    if (typeof raw !== "boolean") throw new AgentError("preferences", "Check the agent settings.");
    return raw;
  };
  return {
    provider: v.provider,
    model,
    autoApply: flag("autoApply"),
    viewArtwork: flag("viewArtwork"),
    retainHistory: flag("retainHistory"),
  };
}

/** An id the browser names (episode, cut, bubble). Letters, digits, `_`, `-`, `.`; never a path. */
const SAFE_ID = /^(?!\.{1,2}$)[\p{L}\p{N}_.-]{1,100}$/u;

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

const ROUTES: readonly FocusOfMessage["route"][] = [
  "library",
  "story",
  "characters",
  "episode",
  "preview",
  "export",
  "settings",
];

/**
 * What the person is looking at. A malformed id is refused; a cut without an
 * episode is dropped rather than refused, so a page that has not loaded its
 * episode yet never blocks a message.
 */
export function agentFocus(value: unknown): FocusOfMessage {
  if (value === undefined || value === null) return { route: "library" };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AgentError("focus", "Choose what you are looking at again.");
  }
  const v = value as Record<string, unknown>;
  const route = ROUTES.includes(v.route as FocusOfMessage["route"])
    ? (v.route as FocusOfMessage["route"])
    : "library";
  const focus: FocusOfMessage = { route };
  for (const key of ["episodeId", "cutId", "transitionId", "characterId"] as const) {
    const raw = v[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (!isSafeId(raw)) throw new AgentError("focus", "Choose what you are looking at again.");
    focus[key] = raw;
  }
  if (v.bubbleIds !== undefined && v.bubbleIds !== null) {
    if (!Array.isArray(v.bubbleIds) || v.bubbleIds.length > 50 || !v.bubbleIds.every(isSafeId)) {
      throw new AgentError("focus", "Choose the selected bubbles again.");
    }
    if (v.bubbleIds.length > 0) focus.bubbleIds = [...new Set(v.bubbleIds as string[])];
  }
  if (focus.episodeId === undefined) {
    delete focus.cutId;
    delete focus.transitionId;
    delete focus.bubbleIds;
  }
  if (focus.cutId === undefined) delete focus.bubbleIds;
  return focus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ---------------------------------------------------------------------------
// Shapes of the previous dock (components/agent-workspace.tsx), kept only so
// that component compiles until the rebuilt agent panel replaces it. The
// server no longer produces them; use lib/agent/protocol.ts instead.

/** @deprecated Previous dock only. */
export interface AgentSettings {
  provider: AgentProvider;
  model: string;
  projectContext: boolean;
  retainHistory: boolean;
}
/** @deprecated Previous dock only; messages carry `protocol.AgentFocus`. */
export interface AgentFocus {
  episodeId?: string;
  cutId?: string;
}
/** @deprecated Previous dock only. */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  focus?: AgentFocus;
  requestId?: string;
}
/** @deprecated Previous dock only. */
export interface AgentConversation {
  id: string;
  workId: string | null;
  settings: AgentSettings;
  messages: AgentMessage[];
  updatedAt: string;
}
/** @deprecated Previous dock only. */
export interface AgentTurn {
  id: string;
  requestId: string;
  state: "running" | "completed" | "cancelled" | "failed";
  error?: string;
}
/** @deprecated Previous dock only. */
export interface AgentView {
  settings: AgentSettings | null;
  conversation: AgentConversation | null;
  turn: AgentTurn | null;
}
/** @deprecated Previous dock only; see `protocol.ProviderStatus`. */
export interface AgentAvailability {
  provider: AgentProvider;
  state: "ready" | "sign-in-required" | "missing" | "unsupported" | "unavailable";
}
