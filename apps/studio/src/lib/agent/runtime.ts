// The agent runtime: the connection, the conversations, and the turns.
//
// A turn is one run of the person's own CLI (Claude Code or Codex) in the
// conversation's private folder, resuming the conversation's native session
// when it has one. The CLI reaches Toony only through the Toony tools (MCP
// bridge -> /api/agent/tools with the turn's bearer token). Everything the
// panel shows is a live event: conversation, item, turn, delta, tasks,
// rebind, navigate, connection and providers.
//
// Rules:
//   - one running turn per conversation; a request id is used once;
//   - a question or a proposal ends the turn in "waiting"; the answer or the
//     decision starts the next turn;
//   - cancel stops the CLI's process group; late output is ignored;
//   - 15 minutes per turn at most, 5 minutes without any sign of life;
//   - a native session that cannot be resumed is replaced by a fresh one that
//     starts from the recovery brief and the recent messages.

import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type LoadedProject, loadProject } from "@toony/project-io";
import { type LiveBus, liveBus } from "../live/bus.js";
import { contextFor, readJournal, undoChange } from "../ops/index.js";
import type { NativeEvent, TurnInvocation } from "./adapters.js";
import { writeRunFiles } from "./bridge.js";
import {
  type ConversationRecord,
  ConversationStore,
  findRequest,
  isOpenItem,
  rememberRequest,
  summaryOf,
  upsertItem,
  viewOf,
} from "./conversations.js";
import { cliLauncher, type Launcher, type LaunchHandle } from "./launcher.js";
import { focusLine, readMemory, recoveryBrief, updateMemory } from "./memory.js";
import type {
  AgentFocus,
  AgentPreferences,
  AgentProvider,
  ConnectionState,
  ConversationItem,
  ConversationSummary,
  ConversationView,
  MemoryView,
  ProviderStatus,
  TaskItem,
  TurnErrorCode,
  TurnState,
} from "./protocol.js";
import { PROVIDER_INFO, Readiness, type ReadinessResult } from "./readiness.js";
import { AGENT_RULES } from "./rules.js";
import { loadSettings, type SavedConnection, saveSettings, settingsFile } from "./settings.js";
import { privateDir } from "./storage.js";
import { issueTurnToken, resolveTurnToken, revokeTurnToken } from "./tokens.js";
import { mcpTools, stepLabel } from "./tools/catalog.js";
import {
  type ApplyOutcome,
  applyProposal,
  itemId,
  type ResolvedWorkRef,
  runTool,
  type StoredProposal,
  type ToolHost,
  type ToolResult,
} from "./tools/run.js";
import { AgentError, isUuid } from "./types.js";

export const TURN_HARD_LIMIT_MS = 15 * 60_000;
export const TURN_IDLE_LIMIT_MS = 5 * 60_000;
export const MESSAGE_MAX = 12_000;
export const RUNNING_TURNS_MAX = 3;
/** Streamed text is published at most this often, so deltas do not flood the live buffer. */
const DELTA_MS = 80;
const RECENT_MAX_BYTES = 6 * 1024;

export interface ReadinessLike {
  check(provider: AgentProvider, refresh?: boolean): Promise<ReadinessResult>;
  binary(provider: AgentProvider): Promise<ReadinessResult["binary"]>;
  forgetSignIn(provider: AgentProvider): void;
  all(refresh?: boolean): Promise<ProviderStatus[]>;
}

export interface RuntimeOptions {
  /** Absolute, real path of the workspace. */
  workspace: string;
  resolveWork: (workId: string) => Promise<ResolvedWorkRef | null>;
  listWorks: () => Promise<Array<{ id: string; title: string; episodeCount: number }>>;
  bus?: LiveBus;
  launcher?: Launcher;
  readiness?: ReadinessLike;
  /** Studio's own base URL for the MCP bridge. */
  studioUrl?: () => string;
  hardLimitMs?: number;
  idleLimitMs?: number;
  /** How often the idle limit is checked. */
  idleCheckMs?: number;
}

type Failure = { code: TurnErrorCode; message: string };

interface Trigger {
  /** What the agent is told. */
  text: string;
  focus?: AgentFocus;
  /** "message": the person's words; other kinds are Toony's own notes. */
  kind: "message" | "answer" | "continuation" | "retry";
}

interface RunningTurn {
  turn: TurnState;
  record: ConversationRecord;
  provider: AgentProvider;
  model: string;
  token: string | null;
  handle: LaunchHandle | null;
  attempt: number;
  draft: string;
  waiting: boolean;
  cancelled: boolean;
  finished: boolean;
  completed: boolean;
  resumeMissing: boolean;
  failure: Failure | null;
  lastEventAt: number;
  sawText: boolean;
  /** Streamed text not yet published (deltas are sent at most every DELTA_MS). */
  pendingDelta: string;
  deltaTimer: ReturnType<typeof setTimeout> | null;
  /** Notes taken into this turn's prompt; given back if the turn does not finish. */
  notes: string[];
  host: TurnHost;
  done: Promise<void>;
}

const now = () => new Date().toISOString();

function keyOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function failureNotice(provider: AgentProvider, failure: Failure): ConversationItem {
  const info = PROVIDER_INFO[provider];
  const base = { kind: "notice" as const, id: itemId("note"), at: now() };
  switch (failure.code) {
    case "auth":
      return {
        ...base,
        tone: "error",
        text: `${info.label} is not signed in. Sign in in a terminal, then try again.`,
        action: "sign-in",
        command: info.loginCommand,
      };
    case "rate-limit":
      return {
        ...base,
        tone: "warning",
        text: "Your plan's usage limit was reached. Try again later.",
        action: "retry",
      };
    case "unavailable":
      return { ...base, tone: "error", text: failure.message, action: "settings" };
    default:
      return { ...base, tone: "error", text: failure.message, action: "retry" };
  }
}

