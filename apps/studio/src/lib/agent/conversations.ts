// Conversations, version 2: `<workspace>/.toony-agent/conversations/v2/<id>.json`
// (folder 0700, files 0600, atomic writes). A conversation keeps its items
// (messages, activity, changes, questions, proposals, notices), the native
// session id per provider, the last turn, idempotency keys and the data of
// pending proposals. Items are bounded; trimming drops the oldest items but
// never an unanswered question or a pending proposal.
//
// Conversations from the previous build (`.toony-agent/<id>.json`, plain
// messages) are listed and readable as history, but cannot be continued.

import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentFocus,
  AgentProvider,
  ConversationItem,
  ConversationSummary,
  ConversationView,
  TaskItem,
  TurnState,
} from "./protocol.js";
import { privateDir, readPrivateJson, serialized, writePrivateJson } from "./storage.js";
import type { StoredProposal } from "./tools/run.js";
import { isProvider, isUuid } from "./types.js";

export const CONVERSATION_VERSION = 2;
export const ITEMS_MAX = 400;
export const CONVERSATIONS_LOADED_MAX = 500;
const REQUESTS_KEPT = 100;
const FILE_LIMIT = 8 * 1024 * 1024;

export interface NativeSession {
  id: string;
  model: string;
  at: string;
}

export interface ConversationRecord {
  version: 2;
  id: string;
  workId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  items: ConversationItem[];
  /** The task list of a library conversation. A work's tasks live in its memory. */
  tasks: TaskItem[];
  native: Partial<Record<AgentProvider, NativeSession>>;
  /** Provider of the last turn. */
  provider: AgentProvider | null;
  turn: TurnState | null;
  /** When the last turn ended: journal entries after it are "changed since your last turn". */
  lastTurnEndedAt: string | null;
  /** Request ids already handled, with what they carried. */
  requests: Array<{ requestId: string; key: string }>;
  /** Data of proposals the person has not decided yet. */
  proposals: StoredProposal[];
  /** Said to the agent at the start of its next turn (decisions, undos made meanwhile). */
  pendingNotes: string[];
  /** The last message or answer that started a turn, for retry. */
  lastTrigger: {
    text: string;
    focus?: AgentFocus;
    kind?: "message" | "answer" | "continuation" | "retry";
  } | null;
  /** False when the person turned off "keep conversations": never written to disk. */
  retained: boolean;
  /** A conversation from the previous build. */
  readOnly?: boolean;
}

export function conversationsDir(agentDir: string): string {
  return join(agentDir, "conversations", "v2");
}

const now = () => new Date().toISOString();

export function newConversation(workId: string | null, retained: boolean): ConversationRecord {
  const at = now();
  return {
    version: 2,
    id: randomUUID(),
    workId,
    title: "New chat",
    createdAt: at,
    updatedAt: at,
    items: [],
    tasks: [],
    native: {},
    provider: null,
    turn: null,
    lastTurnEndedAt: null,
    requests: [],
    proposals: [],
    pendingNotes: [],
    lastTrigger: null,
    retained,
  };
}

/** An item that must survive trimming: an open question or an undecided proposal. */
export function isOpenItem(item: ConversationItem): boolean {
  return (
    (item.kind === "question" && item.answer === undefined) ||
    (item.kind === "proposal" && item.state === "pending")
  );
}

