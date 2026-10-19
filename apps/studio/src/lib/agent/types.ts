export type AgentProvider = "claude" | "codex";
export interface AgentSettings {
  provider: AgentProvider;
  model: string;
  projectContext: boolean;
  retainHistory: boolean;
}
export interface AgentFocus {
  episodeId?: string;
  cutId?: string;
}
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  focus?: AgentFocus;
  requestId?: string;
}
export interface AgentConversation {
  id: string;
  workId: string | null;
  settings: AgentSettings;
  messages: AgentMessage[];
  updatedAt: string;
}
export interface AgentTurn {
  id: string;
  requestId: string;
  state: "running" | "completed" | "cancelled" | "failed";
  error?: string;
}
export interface AgentView {
  settings: AgentSettings | null;
  conversation: AgentConversation | null;
  turn: AgentTurn | null;
}
export interface AgentAvailability {
  provider: AgentProvider;
  state: "ready" | "sign-in-required" | "missing" | "unsupported" | "unavailable";
}
export class AgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export function agentSettings(value: unknown): AgentSettings {
  if (!value || typeof value !== "object")
    throw new AgentError("settings", "Choose an agent connection.");
  const v = value as Record<string, unknown>;
  if (
    (v.provider !== "claude" && v.provider !== "codex") ||
    typeof v.model !== "string" ||
    !/^[a-zA-Z0-9._:/-]{0,100}$/.test(v.model) ||
    typeof v.projectContext !== "boolean" ||
    typeof v.retainHistory !== "boolean"
  ) {
    throw new AgentError("settings", "Check the connection preferences.");
  }
  return {
    provider: v.provider,
    model: v.model,
    projectContext: v.projectContext,
    retainHistory: v.retainHistory,
  };
}
export function settingsKey(settings: AgentSettings): string {
  return JSON.stringify([
    settings.provider,
    settings.model,
    settings.projectContext,
    settings.retainHistory,
  ]);
}
export function agentFocus(value: unknown): AgentFocus {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new AgentError("focus", "Choose a scene again.");
  const v = value as Record<string, unknown>;
  const result: AgentFocus = {};
  for (const key of ["episodeId", "cutId"] as const) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== "string" || !/^[\p{L}\p{N}_-]{1,100}$/u.test(v[key]))
      throw new AgentError("focus", "Choose a scene again.");
    result[key] = v[key];
  }
  if (result.cutId && !result.episodeId)
    throw new AgentError("focus", "Choose an episode for this cut.");
  return result;
}