/** A plain sentence for a provider that cannot run turns. */
export function notReadyMessage(status: ProviderStatus): string {
  const r = status.readiness;
  switch (r.state) {
    case "sign-in-required":
      return r.message
        ? `${r.message} Run \`${r.command}\` in a terminal, then connect again.`
        : `Sign in to ${status.label} first: run \`${r.command}\` in a terminal, then connect again.`;
    case "missing":
      return `${status.label} is not installed on this computer. Install it with \`${r.installCommand}\`.`;
    case "unsupported":
      return `This ${status.label} version (${r.version}) is not supported. Toony works with ${r.supported}.`;
    case "unavailable":
      return r.detail;
    case "checking":
      return `Toony is still checking ${status.label}.`;
    default:
      return "";
  }
}

/** Duck-typed refusal from lib/ops (code + status), possibly from another bundle. */
function opRefusal(error: unknown): { message: string; status: number } | null {
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return { message: error.message, status: (error as unknown as { status: number }).status };
  }
  return null;
}

class TurnHost implements ToolHost {
  constructor(
    private readonly runtime: AgentRuntime,
    readonly record: ConversationRecord,
    readonly turnId: string,
    private readonly run: RunningTurn | null,
  ) {}
  get workspace(): string {
    return this.runtime.workspace;
  }
  get conversationId(): string {
    return this.record.id;
  }
  workId(): string | null {
    return this.record.workId;
  }
  preferences(): AgentPreferences {
    return this.runtime.preferencesOrDefault();
  }
  resolveWork(id: string): Promise<ResolvedWorkRef | null> {
    return this.runtime.options.resolveWork(id);
  }
  listWorks() {
    return this.runtime.options.listWorks();
  }
  item(item: ConversationItem): void {
    this.runtime.postItem(this.record, item);
  }
  changeUndone(changeId: string): void {
    this.runtime.markUndone(this.record, changeId);
  }
  setTasks(tasks: TaskItem[]): Promise<void> {
    return this.runtime.setTasks(this.record, tasks);
  }
  conversationTasks(): TaskItem[] {
    return this.record.tasks;
  }
  openQuestions(): string[] {
    return this.record.items.flatMap((item) =>
      item.kind === "question" && item.answer === undefined ? [item.prompt] : [],
    );
  }
  since(): string | null {
    return this.record.lastTurnEndedAt;
  }
  navigate(href: string, reason: "work-created" | "episode-created"): void {
    this.runtime.bus.publish({ type: "navigate", conversationId: this.record.id, href, reason });
  }
  rebind(workId: string): Promise<void> {
    return this.runtime.rebind(this.record, workId);
  }
  waiting(): void {
    if (this.run) this.run.waiting = true;
  }
  addProposal(proposal: StoredProposal): void {
    this.record.proposals.push(proposal);
    this.runtime.store.scheduleSave(this.record);
  }
  touch(): void {
    if (this.run) this.run.lastEventAt = Date.now();
  }
}

export class AgentRuntime {
  readonly workspace: string;
  readonly agentDir: string;
  readonly bus: LiveBus;
  readonly store: ConversationStore;
  readonly readiness: ReadinessLike;
  private readonly launcher: Launcher;
  private connection: SavedConnection | null = null;
  private attention: {
    reason: "sign-in" | "missing" | "unsupported" | "unavailable";
    message: string;
    command?: string;
  } | null = null;
  private readonly running = new Map<string, RunningTurn>();
  private initialized: Promise<void> | null = null;
  private port: number | null = null;

  constructor(readonly options: RuntimeOptions) {
    this.workspace = options.workspace;
    this.agentDir = join(options.workspace, ".toony-agent");
    this.bus = options.bus ?? liveBus();
    this.store = new ConversationStore(this.agentDir);
    this.launcher = options.launcher ?? cliLauncher;
    this.readiness = options.readiness ?? new Readiness({ cwd: join(this.agentDir, "probe") });
  }

  init(): Promise<void> {
    this.initialized ??= (async () => {
      await privateDir(this.agentDir);
      await privateDir(join(this.agentDir, "probe"));
      this.connection = await loadSettings(this.agentDir);
      await this.store.load();
      this.bus.connectionState = () => this.connectionState();
    })();
    return this.initialized;
  }

  /** The Studio port the bridge calls back on (from the request that reached Studio). */
  setPort(port: number | null): void {
    if (port !== null && Number.isInteger(port) && port > 0 && port < 65536) this.port = port;
  }

  studioUrl(): string {
    if (this.options.studioUrl) return this.options.studioUrl();
    const port = this.port ?? (Number(process.env.PORT) || 3000);
    return `http://127.0.0.1:${port}`;
  }

  preferencesOrDefault(): AgentPreferences {
    return (
      this.connection?.preferences ?? {
        provider: "claude",
        model: "",
        autoApply: true,
        viewArtwork: true,
        retainHistory: true,
      }
    );
  }

  connectionState(): ConnectionState {
    if (this.connection === null) return { status: "disconnected" };
    if (this.attention !== null) {
      return {
        status: "needs-attention",
        preferences: { ...this.connection.preferences },
        reason: this.attention.reason,
        message: this.attention.message,
        ...(this.attention.command ? { command: this.attention.command } : {}),
      };
    }
    return {
      status: "connected",
      preferences: { ...this.connection.preferences },
      verifiedAt: this.connection.verifiedAt,
    };
  }

