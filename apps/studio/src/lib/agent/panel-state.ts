// The agent panel's state, kept as a pure reducer so the Node test runner can
// cover it. Live events (`GET /api/live`) and server snapshots (`POST
// /api/agent` responses) both land here:
//   - events are applied once, in `seq` order; a replayed or older event is
//     ignored, and a new server process (different `serverId`) or a `resync`
//     marks the state stale so the panel fetches the conversation again;
//   - only events for the open conversation change it;
//   - streamed text (`delta`) builds the running turn's draft until the
//     assistant item arrives;
//   - a message the person just sent shows at once (pending) and is dropped
//     when the server's own copy arrives or the send fails.
// The file also holds the small pure helpers the panel components share
// (status, task progress, item grouping, focus chip, route rules, starters).
// No Node or React imports.

import { isInternalHref } from "./markdown.js";
import type {
  AgentFocus,
  AgentPreferences,
  ConnectionState,
  ConversationItem,
  ConversationSummary,
  ConversationView,
  LiveEvent,
  MemoryView,
  ProviderStatus,
  TaskItem,
  TurnState,
} from "./protocol.js";

/** A message the person sent that the server has not echoed yet. */
export interface PendingMessage {
  requestId: string;
  conversationId: string;
  text: string;
  at: string;
}

export interface PanelState {
  /** The live feed's server process; a different one means every seq restarted. */
  serverId: string | null;
  /** Highest event seq applied. Older or equal events are replays. */
  lastSeq: number;
  /** Null until the first `hello` or bootstrap answer. */
  connection: ConnectionState | null;
  providers: ProviderStatus[] | null;
  conversation: ConversationView | null;
  pending: PendingMessage[];
  /** Events were lost; the panel should fetch the conversation again. */
  stale: boolean;
}

export const INITIAL_PANEL_STATE: PanelState = {
  serverId: null,
  lastSeq: 0,
  connection: null,
  providers: null,
  conversation: null,
  pending: [],
  stale: false,
};

export type PanelAction =
  | { type: "live"; event: LiveEvent }
  /** A conversation snapshot from an HTTP answer. Null clears the open conversation. */
  | { type: "view"; view: ConversationView | null }
  | { type: "connection"; connection: ConnectionState }
  | { type: "providers"; providers: ProviderStatus[] }
  /** Replace or add one item locally, for example an answer the server confirmed. */
  | { type: "item"; conversationId: string; item: ConversationItem }
  | { type: "pending"; message: PendingMessage }
  | { type: "pending-done"; requestId: string }
  | { type: "refreshed" };

type ActivityItem = Extract<ConversationItem, { kind: "activity" }>;

function upsertItem(view: ConversationView, item: ConversationItem): ConversationView {
  const items = view.items.slice();
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) items.push(item);
  else items[index] = item;
  let turn = view.turn;
  if (item.kind === "assistant" && turn && turn.id === item.turnId && turn.draft !== undefined) {
    // The streamed text has become a reply item.
    const { draft: _draft, ...rest } = turn;
    turn = rest;
  }
  return { ...view, items, turn };
}

function setTurn(view: ConversationView, turn: TurnState | null): ConversationView {
  if (
    turn &&
    view.turn &&
    turn.id === view.turn.id &&
    turn.state === "running" &&
    turn.draft === undefined &&
    view.turn.draft !== undefined
  ) {
    return { ...view, turn: { ...turn, draft: view.turn.draft } };
  }
  return { ...view, turn };
}

function appendDelta(view: ConversationView, turnId: string, text: string): ConversationView {
  const turn = view.turn;
  if (!turn || turn.id !== turnId || turn.state !== "running") return view;
  return { ...view, turn: { ...turn, draft: `${turn.draft ?? ""}${text}` } };
}

/** Item time is no earlier than the send time, allowing a second of clock rounding. */
function sentAfter(itemAt: string, sentAt: string): boolean {
  const item = Date.parse(itemAt);
  const sent = Date.parse(sentAt);
  if (!Number.isFinite(item) || !Number.isFinite(sent)) return true;
  return item >= sent - 1000;
}

