// Shared browser/server contract for the connected agent panel and the live
// project feed. Server code (lib/agent, lib/live, lib/ops) produces these
// shapes; the panel and the human workspace consume them. Keep this file free
// of Node and React imports so both sides and the Node test runner can use it.
// Extend additively: older saved conversations must keep loading.

export type AgentProvider = "claude" | "codex";

/** What the installed CLI can do right now, without exposing account identity. */
export type ProviderReadiness =
  | { state: "ready"; version: string }
  | {
      state: "sign-in-required";
      version: string;
      command: string;
      /** Additive: a plain sentence for a sign-in Toony does not use (an API key, for example). */
      message?: string;
    }
  | { state: "missing"; installCommand: string; docsUrl: string }
  | {
      state: "unsupported";
      version: string;
      supported: string;
      /** Additive: what is missing when the version is in range but a required option is not. */
      detail?: string;
    }
  | { state: "checking" }
  | { state: "unavailable"; detail: string };

export interface ProviderStatus {
  provider: AgentProvider;
  /** Product name shown to people, for example "Claude Code" or "Codex". */
  label: string;
  readiness: ProviderReadiness;
}

export interface AgentPreferences {
  provider: AgentProvider;
  /** Empty string means the provider's default model. */
  model: string;
  /** "Let the agent make changes without asking". Off turns every write into a proposal. */
  autoApply: boolean;
  /** The agent may look at rendered cut images through a tool. */
  viewArtwork: boolean;
  /** Keep conversations on this computer after the Studio server stops. */
  retainHistory: boolean;
}

export const DEFAULT_PREFERENCES: Omit<AgentPreferences, "provider"> = {
  model: "",
  autoApply: true,
  viewArtwork: true,
  retainHistory: true,
};

export type ConnectionState =
  | { status: "disconnected" }
  | { status: "connected"; preferences: AgentPreferences; verifiedAt: string }
  | {
      status: "needs-attention";
      preferences: AgentPreferences;
      reason: "sign-in" | "missing" | "unsupported" | "unavailable";
      message: string;
      /** A terminal command the person can run to fix it, when one exists. */
      command?: string;
    };

/** What the person is looking at when they send a message. */
export interface AgentFocus {
  route: "library" | "story" | "characters" | "episode" | "preview" | "export" | "settings";
  episodeId?: string;
  cutId?: string;
  transitionId?: string;
  bubbleIds?: string[];
  characterId?: string;
  /**
   * Additive: short labels the workspace knows for what is in focus, for
   * example `{ episode: "Episode 2", cut: "Cut 3" }`. The panel shows them in
   * its context chip instead of ids. Never raw ids.
   */
  labels?: { episode?: string; cut?: string; transition?: string; character?: string };
}

/** A place in the human workspace a card can open. `href` is an internal path. */
export interface AgentTarget {
  type: "work" | "story" | "characters" | "episode" | "cut" | "export";
  workId: string;
  episodeId?: string;
  cutId?: string;
  label: string;
  href: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export type ProposalPreview =
  | {
      kind: "lettering";
      before: Array<{ speaker: string; text: string }>;
      after: Array<{ speaker: string; text: string }>;
    }
  | { kind: "text"; text: string };

export type ConversationItem =
  | { kind: "user"; id: string; at: string; text: string; focus?: AgentFocus }
  /** Agent reply text. A safe Markdown subset; the panel renders it without HTML. */
  | { kind: "assistant"; id: string; at: string; turnId: string; text: string }
  | {
      kind: "activity";
      id: string;
      at: string;
      turnId: string;
      tool: string;
      title: string;
      status: "running" | "done" | "failed";
      detail?: string;
      targets?: AgentTarget[];
    }
  | {
      kind: "change";
      id: string;
      at: string;
      turnId?: string;
      changeId: string;
      actor: "agent" | "human";
      summary: string;
      targets: AgentTarget[];
      undoable: boolean;
      undone?: boolean;
    }
  | {
      kind: "question";
      id: string;
      at: string;
      turnId: string;
      questionId: string;
      header?: string;
      prompt: string;
      options: QuestionOption[];
      multiSelect: boolean;
      allowOther: boolean;
      answer?: { choices: string[]; other?: string; at: string };
    }
  | {
      kind: "proposal";
      id: string;
      at: string;
      turnId: string;
      proposalId: string;
      title: string;
      summary: string;
      preview?: ProposalPreview;
      targets: AgentTarget[];
      state: "pending" | "applied" | "dismissed" | "stale";
      changeId?: string;
    }
  | {
      kind: "notice";
      id: string;
      at: string;
      tone: "info" | "warning" | "error";
      text: string;
      action?: "sign-in" | "retry" | "settings";
      command?: string;
    };

export interface TaskItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
}