  private publishConnection(): void {
    this.bus.publish({ type: "connection", connection: this.connectionState() });
  }

  // -------------------------------------------------------------------------
  // Connection

  async providers(refresh = false): Promise<ProviderStatus[]> {
    const providers = await this.readiness.all(refresh);
    this.bus.publish({ type: "providers", providers });
    return providers;
  }

  private async requireReady(provider: AgentProvider): Promise<ProviderStatus[]> {
    const checked = await this.readiness.check(provider, true);
    const providers = await this.readiness.all(false);
    this.bus.publish({ type: "providers", providers });
    if (checked.status.readiness.state !== "ready") {
      throw Object.assign(new AgentError("not-ready", notReadyMessage(checked.status), 409), {
        providers,
      });
    }
    return providers;
  }

  /** Check readiness (no model turn) and save the connection. */
  async connect(
    preferences: AgentPreferences,
  ): Promise<{ connection: ConnectionState; providers: ProviderStatus[] }> {
    const providers = await this.requireReady(preferences.provider);
    this.connection = { version: 2, preferences: { ...preferences }, verifiedAt: now() };
    this.attention = null;
    await saveSettings(this.agentDir, this.connection);
    this.publishConnection();
    return { connection: this.connectionState(), providers };
  }

  async setPreferences(preferences: AgentPreferences): Promise<ConnectionState> {
    if (this.connection === null)
      throw new AgentError("connection", "Connect an agent first.", 409);
    const providerChanged = preferences.provider !== this.connection.preferences.provider;
    if (providerChanged) await this.requireReady(preferences.provider);
    this.connection = {
      version: 2,
      preferences: { ...preferences },
      verifiedAt: providerChanged ? now() : this.connection.verifiedAt,
    };
    if (providerChanged) this.attention = null;
    await saveSettings(this.agentDir, this.connection);
    this.publishConnection();
    return this.connectionState();
  }

  async disconnect(): Promise<ConnectionState> {
    for (const run of this.running.values()) this.stopRun(run);
    this.connection = null;
    this.attention = null;
    await rm(settingsFile(this.agentDir), { force: true });
    this.publishConnection();
    return this.connectionState();
  }

  private requireConnection(): SavedConnection {
    if (this.connection === null)
      throw new AgentError("connection", "Connect an agent first.", 409);
    return this.connection;
  }

  // -------------------------------------------------------------------------
  // Conversations

  private record(conversationId: unknown): ConversationRecord {
    if (!isUuid(conversationId))
      throw new AgentError("conversation", "This chat is unavailable.", 404);
    const record = this.store.get(conversationId);
    if (!record) {
      throw new AgentError(
        "conversation",
        "This chat is no longer available. Your message is still in the box.",
        404,
      );
    }
    return record;
  }

  private async tasksOf(record: ConversationRecord): Promise<TaskItem[]> {
    if (record.workId === null) return record.tasks;
    const work = await this.options.resolveWork(record.workId);
    return work ? (await readMemory(work.root)).tasks : [];
  }

  async view(record: ConversationRecord): Promise<ConversationView> {
    const run = this.running.get(record.id);
    const turn = run ? { ...run.turn, ...(run.draft ? { draft: run.draft } : {}) } : record.turn;
    return viewOf(record, await this.tasksOf(record), turn);
  }

  async open(workId: string | null, conversationId?: string): Promise<ConversationView> {
    if (conversationId !== undefined) {
      const record = this.record(conversationId);
      if (record.workId !== workId) {
        throw new AgentError("conversation", "This chat belongs to another webtoon.", 404);
      }
      return this.view(record);
    }
    const latest = this.store.list(workId)[0];
    if (latest) return this.view(latest);
    return this.view(this.store.create(workId, this.preferencesOrDefault().retainHistory));
  }

  async newConversation(workId: string | null): Promise<ConversationView> {
    const empty = this.store
      .list(workId)
      .find(
        (record) => record.items.length === 0 && !record.readOnly && !this.running.has(record.id),
      );
    if (empty) {
      empty.updatedAt = now();
      return this.view(empty);
    }
    const record = this.store.create(workId, this.preferencesOrDefault().retainHistory);
    const view = await this.view(record);
    this.bus.publish({ type: "conversation", view });
    return view;
  }

  history(workId: string | null): ConversationSummary[] {
    return this.store
      .list(workId)
      .filter((record) => record.items.length > 0)
      .map(summaryOf);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const record = this.record(conversationId);
    if (this.running.has(record.id)) {
      throw new AgentError("busy", "Stop the agent before deleting this chat.", 409);
    }
    await this.store.delete(record.id);
  }

  /** Append or replace an item, publish it and save soon. */
  postItem(record: ConversationRecord, item: ConversationItem): void {
    const stored = upsertItem(record, item);
    this.bus.publish({ type: "item", conversationId: record.id, item: structuredClone(stored) });
    this.store.scheduleSave(record);
  }

  markUndone(record: ConversationRecord, changeId: string): void {
    for (const item of record.items) {
      if (item.kind === "change" && item.changeId === changeId && !item.undone) {
        this.postItem(record, { ...item, undone: true });
      }
    }
  }

  async setTasks(record: ConversationRecord, tasks: TaskItem[]): Promise<void> {
    if (record.workId === null) {
      record.tasks = tasks;
      this.store.scheduleSave(record);
    } else {
      const work = await this.options.resolveWork(record.workId);
      if (work) {
        await updateMemory(work.root, (memory) => {
          memory.tasks = tasks;
          return memory;
        });
      }
    }
    this.bus.publish({ type: "tasks", conversationId: record.id, tasks: structuredClone(tasks) });
  }