function dropEchoed(pending: PendingMessage[], view: ConversationView): PendingMessage[] {
  if (pending.length === 0) return pending;
  // A pending message is echoed once the view holds a user item with its text,
  // created no earlier than it was sent. Each item answers one pending message,
  // so a repeated message ("yes", "yes") stays pending until its own copy arrives.
  const claimed = new Set<string>();
  const out: PendingMessage[] = [];
  for (const message of pending) {
    if (message.conversationId !== view.id) {
      out.push(message);
      continue;
    }
    const echo = view.items.find(
      (item) =>
        item.kind === "user" &&
        !claimed.has(item.id) &&
        item.text === message.text &&
        sentAfter(item.at, message.at),
    );
    if (echo) claimed.add(echo.id);
    else out.push(message);
  }
  return out.length === pending.length ? pending : out;
}

function forConversation(state: PanelState, conversationId: string): ConversationView | null {
  return state.conversation && state.conversation.id === conversationId ? state.conversation : null;
}

function withConversation(state: PanelState, view: ConversationView): PanelState {
  return { ...state, conversation: view, pending: dropEchoed(state.pending, view) };
}

/** Apply one live event. Returns the same object when nothing changed. */
export function applyLiveEvent(state: PanelState, event: LiveEvent): PanelState {
  if (event.type === "hello") {
    const restarted = state.serverId !== null && state.serverId !== event.serverId;
    return {
      ...state,
      serverId: event.serverId,
      connection: event.connection,
      lastSeq: restarted ? 0 : state.lastSeq,
      stale: restarted || state.stale,
    };
  }
  if (event.type === "ping") return state;
  if (event.type === "resync") return { ...state, lastSeq: event.seq, stale: true };
  if (event.seq <= state.lastSeq) return state;
  const next: PanelState = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case "connection":
      return { ...next, connection: event.connection };
    case "providers":
      return { ...next, providers: event.providers };
    case "conversation": {
      const current = forConversation(state, event.view.id);
      if (!current) return next;
      return withConversation(next, setTurn(event.view, event.view.turn));
    }
    case "item": {
      const current = forConversation(state, event.conversationId);
      if (!current) return next;
      return withConversation(next, upsertItem(current, event.item));
    }
    case "turn": {
      const current = forConversation(state, event.conversationId);
      if (!current) return next;
      return { ...next, conversation: setTurn(current, event.turn) };
    }
    case "delta": {
      const current = forConversation(state, event.conversationId);
      if (!current) return next;
      return { ...next, conversation: appendDelta(current, event.turnId, event.text) };
    }
    case "tasks": {
      const current = forConversation(state, event.conversationId);
      if (!current) return next;
      return { ...next, conversation: { ...current, tasks: event.tasks } };
    }
    case "rebind": {
      const current = forConversation(state, event.conversationId);
      if (!current) return next;
      return { ...next, conversation: { ...current, workId: event.workId } };
    }
    default:
      // project, navigate and export events do not change the conversation.
      return next;
  }
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "live":
      return applyLiveEvent(state, action.event);
    case "view": {
      if (!action.view) return { ...state, conversation: null, pending: [] };
      return withConversation(state, action.view);
    }
    case "connection":
      return { ...state, connection: action.connection };
    case "providers":
      return { ...state, providers: action.providers };
    case "item": {
      const current = forConversation(state, action.conversationId);
      if (!current) return state;
      return withConversation(state, upsertItem(current, action.item));
    }
    case "pending":
      return { ...state, pending: [...state.pending, action.message] };
    case "pending-done": {
      const pending = state.pending.filter((message) => message.requestId !== action.requestId);
      return pending.length === state.pending.length ? state : { ...state, pending };
    }
    case "refreshed":
      return state.stale ? { ...state, stale: false } : state;
  }
}