export type TurnErrorCode =
  | "auth"
  | "rate-limit"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "other";

export interface TurnState {
  id: string;
  conversationId: string;
  /** "waiting" means the agent asked a question or proposed a change and stopped. */
  state: "running" | "waiting" | "completed" | "cancelled" | "failed";
  startedAt: string;
  endedAt?: string;
  /** Human label for the current step, for example "Writing episode 2". */
  step?: string;
  /** Streamed reply text that has not become an assistant item yet. */
  draft?: string;
  error?: { code: TurnErrorCode; message: string };
}

export interface ConversationSummary {
  id: string;
  workId: string | null;
  title: string;
  updatedAt: string;
  preview: string;
  /** Additive: a conversation from an older Toony build that can be read but not continued. */
  readOnly?: boolean;
  /** Additive: the provider of the conversation's last turn, when it had one. */
  provider?: AgentProvider | null;
  /** Additive: the state of the conversation's last turn, when it had one. */
  state?: TurnState["state"] | null;
}

export interface ConversationView {
  id: string;
  workId: string | null;
  title: string;
  provider: AgentProvider | null;
  items: ConversationItem[];
  tasks: TaskItem[];
  turn: TurnState | null;
  /** Additive: true for a conversation from an older Toony build (read only). */
  readOnly?: boolean;
}

export type ChangeScope =
  | { kind: "work" }
  | { kind: "story" }
  | { kind: "characters" }
  | { kind: "episodes" }
  | { kind: "episode"; episodeId: string }
  | { kind: "sequence"; episodeId: string }
  | { kind: "cut"; episodeId: string; cutId: string }
  | { kind: "lettering"; episodeId: string; cutId: string }
  | { kind: "artwork"; episodeId: string; cutId: string }
  | { kind: "export"; episodeId: string };

export interface ProjectChange {
  workId: string;
  changeId: string;
  actor: "agent" | "human";
  summary: string;
  scopes: ChangeScope[];
  at: string;
  /** Set when this change reverses an earlier one. */
  undoes?: string;
  /** The conversation whose agent made the change, when an agent made it. */
  conversationId?: string;
  /**
   * The browser tab that made the change (the `x-toony-client` header), so that
   * tab can skip refreshing for its own save. Absent for agent changes.
   */
  clientId?: string;
  /** False when the change cannot be undone (creating a work). Absent means undoable. */
  undoable?: boolean;
}

/** One NDJSON line of `GET /api/live`. `seq` increases monotonically per server process. */
export type LiveEvent =
  | { type: "hello"; seq: number; serverId: string; connection: ConnectionState }
  | { type: "resync"; seq: number }
  | { type: "ping"; seq: number }
  | { type: "connection"; seq: number; connection: ConnectionState }
  | { type: "providers"; seq: number; providers: ProviderStatus[] }
  | { type: "conversation"; seq: number; view: ConversationView }
  /** Append the item, or replace the existing item with the same id. */
  | { type: "item"; seq: number; conversationId: string; item: ConversationItem }
  | { type: "turn"; seq: number; conversationId: string; turn: TurnState | null }
  | { type: "delta"; seq: number; conversationId: string; turnId: string; text: string }
  | { type: "tasks"; seq: number; conversationId: string; tasks: TaskItem[] }
  /** A conversation was moved to another work, for example after the agent created it. */
  | { type: "rebind"; seq: number; conversationId: string; workId: string }
  | { type: "project"; seq: number; change: ProjectChange }
  | {
      type: "navigate";
      seq: number;
      conversationId: string;
      href: string;
      reason: "work-created" | "episode-created";
    }
  | { type: "export"; seq: number; job: ExportJobView }
  | { type: "art"; seq: number; job: ArtJobView };

/** One cut of a drawing job. */
export interface ArtJobCut {
  cutId: string;
  /** How the cut reads to a person, for example "Cut 3". */
  label: string;
  state: "queued" | "drawing" | "done" | "failed" | "skipped";
  /** Why it failed or was skipped, in plain words. */
  message?: string;
  /** The change that stored the new image, so it can be undone. */
  changeId?: string;
}