  /** Move a library conversation to the work its agent just created. */
  async rebind(record: ConversationRecord, workId: string): Promise<void> {
    if (record.workId === workId) return;
    const tasks = record.tasks;
    record.workId = workId;
    record.tasks = [];
    record.updatedAt = now();
    if (tasks.length > 0) {
      const work = await this.options.resolveWork(workId);
      if (work) {
        await updateMemory(work.root, (memory) => {
          memory.tasks = tasks;
          return memory;
        });
      }
    }
    this.bus.publish({ type: "rebind", conversationId: record.id, workId });
    this.bus.publish({ type: "conversation", view: await this.view(record) });
    await this.store.save(record);
  }

  // -------------------------------------------------------------------------
  // Messages, answers, decisions

  private assertCanRun(record: ConversationRecord): void {
    if (record.readOnly) {
      throw new AgentError(
        "read-only",
        "This chat is from an earlier version of Toony. Start a new chat to continue.",
        409,
      );
    }
    if (this.running.has(record.id)) {
      throw new AgentError(
        "busy",
        "The agent is still working in this chat. Stop it or wait for it to finish.",
        409,
      );
    }
    if (this.running.size >= RUNNING_TURNS_MAX) {
      throw new AgentError("busy", "The agent is busy in other chats. Try again in a moment.", 409);
    }
  }

  async send(
    conversationId: string,
    requestId: string,
    text: string,
    focus: AgentFocus | undefined,
  ): Promise<ConversationView> {
    this.requireConnection();
    if (!isUuid(requestId)) throw new AgentError("request", "The request is incomplete.");
    const message = typeof text === "string" ? text.trim() : "";
    if (message === "" || message.length > MESSAGE_MAX) {
      throw new AgentError("message", "Write a message of up to 12,000 characters.");
    }
    const record = this.record(conversationId);
    const key = keyOf(["send", message, focus ?? null]);
    const seen = findRequest(record, requestId);
    if (seen !== null) {
      if (seen !== key) {
        throw new AgentError(
          "duplicate",
          "This request was already used for a different message.",
          409,
        );
      }
      return this.view(record);
    }
    this.assertCanRun(record);
    // A message sent while a question is open answers it in the person's own words.
    for (const item of record.items) {
      if (item.kind === "question" && item.answer === undefined) {
        this.postItem(record, { ...item, answer: { choices: [], other: message, at: now() } });
      }
    }
    rememberRequest(record, requestId, key);
    if (record.title === "New chat") {
      const title = message.replace(/\s+/g, " ").trim();
      record.title = title.length > 70 ? `${title.slice(0, 69)}…` : title;
    }
    this.postItem(record, {
      kind: "user",
      id: itemId("msg"),
      at: now(),
      text: message,
      ...(focus ? { focus } : {}),
    });
    record.lastTrigger = { text: message, ...(focus ? { focus } : {}), kind: "message" };
    this.startTurn(record, { text: message, ...(focus ? { focus } : {}), kind: "message" });
    return this.view(record);
  }

  async answer(
    conversationId: string,
    questionId: string,
    requestId: string,
    choices: unknown,
    other: unknown,
  ): Promise<ConversationView> {
    const record = this.record(conversationId);
    if (!isUuid(requestId)) throw new AgentError("request", "The request is incomplete.");
    const question = record.items.find(
      (item): item is Extract<ConversationItem, { kind: "question" }> =>
        item.kind === "question" && item.questionId === questionId,
    );
    if (!question) throw new AgentError("question", "This question is no longer open.", 404);
    const picked = Array.isArray(choices) ? choices : [];
    const free = typeof other === "string" ? other.trim() : "";
    const key = keyOf(["answer", questionId, picked, free]);
    const seen = findRequest(record, requestId);
    if (seen !== null) {
      if (seen !== key)
        throw new AgentError(
          "duplicate",
          "This request was already used for a different answer.",
          409,
        );
      return this.view(record);
    }
    if (question.answer !== undefined)
      throw new AgentError("answered", "This question was already answered.", 409);
    const labels = question.options.map((option) => option.label);
    if (
      !picked.every((choice) => typeof choice === "string" && labels.includes(choice)) ||
      new Set(picked).size !== picked.length
    ) {
      throw new AgentError("answer", "Choose from the offered options.");
    }
    if (!question.multiSelect && picked.length > 1)
      throw new AgentError("answer", "Choose one option.");
    if (free && !question.allowOther)
      throw new AgentError("answer", "Choose one of the offered options.");
    if (free.length > 2000)
      throw new AgentError("answer", "Keep your answer under 2,000 characters.");
    if (picked.length === 0 && free === "")
      throw new AgentError("answer", "Choose an option first.");
    rememberRequest(record, requestId, key);
    this.postItem(record, {
      ...question,
      answer: { choices: picked as string[], ...(free ? { other: free } : {}), at: now() },
    });
    const said = [...(picked as string[]), ...(free ? [`Other: ${free}`] : [])].join(", ");
    const textForAgent = `Answer to "${question.prompt}": ${said}`;
    this.continueWith(record, textForAgent, "answer");
    return this.view(record);
  }