// ---------------------------------------------------------------------------
// Status

export type PanelStatus =
  | "loading"
  | "not-connected"
  | "needs-attention"
  | "working"
  | "waiting"
  | "ready";

export const STATUS_LABELS: Record<PanelStatus, string> = {
  loading: "Checking",
  "not-connected": "Not connected",
  "needs-attention": "Needs attention",
  working: "Working",
  waiting: "Waiting for you",
  ready: "Ready",
};

/** A question or proposal after the person's last message that still needs them. */
export function openRequest(items: ConversationItem[]): ConversationItem | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as ConversationItem;
    if (item.kind === "user") return null;
    if (item.kind === "question" && !item.answer) return item;
    if (item.kind === "proposal" && item.state === "pending") return item;
  }
  return null;
}

export function panelStatus(
  connection: ConnectionState | null,
  conversation: ConversationView | null,
): PanelStatus {
  if (!connection) return "loading";
  if (connection.status === "disconnected") return "not-connected";
  if (connection.status === "needs-attention") return "needs-attention";
  const turn = conversation?.turn;
  if (turn?.state === "running") return "working";
  if (turn?.state === "waiting") return "waiting";
  if (conversation && openRequest(conversation.items)) return "waiting";
  return "ready";
}

/** The preferences the connection carries, when there is a connection. */
export function connectionPreferences(connection: ConnectionState | null): AgentPreferences | null {
  if (!connection || connection.status === "disconnected") return null;
  return connection.preferences;
}

export function providerName(provider: string | null | undefined): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return "Agent";
}

// ---------------------------------------------------------------------------
// Plan

export interface TaskProgress {
  done: number;
  total: number;
  current: TaskItem | null;
}

export function taskProgress(tasks: TaskItem[]): TaskProgress {
  const done = tasks.filter((task) => task.status === "done").length;
  const current =
    tasks.find((task) => task.status === "in_progress") ??
    tasks.find((task) => task.status === "pending") ??
    null;
  return { done, total: tasks.length, current };
}

// ---------------------------------------------------------------------------
// Message list

export type ItemBlock =
  | { kind: "item"; key: string; item: ConversationItem }
  | { kind: "activity"; key: string; turnId: string; items: ActivityItem[] };

/** Group consecutive activity rows of one turn into one block. */
export function groupItems(items: ConversationItem[]): ItemBlock[] {
  const blocks: ItemBlock[] = [];
  for (const item of items) {
    if (item.kind === "activity") {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "activity" && last.turnId === item.turnId) {
        last.items.push(item);
        continue;
      }
      blocks.push({
        kind: "activity",
        key: `activity:${item.id}`,
        turnId: item.turnId,
        items: [item],
      });
      continue;
    }
    blocks.push({ kind: "item", key: item.id, item });
  }
  return blocks;
}