/** Drop the oldest items beyond `max`, keeping every open item. */
export function trimItems(items: readonly ConversationItem[], max = ITEMS_MAX): ConversationItem[] {
  if (items.length <= max) return [...items];
  let excess = items.length - max;
  const kept: ConversationItem[] = [];
  for (const item of items) {
    if (excess > 0 && !isOpenItem(item)) {
      excess -= 1;
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/** Add or replace an item by id. Returns the stored copy. */
export function upsertItem(record: ConversationRecord, item: ConversationItem): ConversationItem {
  const index = record.items.findIndex((existing) => existing.id === item.id);
  if (index === -1) record.items.push(item);
  else record.items[index] = item;
  if (record.items.length > ITEMS_MAX + 50) record.items = trimItems(record.items);
  record.updatedAt = now();
  return item;
}

export function rememberRequest(record: ConversationRecord, requestId: string, key: string): void {
  record.requests.push({ requestId, key });
  if (record.requests.length > REQUESTS_KEPT)
    record.requests.splice(0, record.requests.length - REQUESTS_KEPT);
}

export function findRequest(record: ConversationRecord, requestId: string): string | null {
  return record.requests.find((entry) => entry.requestId === requestId)?.key ?? null;
}

function lastText(record: ConversationRecord): string {
  for (let i = record.items.length - 1; i >= 0; i--) {
    const item = record.items[i];
    if (item && (item.kind === "assistant" || item.kind === "user")) return item.text;
  }
  return "";
}

export function summaryOf(record: ConversationRecord): ConversationSummary {
  const preview = lastText(record).replace(/\s+/g, " ").trim();
  return {
    id: record.id,
    workId: record.workId,
    title: record.title,
    updatedAt: record.updatedAt,
    preview: preview.length > 120 ? `${preview.slice(0, 119)}…` : preview,
    ...(record.readOnly ? { readOnly: true } : {}),
    provider: record.provider,
    state: record.turn?.state ?? null,
  };
}

export function viewOf(
  record: ConversationRecord,
  tasks: TaskItem[],
  turn: TurnState | null = record.turn,
): ConversationView {
  return structuredClone({
    id: record.id,
    workId: record.workId,
    title: record.title,
    provider: record.provider,
    items: record.items,
    tasks,
    turn,
    ...(record.readOnly ? { readOnly: true } : {}),
  });
}

// ---------------------------------------------------------------------------
// Loading (tolerant: anything malformed is skipped, never shown)

const ITEM_KINDS = new Set([
  "user",
  "assistant",
  "activity",
  "change",
  "question",
  "proposal",
  "notice",
]);

function cleanItems(value: unknown): ConversationItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ConversationItem =>
      item !== null &&
      typeof item === "object" &&
      ITEM_KINDS.has((item as { kind?: string }).kind ?? "") &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { at?: unknown }).at === "string",
  );
}

export function parseRecord(value: unknown, fileId: string): ConversationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== CONVERSATION_VERSION || v.id !== fileId || !isUuid(v.id)) return null;
  if (v.workId !== null && typeof v.workId !== "string") return null;
  const native: ConversationRecord["native"] = {};
  if (v.native && typeof v.native === "object") {
    for (const [provider, session] of Object.entries(v.native as Record<string, unknown>)) {
      const s = session as Record<string, unknown> | null;
      if (isProvider(provider) && s && typeof s.id === "string" && typeof s.model === "string") {
        native[provider] = {
          id: s.id,
          model: s.model,
          at: typeof s.at === "string" ? s.at : now(),
        };
      }
    }
  }
  const turn = v.turn && typeof v.turn === "object" ? (v.turn as TurnState) : null;
  return {
    version: 2,
    id: v.id,
    workId: v.workId as string | null,
    title: typeof v.title === "string" ? v.title.slice(0, 120) : "New chat",
    createdAt: typeof v.createdAt === "string" ? v.createdAt : now(),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : now(),
    // Nothing can still be running in a conversation read back from disk.
    items: trimItems(cleanItems(v.items)).map((item) =>
      item.kind === "activity" && item.status === "running"
        ? { ...item, status: "failed" as const, detail: "Stopped when Studio restarted." }
        : item,
    ),
    tasks: Array.isArray(v.tasks) ? (v.tasks as TaskItem[]).slice(0, 30) : [],
    native,
    provider: isProvider(v.provider) ? v.provider : null,
    turn:
      turn && typeof turn.id === "string" && typeof turn.state === "string"
        ? turn.state === "running"
          ? {
              ...turn,
              state: "failed",
              endedAt: turn.endedAt ?? now(),
              error: {
                code: "other",
                message: "This response was interrupted. Send a message to continue.",
              },
            }
          : turn
        : null,
    lastTurnEndedAt: typeof v.lastTurnEndedAt === "string" ? v.lastTurnEndedAt : null,
    requests: Array.isArray(v.requests)
      ? (v.requests as Array<{ requestId: string; key: string }>)
          .filter((r) => r && typeof r.requestId === "string" && typeof r.key === "string")
          .slice(-REQUESTS_KEPT)
      : [],
    proposals: Array.isArray(v.proposals) ? (v.proposals as StoredProposal[]) : [],
    pendingNotes: Array.isArray(v.pendingNotes)
      ? (v.pendingNotes as unknown[]).filter((n): n is string => typeof n === "string").slice(-20)
      : [],
    lastTrigger:
      v.lastTrigger && typeof (v.lastTrigger as { text?: unknown }).text === "string"
        ? (v.lastTrigger as ConversationRecord["lastTrigger"])
        : null,
    retained: true,
  };
}