  /**
   * Start the next turn with a note from Toony, or keep the note for the next
   * turn when one is running or no agent is connected.
   */
  private continueWith(record: ConversationRecord, text: string, kind: Trigger["kind"]): void {
    const focus = this.lastFocus(record);
    if (
      this.connection === null ||
      this.running.has(record.id) ||
      this.running.size >= RUNNING_TURNS_MAX
    ) {
      record.pendingNotes.push(text);
      this.store.scheduleSave(record);
      return;
    }
    record.lastTrigger = { text, ...(focus ? { focus } : {}), kind };
    this.startTurn(record, { text, ...(focus ? { focus } : {}), kind });
  }

  private lastFocus(record: ConversationRecord): AgentFocus | undefined {
    for (let i = record.items.length - 1; i >= 0; i--) {
      const item = record.items[i];
      if (item?.kind === "user") return item.focus;
    }
    return undefined;
  }

  async decideProposal(
    conversationId: string,
    proposalId: string,
    decision: "apply" | "dismiss",
  ): Promise<ConversationView> {
    const record = this.record(conversationId);
    const item = record.items.find(
      (entry): entry is Extract<ConversationItem, { kind: "proposal" }> =>
        entry.kind === "proposal" && entry.proposalId === proposalId,
    );
    if (!item) throw new AgentError("proposal", "This proposal is no longer available.", 404);
    if (item.state !== "pending") {
      const same =
        (item.state === "applied" && decision === "apply") ||
        (item.state === "dismissed" && decision === "dismiss");
      if (same) return this.view(record);
      throw new AgentError("decided", "This proposal was already decided.", 409);
    }
    const stored = record.proposals.find((p) => p.proposalId === proposalId);
    let note: string;
    if (decision === "dismiss" || !stored) {
      this.postItem(record, { ...item, state: stored ? "dismissed" : "stale" });
      note = stored
        ? `The person dismissed your proposal: ${item.summary}.`
        : `Your proposal could not be kept: ${item.summary}.`;
    } else {
      // Claim it before any await so a double click applies once.
      this.postItem(record, { ...item, state: "applied" });
      const host = new TurnHost(this, record, item.turnId, null);
      let outcome: ApplyOutcome;
      try {
        outcome = await applyProposal(host, stored);
      } catch (error) {
        this.postItem(record, { ...item, state: "pending" });
        throw new AgentError(
          "apply",
          opRefusal(error)?.message ?? "This proposal could not be applied. Try again.",
          500,
        );
      }
      if (outcome.applied) {
        const changeId = outcome.changes[0]?.changeId;
        this.postItem(record, { ...item, state: "applied", ...(changeId ? { changeId } : {}) });
        note = `The person applied your proposal: ${outcome.summary}.`;
      } else {
        this.postItem(record, { ...item, state: "stale" });
        note = `Your proposal "${item.summary}" could not be applied: ${outcome.message}`;
      }
    }
    record.proposals = record.proposals.filter((p) => p.proposalId !== proposalId);
    record.pendingNotes.push(note);
    this.store.scheduleSave(record);
    this.maybeContinue(record, item.turnId);
    return this.view(record);
  }

  /** When nothing from a turn waits for the person any more, tell the agent what they decided. */
  private maybeContinue(record: ConversationRecord, turnId: string): void {
    const open = record.items.some(
      (entry) => isOpenItem(entry) && "turnId" in entry && entry.turnId === turnId,
    );
    if (open || record.pendingNotes.length === 0) return;
    if (
      this.connection === null ||
      this.running.has(record.id) ||
      this.running.size >= RUNNING_TURNS_MAX
    )
      return;
    const notes = record.pendingNotes.splice(0);
    const text = `${notes.join("\n")}\nContinue where you left off, or wrap up if nothing is left.`;
    const focus = this.lastFocus(record);
    record.lastTrigger = { text, ...(focus ? { focus } : {}), kind: "continuation" };
    this.startTurn(record, { text, ...(focus ? { focus } : {}), kind: "continuation" });
  }

  async undo(conversationId: string, changeId: string): Promise<ConversationView> {
    const record = this.record(conversationId);
    const item = record.items.find(
      (entry): entry is Extract<ConversationItem, { kind: "change" }> =>
        entry.kind === "change" && entry.changeId === changeId,
    );
    if (!item) throw new AgentError("change", "This change is not in this chat.", 404);
    if (item.undone) return this.view(record);
    if (!item.undoable) throw new AgentError("change", "This change cannot be undone.", 409);
    const workId = item.targets[0]?.workId ?? record.workId;
    const work = workId ? await this.options.resolveWork(workId) : null;
    if (!work) throw new AgentError("work", "This webtoon is no longer in the workspace.", 404);
    try {
      await undoChange(contextFor(work.root, { actor: "human", workId: work.id }), changeId);
    } catch (error) {
      const refusal = opRefusal(error);
      if (refusal)
        throw new AgentError("undo", refusal.message, refusal.status === 404 ? 404 : 409);
      throw error;
    }
    this.postItem(record, { ...item, undone: true });
    record.pendingNotes.push(`The person undid your change: ${item.summary}.`);
    this.store.scheduleSave(record);
    return this.view(record);
  }

  async cancel(conversationId: string): Promise<ConversationView> {
    const record = this.record(conversationId);
    const run = this.running.get(record.id);
    if (run) this.stopRun(run);
    return this.view(record);
  }

  async retry(conversationId: string): Promise<ConversationView> {
    this.requireConnection();
    const record = this.record(conversationId);
    const state = record.turn?.state;
    if (!record.lastTrigger || (state !== "failed" && state !== "cancelled")) {
      throw new AgentError("retry", "There is nothing to try again.", 409);
    }
    this.assertCanRun(record);
    const last = record.lastTrigger;
    this.startTurn(record, {
      text: last.text,
      ...(last.focus ? { focus: last.focus } : {}),
      kind: last.kind === "message" || last.kind === undefined ? "retry" : last.kind,
    });
    return this.view(record);
  }