/** The text of the person's latest message, for Retry. */
export function lastUserText(items: ConversationItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as ConversationItem;
    if (item.kind === "user") return item.text;
  }
  return null;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", or a short date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const diff = Math.max(0, now - at);
  const minute = 60_000;
  if (diff < minute) return "just now";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} min ago`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} h ago`;
  if (diff < 48 * 60 * minute) return "Yesterday";
  return new Date(at).toLocaleDateString("en", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Routes, focus and navigation

export type RouteKind =
  | "library"
  | "settings"
  | "story"
  | "characters"
  | "episodes"
  | "episode"
  | "preview"
  | "export"
  | "script"
  | "other";

export interface RouteInfo {
  kind: RouteKind;
  workId: string | null;
  episodeId?: string;
}

function decode(part: string | undefined): string | undefined {
  if (part === undefined) return undefined;
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

export function routeInfo(pathname: string): RouteInfo {
  const path = pathname.split(/[?#]/)[0] ?? "/";
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "library", workId: null };
  if (parts[0] === "settings") return { kind: "settings", workId: null };
  if (parts[0] !== "w") return { kind: "other", workId: null };
  const workId = decode(parts[1]) ?? null;
  if (!workId) return { kind: "other", workId: null };
  if (parts.length === 2) return { kind: "story", workId };
  if (parts[2] === "characters") return { kind: "characters", workId };
  if (parts[2] !== "episodes") return { kind: "other", workId };
  const episodeId = decode(parts[3]);
  if (!episodeId) return { kind: "episodes", workId };
  const rest = parts[4];
  if (rest === undefined) return { kind: "episode", workId, episodeId };
  if (rest === "read") return { kind: "preview", workId, episodeId };
  if (rest === "export") return { kind: "export", workId, episodeId };
  if (rest === "script") return { kind: "script", workId, episodeId };
  return { kind: "episode", workId, episodeId };
}

/**
 * The work whose conversation the panel shows. Library is the library
 * conversation (null); pages outside a work (Settings) keep the current one.
 */
export function panelScope(pathname: string, previous: string | null): string | null {
  const route = routeInfo(pathname);
  if (route.workId !== null) return route.workId;
  if (route.kind === "library") return null;
  return previous;
}

/** The agent may move the left pane only from the library or a story overview, never from an editor. */
export function canAutoNavigate(pathname: string): boolean {
  const kind = routeInfo(pathname).kind;
  return kind === "library" || kind === "story" || kind === "episodes";
}

const FOCUS_ROUTE: Partial<Record<RouteKind, AgentFocus["route"]>> = {
  library: "library",
  settings: "settings",
  story: "story",
  episodes: "story",
  characters: "characters",
  episode: "episode",
  script: "episode",
  preview: "preview",
  export: "export",
};

/**
 * The focus to show and send: the workspace's report when it matches the page
 * on screen, otherwise what the route alone says (a page that has not reported
 * yet, or a report left over from the previous page).
 */
export function focusForRoute(route: RouteInfo, focus: AgentFocus): AgentFocus {
  const expected = FOCUS_ROUTE[route.kind];
  if (!expected) return focus;
  if (
    focus.route === expected &&
    (route.episodeId === undefined || focus.episodeId === route.episodeId)
  ) {
    return focus;
  }
  return route.episodeId ? { route: expected, episodeId: route.episodeId } : { route: expected };
}

/** "ep-002" becomes "Episode 2"; other ids give null so no id is ever shown. */
export function episodeLabelFromId(episodeId: string | undefined): string | null {
  if (!episodeId) return null;
  const match = /^ep-0*(\d{1,6})$/.exec(episodeId);
  return match ? `Episode ${match[1]}` : null;
}

/** A short name for an internal link, used when the agent's event carries none. */
export function labelForHref(href: string): string {
  if (!isInternalHref(href)) return "Open";
  const route = routeInfo(href);
  switch (route.kind) {
    case "library":
      return "Library";
    case "story":
      return "Story";
    case "characters":
      return "Characters";
    case "episodes":
      return "Episodes";
    case "episode":
      return episodeLabelFromId(route.episodeId) ?? "Episode";
    case "preview":
      return `${episodeLabelFromId(route.episodeId) ?? "Episode"} preview`;
    case "export":
      return `${episodeLabelFromId(route.episodeId) ?? "Episode"} export`;
    case "script":
      return `${episodeLabelFromId(route.episodeId) ?? "Episode"} script`;
    default:
      return "Open";
  }
}

/** The composer's context chip, for example "Episode 2 · Cut 3 · 2 bubbles". Null when there is nothing to show. */
export function focusChipLabel(focus: AgentFocus | null | undefined): string | null {
  if (!focus) return null;
  const labels = focus.labels ?? {};
  const episode = labels.episode ?? episodeLabelFromId(focus.episodeId) ?? "This episode";
  switch (focus.route) {
    case "library":
    case "settings":
      return null;
    case "story":
      return "Story";
    case "characters":
      return labels.character ? `Characters · ${labels.character}` : "Characters";
    case "preview":
      return `${episode} · Preview`;
    case "export":
      return `${episode} · Export`;
    case "episode": {
      const parts = [episode];
      if (focus.cutId) parts.push(labels.cut ?? "Selected cut");
      else if (focus.transitionId) parts.push(labels.transition ?? "Transition");
      const bubbles = focus.bubbleIds?.length ?? 0;
      if (bubbles > 0) parts.push(bubbles === 1 ? "1 bubble" : `${bubbles} bubbles`);
      return parts.join(" · ");
    }
  }
}

// ---------------------------------------------------------------------------
// Starters

export interface Starter {
  label: string;
  text: string;
  /** Send at once, or place the text in the composer for the person to finish. */
  send: boolean;
}

export function startersFor(kind: RouteKind): Starter[] {
  switch (kind) {
    case "library":
    case "settings":
    case "other":
      return [
        { label: "I have a story idea", text: "I have a story idea: ", send: false },
        {
          label: "Help me find an idea",
          text: "Help me find an idea for a webtoon. Ask me a few questions first.",
          send: true,
        },
        {
          label: "Turn a short story into episodes",
          text: "Turn this short story into webtoon episodes:\n\n",
          send: false,
        },
      ];
    case "story":
    case "characters":
    case "episodes":
      return [
        { label: "Plan the next episode", text: "Plan the next episode with me.", send: true },
        {
          label: "Review the story so far",
          text: "Review the story so far and tell me what to improve.",
          send: true,
        },
      ];
    default:
      return [
        {
          label: "Check this episode's dialogue",
          text: "Check this episode's dialogue for clarity, voice and length.",
          send: true,
        },
        { label: "Add a cut after this one", text: "Add a cut after this one: ", send: false },
        {
          label: "Export this episode for Instagram",
          text: "Export this episode for Instagram.",
          send: true,
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Server answers

export interface AgentActionResult {
  connection?: ConnectionState;
  providers?: ProviderStatus[];
  /** Present (possibly null) when the action returns a conversation. */
  view?: ConversationView | null;
  conversations?: ConversationSummary[];
  memory?: MemoryView;
}

function isView(value: unknown): value is ConversationView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<ConversationView>;
  return typeof view.id === "string" && Array.isArray(view.items);
}

function isConnection(value: unknown): value is ConnectionState {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "disconnected" || status === "connected" || status === "needs-attention";
}

/**
 * Read a `POST /api/agent` answer into known fields. Tolerates the common
 * spellings (`view` or `conversation`, `conversations` or `history`, `memory`
 * or the memory fields at the top level) so the panel works across server
 * revisions.
 */
export function readActionResult(value: unknown): AgentActionResult {
  const out: AgentActionResult = {};
  if (!value || typeof value !== "object") return out;
  const body = value as Record<string, unknown>;
  if (isConnection(body.connection)) out.connection = body.connection;
  if (Array.isArray(body.providers)) out.providers = body.providers as ProviderStatus[];
  if ("view" in body) out.view = isView(body.view) ? body.view : null;
  else if ("conversation" in body) out.view = isView(body.conversation) ? body.conversation : null;
  const list = Array.isArray(body.conversations)
    ? body.conversations
    : Array.isArray(body.history)
      ? body.history
      : null;
  if (list) out.conversations = list as ConversationSummary[];
  const memory = body.memory as Partial<MemoryView> | undefined;
  if (memory && typeof memory === "object" && Array.isArray(memory.notes)) {
    out.memory = {
      notes: memory.notes,
      tasks: Array.isArray(memory.tasks) ? memory.tasks : [],
      journal: Array.isArray(memory.journal) ? memory.journal : [],
    };
  } else if (Array.isArray(body.notes)) {
    out.memory = {
      notes: body.notes as MemoryView["notes"],
      tasks: Array.isArray(body.tasks) ? (body.tasks as TaskItem[]) : [],
      journal: Array.isArray(body.journal) ? (body.journal as MemoryView["journal"]) : [],
    };
  }
  return out;
}