/** A previous-build conversation as a read-only record. */
export function parseLegacy(value: unknown, fileId: string): ConversationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.id !== fileId || !isUuid(v.id) || !Array.isArray(v.messages)) return null;
  if (v.workId !== null && typeof v.workId !== "string") return null;
  const settings = v.settings as Record<string, unknown> | undefined;
  const items: ConversationItem[] = [];
  for (const raw of v.messages.slice(0, 200)) {
    const m = raw as Record<string, unknown>;
    if (!m || typeof m.text !== "string" || typeof m.id !== "string") continue;
    const at = typeof m.createdAt === "string" ? m.createdAt : now();
    if (m.role === "user")
      items.push({ kind: "user", id: m.id, at, text: m.text.slice(0, 60_000) });
    else if (m.role === "assistant") {
      items.push({
        kind: "assistant",
        id: m.id,
        at,
        turnId: "legacy",
        text: m.text.slice(0, 60_000),
      });
    }
  }
  const first = items.find((item) => item.kind === "user");
  const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : now();
  return {
    ...newConversation(v.workId as string | null, true),
    id: v.id,
    title:
      first && first.kind === "user"
        ? first.text.replace(/\s+/g, " ").slice(0, 70)
        : "Earlier chat",
    createdAt: items[0]?.at ?? updatedAt,
    updatedAt,
    items,
    provider: isProvider(settings?.provider) ? settings.provider : null,
    readOnly: true,
  };
}

export class ConversationStore {
  private readonly records = new Map<string, ConversationRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private loaded: Promise<void> | null = null;

  constructor(private readonly agentDir: string) {}

  get dir(): string {
    return conversationsDir(this.agentDir);
  }

  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  private async read(): Promise<void> {
    await privateDir(this.dir);
    const candidates: Array<{ file: string; id: string; legacy: boolean; mtime: number }> = [];
    for (const [dir, legacy] of [
      [this.dir, false],
      [this.agentDir, true],
    ] as const) {
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        names = [];
      }
      for (const name of names) {
        const id = name.replace(/\.json$/, "");
        if (!name.endsWith(".json") || !isUuid(id)) continue;
        const file = join(dir, name);
        try {
          candidates.push({ file, id, legacy, mtime: (await stat(file)).mtimeMs });
        } catch {
          // Gone meanwhile.
        }
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    for (const candidate of candidates.slice(0, CONVERSATIONS_LOADED_MAX)) {
      if (this.records.has(candidate.id)) continue;
      try {
        const value = await readPrivateJson(candidate.file, FILE_LIMIT);
        const record = candidate.legacy
          ? parseLegacy(value, candidate.id)
          : parseRecord(value, candidate.id);
        if (record) this.records.set(record.id, record);
      } catch {
        // An unreadable file is skipped.
      }
    }
  }

  get(id: string): ConversationRecord | undefined {
    return this.records.get(id);
  }

  all(): ConversationRecord[] {
    return [...this.records.values()];
  }

  /** Conversations of a work (null: the library), newest first. */
  list(workId: string | null): ConversationRecord[] {
    return this.all()
      .filter((record) => record.workId === workId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  create(workId: string | null, retained: boolean): ConversationRecord {
    const record = newConversation(workId, retained);
    this.records.set(record.id, record);
    return record;
  }

  /** Save soon (coalesces bursts such as export progress). */
  scheduleSave(record: ConversationRecord, delayMs = 150): void {
    if (!record.retained || record.readOnly) return;
    if (this.timers.has(record.id)) return;
    this.timers.set(
      record.id,
      setTimeout(() => {
        this.timers.delete(record.id);
        void this.save(record).catch(() => {});
      }, delayMs),
    );
  }

  /** Save now. A conversation the person chose not to keep is never written. */
  async save(record: ConversationRecord): Promise<void> {
    const timer = this.timers.get(record.id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(record.id);
    }
    if (!record.retained || record.readOnly) return;
    if (!this.records.has(record.id)) return;
    // An empty chat is not worth a file; it is written with its first item.
    if (record.items.length === 0 && record.turn === null) return;
    await serialized(`conversation:${record.id}`, async () => {
      if (!this.records.has(record.id)) return;
      record.items = trimItems(record.items);
      const { retained: _retained, readOnly: _readOnly, ...stored } = record;
      await writePrivateJson(join(this.dir, `${record.id}.json`), stored);
    });
  }

  async delete(id: string): Promise<void> {
    const record = this.records.get(id);
    this.records.delete(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    await serialized(`conversation:${id}`, async () => {
      if (record?.readOnly) await rm(join(this.agentDir, `${id}.json`), { force: true });
      else await rm(join(this.dir, `${id}.json`), { force: true });
    });
  }

  /** Write every pending save now (tests, shutdown). */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    await Promise.all(
      pending.map((id) => {
        const record = this.records.get(id);
        return record ? this.save(record) : Promise.resolve();
      }),
    );
  }
}