  async memory(workId: string): Promise<MemoryView> {
    const work = await this.options.resolveWork(workId);
    if (!work) throw new AgentError("work", "This webtoon is not in the workspace.", 404);
    const [memory, journal] = await Promise.all([
      readMemory(work.root),
      readJournal(work.root, 30),
    ]);
    return {
      notes: memory.notes,
      tasks: memory.tasks,
      journal: journal.reverse().map((entry) => ({
        changeId: entry.changeId,
        at: entry.at,
        actor: entry.actor,
        summary: entry.summary,
      })),
    };
  }

  async forget(workId: string, noteId: string): Promise<MemoryView> {
    const work = await this.options.resolveWork(workId);
    if (!work) throw new AgentError("work", "This webtoon is not in the workspace.", 404);
    await updateMemory(work.root, (memory) => {
      memory.notes = memory.notes.filter((note) => note.id !== noteId);
      return memory;
    });
    return this.memory(workId);
  }

  // -------------------------------------------------------------------------
  // Tool calls from the MCP bridge

  /** Run a tool for the turn a bearer token belongs to. Null when the token is not live. */
  async callTool(token: string | null, name: string, args: unknown): Promise<ToolResult | null> {
    const grant = resolveTurnToken(token);
    if (grant === null) return null;
    const run = this.running.get(grant.conversationId);
    if (!run || run.turn.id !== grant.turnId || run.finished || run.cancelled) {
      return {
        content: [{ type: "text", text: "This turn has ended. Toony did not run the tool." }],
        isError: true,
      };
    }
    run.lastEventAt = Date.now();
    const result = await runTool(run.host, name, args);
    run.lastEventAt = Date.now();
    return result;
  }

  // -------------------------------------------------------------------------
  // Turns

  private publishTurn(run: RunningTurn): void {
    this.bus.publish({
      type: "turn",
      conversationId: run.record.id,
      turn: { ...run.turn, ...(run.draft ? { draft: run.draft } : {}) },
    });
  }

  private stopRun(run: RunningTurn): void {
    if (run.finished || run.cancelled) return;
    run.cancelled = true;
    run.turn.state = "cancelled";
    run.handle?.stop();
    this.publishTurn(run);
  }

  private startTurn(record: ConversationRecord, trigger: Trigger): TurnState {
    const preferences = this.requireConnection().preferences;
    const turn: TurnState = {
      id: randomUUID(),
      conversationId: record.id,
      state: "running",
      startedAt: now(),
      step: "Starting your agent",
    };
    const run = {
      turn,
      record,
      provider: preferences.provider,
      model: preferences.model,
      token: null,
      handle: null,
      attempt: 0,
      draft: "",
      waiting: false,
      cancelled: false,
      finished: false,
      completed: false,
      resumeMissing: false,
      failure: null,
      lastEventAt: Date.now(),
      sawText: false,
      pendingDelta: "",
      deltaTimer: null,
      notes: [],
      done: Promise.resolve(),
    } as unknown as RunningTurn;
    run.host = new TurnHost(this, record, turn.id, run);
    this.running.set(record.id, run);
    record.turn = turn;
    record.provider = preferences.provider;
    record.updatedAt = now();
    this.publishTurn(run);
    this.store.scheduleSave(record);
    run.done = this.execute(run, trigger)
      .catch(() => {
        if (!run.failure)
          run.failure = {
            code: "other",
            message: "The agent could not finish this turn. Try again.",
          };
      })
      .then(() => this.finish(run));
    return turn;
  }

  /** Wait for a conversation's running turn (tests and shutdown). */
  async settled(conversationId?: string): Promise<void> {
    const runs = conversationId
      ? [this.running.get(conversationId)].filter((r): r is RunningTurn => r !== undefined)
      : [...this.running.values()];
    await Promise.all(runs.map((run) => run.done));
  }