/** The agent drawing or editing cut artwork with the artwork engine, one cut at a time. */
export interface ArtJobView {
  id: string;
  workId: string;
  episodeId: string;
  kind: "draw" | "edit";
  state: "queued" | "running" | "finished" | "stopped";
  cuts: ArtJobCut[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** The chat whose agent asked for it. */
  conversationId?: string;
}

export interface ExportJobView {
  id: string;
  workId: string;
  episodeId: string;
  output: string;
  state: "queued" | "running" | "completed" | "failed";
  progress: { done: number; total: number };
  message?: string;
  files?: Array<{
    name: string;
    width: number;
    height: number;
    bytes: number;
    href: string;
    /** Additive: file checksum, what it shows and the post it belongs to. */
    sha256?: string;
    role?: "strip" | "slice" | "cut" | "card" | "frame";
    /** Sequence item ids the file shows, top to bottom. */
    items?: string[];
    post?: number;
  }>;
  zipHref?: string;
  /** Additive fields. Path-free error code when `state` is "failed". */
  code?: string;
  /** Plain-language notes about the result, for example cuts without artwork. */
  warnings?: Array<{ code: string; message: string }>;
  manifestHref?: string;
  /** Hash of the inputs the files were rendered from (compare to tell if they are out of date). */
  inputsHash?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** Body of `POST /api/agent`. The server answers `{ ok: true, ... }` or `{ ok: false, code, error }`. */
export type AgentAction =
  | { action: "bootstrap" }
  | { action: "providers"; refresh?: boolean }
  | { action: "connect"; preferences: AgentPreferences }
  | { action: "preferences"; preferences: AgentPreferences }
  | { action: "disconnect" }
  | { action: "open"; workId: string | null; conversationId?: string }
  | { action: "new"; workId: string | null }
  | { action: "history"; workId: string | null }
  | { action: "delete"; conversationId: string }
  | { action: "send"; conversationId: string; requestId: string; text: string; focus?: AgentFocus }
  | {
      action: "answer";
      conversationId: string;
      questionId: string;
      requestId: string;
      choices: string[];
      other?: string;
    }
  | {
      action: "proposal";
      conversationId: string;
      proposalId: string;
      decision: "apply" | "dismiss";
    }
  | { action: "undo"; conversationId: string; changeId: string }
  | { action: "cancel"; conversationId: string }
  | { action: "memory"; workId: string }
  | { action: "forget"; workId: string; noteId: string }
  /** Additive: run the last failed or stopped turn of the conversation again. */
  | { action: "retry"; conversationId: string };

/** Additive: the success body of each `POST /api/agent` action. */
export interface AgentResponses {
  bootstrap: { ok: true; connection: ConnectionState };
  providers: { ok: true; providers: ProviderStatus[] };
  connect: { ok: true; connection: ConnectionState; providers: ProviderStatus[] };
  preferences: { ok: true; connection: ConnectionState };
  disconnect: { ok: true; connection: ConnectionState };
  open: { ok: true; view: ConversationView };
  new: { ok: true; view: ConversationView };
  history: { ok: true; conversations: ConversationSummary[] };
  delete: { ok: true };
  send: { ok: true; view: ConversationView };
  answer: { ok: true; view: ConversationView };
  proposal: { ok: true; view: ConversationView };
  undo: { ok: true; view: ConversationView };
  cancel: { ok: true; view: ConversationView };
  retry: { ok: true; view: ConversationView };
  memory: { ok: true; memory: MemoryView };
  forget: { ok: true; memory: MemoryView };
}

/**
 * Additive: the failure body of `POST /api/agent`. `providers` is present when
 * a connect or preference change was refused because the CLI is not ready.
 */
export interface AgentFailure {
  ok: false;
  code: string;
  error: string;
  providers?: ProviderStatus[];
}

export interface MemoryNote {
  id: string;
  kind: "decision" | "preference" | "note";
  text: string;
  at: string;
}

export interface MemoryView {
  notes: MemoryNote[];
  tasks: TaskItem[];
  journal: Array<{ changeId: string; at: string; actor: "agent" | "human"; summary: string }>;
}

/** Request header every guarded browser call sends. */
export const AGENT_HEADER = "x-toony-agent";