  private async execute(run: RunningTurn, trigger: Trigger): Promise<void> {
    const { record, provider } = run;
    const binary = await this.readiness.binary(provider);
    const problem = Readiness.binaryProblem(provider, binary);
    if (problem !== null || binary === null) {
      const status: ProviderStatus = {
        provider,
        label: PROVIDER_INFO[provider].label,
        readiness: problem ?? { state: "unavailable", detail: "The agent could not start." },
      };
      run.failure = { code: "unavailable", message: notReadyMessage(status) };
      const reason = status.readiness.state;
      if (reason === "missing" || reason === "unsupported" || reason === "unavailable") {
        this.attention = { reason, message: run.failure.message };
        this.publishConnection();
      }
      return;
    }
    if (run.cancelled) return;
    run.token = issueTurnToken({ conversationId: record.id, turnId: run.turn.id });
    const runDir = join(this.agentDir, "runs", run.turn.id);
    try {
      const cwd = await privateDir(join(this.agentDir, "sessions", record.id));
      const files = await writeRunFiles(runDir, {
        url: this.studioUrl(),
        token: run.token,
        tools: mcpTools(),
        rules: AGENT_RULES,
      });
      // Notes for the agent are taken once; a failed turn gives them back.
      const notes = record.pendingNotes.splice(0);
      run.notes = notes;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (run.cancelled) return;
        run.attempt = attempt;
        const native = record.native[provider];
        const resume = native !== undefined && native.model === run.model;
        const sessionId = resume ? native.id : provider === "claude" ? randomUUID() : undefined;
        const invocation: TurnInvocation = {
          provider,
          model: run.model,
          session: resume
            ? { mode: "resume", id: native.id }
            : { mode: "new", ...(sessionId ? { id: sessionId } : {}) },
          files,
        };
        const prompt = await this.buildPrompt(record, trigger, !resume, notes);
        run.resumeMissing = false;
        run.failure = null;
        run.completed = false;
        run.lastEventAt = Date.now();
        await this.launch(run, {
          provider,
          binary: binary.path,
          invocation,
          cwd,
          prompt,
          callTool: async (name, args) =>
            (await this.callTool(run.token, name, args)) ?? {
              content: [{ type: "text", text: "This turn has ended." }],
              isError: true,
            },
        });
        if (run.resumeMissing && resume && !run.cancelled) {
          // The CLI no longer has this session: start a fresh one from the brief.
          delete record.native[provider];
          continue;
        }
        if (!run.completed && !run.failure && !run.cancelled) {
          run.failure = {
            code: "other",
            message: "The agent stopped before finishing. Try again.",
          };
        }
        if (run.completed && provider === "claude" && sessionId && !resume) {
          record.native.claude = { id: sessionId, model: run.model, at: now() };
        }
        return;
      }
    } finally {
      if (run.token) revokeTurnToken(run.turn.id);
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private launch(run: RunningTurn, spec: Parameters<Launcher>[0]): Promise<void> {
    const attempt = run.attempt;
    const hard = this.options.hardLimitMs ?? TURN_HARD_LIMIT_MS;
    const idle = this.options.idleLimitMs ?? TURN_IDLE_LIMIT_MS;
    const live = () => !run.finished && run.attempt === attempt && !run.cancelled;
    const fail = (failure: Failure) => {
      if (!run.failure) run.failure = failure;
      run.handle?.stop();
    };
    const emit = (event: NativeEvent) => {
      if (!live()) return;
      run.lastEventAt = Date.now();
      this.onEvent(run, event, fail);
    };
    let handle: LaunchHandle;
    try {
      handle = this.launcher(spec, emit);
    } catch {
      run.failure = {
        code: "unavailable",
        message: "The agent could not start. Check its installation.",
      };
      return Promise.resolve();
    }
    run.handle = handle;
    // A failure or a stop that arrived while the CLI was starting stops it now.
    if (run.failure || run.cancelled) handle.stop();
    const started = Date.now();
    const timer = setInterval(() => {
      if (!live()) return;
      if (Date.now() - started > hard) {
        fail({
          code: "timeout",
          message: "The turn took longer than 15 minutes, so Toony stopped it.",
        });
      } else if (Date.now() - run.lastEventAt > idle) {
        fail({
          code: "timeout",
          message: "The agent stopped responding, so Toony ended this turn.",
        });
      }
    }, this.options.idleCheckMs ?? 5_000);
    return handle.done
      .then(({ code }) => {
        if (live() && !run.completed && !run.failure && !run.resumeMissing) {
          run.failure = {
            code: "other",
            message:
              code === 0
                ? "The agent ended without finishing. Try again."
                : "The agent stopped before finishing. Try again.",
          };
        }
      })
      .finally(() => clearInterval(timer));
  }

  private onEvent(run: RunningTurn, event: NativeEvent, fail: (failure: Failure) => void): void {
    const { record } = run;
    switch (event.type) {
      case "session":
        if (run.provider === "codex") {
          record.native.codex = { id: event.id, model: run.model, at: now() };
          this.store.scheduleSave(record);
        }
        break;
      case "tools-ready":
        if (!event.ready)
          fail({ code: "other", message: "Toony's tools did not start for the agent. Try again." });
        break;
      case "text-delta":
        run.draft += event.text;
        run.pendingDelta += event.text;
        run.deltaTimer ??= setTimeout(() => this.publishDelta(run), DELTA_MS);
        break;
      case "text":
        this.flushText(run, event.text);
        break;
      case "tool": {
        const step = stepLabel(event.name, event.input);
        if (step !== run.turn.step) {
          run.turn.step = step;
          this.publishTurn(run);
        }
        break;
      }
      case "completed":
        run.completed = true;
        break;
      case "auth-failed":
        fail({ code: "auth", message: `${PROVIDER_INFO[run.provider].label} is not signed in.` });
        break;
      case "rate-limited":
        fail({
          code: "rate-limit",
          message: "Your plan's usage limit was reached. Try again later.",
        });
        break;
      case "failed":
        if (!run.failure) run.failure = { code: "other", message: event.message };
        break;
      case "resume-missing":
        run.resumeMissing = true;
        break;
    }
  }

  /** Send the streamed text gathered since the last delta event. */
  private publishDelta(run: RunningTurn): void {
    if (run.deltaTimer) clearTimeout(run.deltaTimer);
    run.deltaTimer = null;
    if (!run.pendingDelta) return;
    const text = run.pendingDelta;
    run.pendingDelta = "";
    this.bus.publish({ type: "delta", conversationId: run.record.id, turnId: run.turn.id, text });
  }

  private flushText(run: RunningTurn, text: string): void {
    const clean = text.trim();
    this.publishDelta(run);
    run.draft = "";
    if (!clean) return;
    run.sawText = true;
    this.postItem(run.record, {
      kind: "assistant",
      id: itemId("say"),
      at: now(),
      turnId: run.turn.id,
      text: clean.length > 60_000 ? `${clean.slice(0, 59_999)}…` : clean,
    });
    if (run.turn.step !== "Writing") {
      run.turn.step = "Writing";
    }
  }

  private async finish(run: RunningTurn): Promise<void> {
    const { record, turn } = run;
    if (run.finished) return;
    run.finished = true;
    if (run.deltaTimer) clearTimeout(run.deltaTimer);
    run.deltaTimer = null;
    run.pendingDelta = "";
    if (run.token) revokeTurnToken(turn.id);
    const ended = now();
    if ((run.cancelled || run.failure) && run.notes.length > 0) {
      record.pendingNotes = [...run.notes, ...record.pendingNotes];
    }
    if (run.cancelled) {
      turn.state = "cancelled";
      turn.error = { code: "cancelled", message: "Stopped. Your conversation is kept." };
    } else if (run.failure) {
      turn.state = "failed";
      turn.error = { ...run.failure };
      this.postItem(record, failureNotice(run.provider, run.failure));
      if (run.failure.code === "auth") {
        const info = PROVIDER_INFO[run.provider];
        this.readiness.forgetSignIn(run.provider);
        this.attention = {
          reason: "sign-in",
          message: `${info.label} is not signed in. Run the command in a terminal, then try again.`,
          command: info.loginCommand,
        };
        this.publishConnection();
      }
    } else {
      if (run.draft.trim()) this.flushText(run, run.draft);
      turn.state = run.waiting ? "waiting" : "completed";
      if (this.attention !== null && this.connection?.preferences.provider === run.provider) {
        this.attention = null;
        this.publishConnection();
      }
    }
    run.draft = "";
    delete turn.step;
    delete turn.draft;
    turn.endedAt = ended;
    record.turn = { ...turn };
    record.lastTurnEndedAt = ended;
    record.updatedAt = ended;
    if (this.running.get(record.id) === run) this.running.delete(record.id);
    this.bus.publish({ type: "turn", conversationId: record.id, turn: { ...turn } });
    await this.store.save(record).catch(() => {});
    // Answers and decisions made while the turn was still running continue the work now.
    if (turn.state === "waiting") this.maybeContinue(record, turn.id);
  }

  // -------------------------------------------------------------------------
  // Prompts

  private async loadWork(
    record: ConversationRecord,
  ): Promise<{ work: ResolvedWorkRef; loaded: LoadedProject } | null> {
    if (record.workId === null) return null;
    const work = await this.options.resolveWork(record.workId);
    if (!work) return null;
    try {
      return { work, loaded: await loadProject(work.root) };
    } catch {
      return null;
    }
  }

  private recentMessages(record: ConversationRecord): string {
    const lines: string[] = [];
    let bytes = 0;
    const items = record.items.filter((item) => item.kind === "user" || item.kind === "assistant");
    // The newest user message is the trigger itself.
    const history = items.at(-1)?.kind === "user" ? items.slice(0, -1) : items;
    for (const item of history.slice(-12).reverse()) {
      if (item.kind !== "user" && item.kind !== "assistant") continue;
      const who = item.kind === "user" ? "Person" : "You";
      const text = item.text.length > 1200 ? `${item.text.slice(0, 1199)}…` : item.text;
      const line = `${who}: ${text}`;
      bytes += Buffer.byteLength(line);
      if (bytes > RECENT_MAX_BYTES) break;
      lines.unshift(line);
    }
    return lines.join("\n");
  }

  /** The prompt of one turn: [brief and recent messages for a new session] + notes + focus + text. */
  async buildPrompt(
    record: ConversationRecord,
    trigger: Trigger,
    fresh: boolean,
    notes: readonly string[] = [],
  ): Promise<string> {
    const parts: string[] = [];
    const work = await this.loadWork(record);
    const openQuestions = record.items.flatMap((item) =>
      item.kind === "question" && item.answer === undefined ? [item.prompt] : [],
    );
    if (fresh) {
      let brief: string;
      if (work) {
        const [memory, journal] = await Promise.all([
          readMemory(work.work.root),
          readJournal(work.work.root, 200),
        ]);
        brief = recoveryBrief({
          project: work.loaded.project,
          memory,
          journal,
          since: record.lastTurnEndedAt,
          openQuestions,
          tasks: memory.tasks,
        });
      } else {
        brief = recoveryBrief({
          project: null,
          works: await this.options.listWorks(),
          memory: { version: 1, notes: [], tasks: [], updatedAt: now() },
          journal: [],
          since: record.lastTurnEndedAt,
          openQuestions,
          tasks: record.tasks,
        });
      }
      parts.push(`Toony status at the start of this session:\n\n${brief}`);
      const recent = this.recentMessages(record);
      if (recent) parts.push(`Recent conversation, oldest first:\n${recent}`);
    } else if (work && record.lastTurnEndedAt) {
      const since = record.lastTurnEndedAt;
      const changed = (await readJournal(work.work.root, 100)).filter(
        (entry) => entry.at > since && entry.actor === "human",
      );
      if (changed.length > 0) {
        parts.push(
          `The person changed the project since your last turn:\n${changed
            .slice(-10)
            .map((entry) => `- ${entry.summary}`)
            .join("\n")}`,
        );
      }
    }
    if (notes.length > 0) {
      parts.push(`Since your last turn:\n${notes.map((note) => `- ${note}`).join("\n")}`);
    }
    parts.push(focusLine(work?.loaded.project ?? null, trigger.focus));
    parts.push(
      trigger.kind === "message" || trigger.kind === "retry"
        ? `The person says:\n${trigger.text}`
        : trigger.text,
    );
    return parts.join("\n\n");
  }
}
