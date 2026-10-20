// The agent runtime's turn lifecycle, driven by a scripted provider defined
// here (no CLI runs): connect without a model turn, streaming and items,
// request idempotency, one running turn per conversation, cancel with late
// output ignored, questions and proposals that end a turn in "waiting" and
// continue it after the person answers, a lost native session replaced from
// the recovery brief, sign-in and timeout failures, and the move from the
// previous build's settings and conversations.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listWorkspace, loadProject } from "@toony/project-io";
import type { NativeEvent } from "../agent/adapters.js";
import { parseRecord, trimItems } from "../agent/conversations.js";
import type { Launcher, LaunchSpec } from "../agent/launcher.js";
import type {
  AgentPreferences,
  ConversationItem,
  LiveEvent,
  ProviderStatus,
} from "../agent/protocol.js";
import type { ReadinessResult } from "../agent/readiness.js";
import { AgentRuntime, type ReadinessLike } from "../agent/runtime.js";
import { resolveTurnToken } from "../agent/tokens.js";
import { LiveBus } from "../live/bus.js";

type Script = (io: {
  spec: LaunchSpec;
  emit: (event: NativeEvent) => void;
  stopped: Promise<void>;
}) => Promise<number | null>;

const status = (provider: "claude" | "codex", ready = true): ProviderStatus => ({
  provider,
  label: provider === "claude" ? "Claude Code" : "Codex",
  readiness: ready
    ? { state: "ready", version: provider === "claude" ? "2.1.293" : "0.158.0" }
    : {
        state: "sign-in-required",
        version: "2.1.293",
        command: provider === "claude" ? "claude auth login" : "codex login",
      },
});

function fakeReadiness(ready: { claude: boolean; codex: boolean }): ReadinessLike {
  const binary = (provider: "claude" | "codex") => ({
    path: `/synthetic/${provider}`,
    version: (provider === "claude" ? [2, 1, 293] : [0, 158, 0]) as [number, number, number],
    missingFlags: [],
  });
  return {
    check: async (provider): Promise<ReadinessResult> => ({
      status: status(provider, ready[provider]),
      binary: binary(provider),
    }),
    binary: async (provider) => binary(provider),
    forgetSignIn: () => {},
    all: async () => [status("claude", ready.claude), status("codex", ready.codex)],
  };
}

const done: Script = async ({ emit }) => {
  emit({ type: "text", text: "Done." });
  emit({ type: "completed" });
  return 0;
};

async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  options: {
    ready?: { claude: boolean; codex: boolean };
    idleLimitMs?: number;
    prepare?: (dir: string) => Promise<void>;
  } = {},
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "toony-runtime-")));
  // Write what the store still has pending before removing the folder: on a
  // busy machine a debounced save could land during the removal.
  let flush = async () => {};
  t.after(async () => {
    await flush().catch(() => {});
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await options.prepare?.(dir);
  const bus = new LiveBus();
  const events: LiveEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const scripts: Script[] = [];
  const launches: LaunchSpec[] = [];
  const launcher: Launcher = (spec, emit) => {
    launches.push(spec);
    const script = scripts.shift() ?? done;
    let stop = () => {};
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    return {
      stop: () => stop(),
      kill: () => stop(),
      done: script({ spec, emit, stopped }).then((code) => ({ code })),
    };
  };
  const runtime = new AgentRuntime({
    workspace: dir,
    bus,
    launcher,
    readiness: fakeReadiness(options.ready ?? { claude: true, codex: true }),
    studioUrl: () => "http://127.0.0.1:9",
    idleLimitMs: options.idleLimitMs ?? 60_000,
    idleCheckMs: 10,
    resolveWork: async (id) => {
      const works = await listWorkspace(dir);
      return works.some((w) => w.id === id) ? { id, root: join(dir, id) } : null;
    },
    listWorks: async () =>
      (await listWorkspace(dir)).map((w) => ({
        id: w.id,
        title: w.title,
        episodeCount: w.episodeCount,
      })),
  });
  flush = () => runtime.store.flush();
  await runtime.init();
  return { dir, bus, events, scripts, launches, runtime };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), "condition not reached");
}

const prefs = (over: Partial<AgentPreferences> = {}): AgentPreferences => ({
  provider: "claude",
  model: "",
  autoApply: true,
  viewArtwork: true,
  retainHistory: true,
  ...over,
});

function code(error: unknown): string {
  return String((error as { code?: unknown }).code);
}

test("connect checks readiness and saves settings without running a model turn", async (t) => {
  const { dir, runtime, events, launches } = await setup(t, {
    ready: { claude: false, codex: true },
  });
  await assert.rejects(runtime.connect(prefs()), (error) => {
    assert.equal(code(error), "not-ready");
    assert.match((error as Error).message, /claude auth login/);
    assert.equal((error as { providers?: unknown[] }).providers?.length, 2);
    return true;
  });
  assert.equal(runtime.connectionState().status, "disconnected");
  const { connection } = await runtime.connect(prefs({ provider: "codex" }));
  assert.equal(connection.status, "connected");
  assert.equal(launches.length, 0, "connect never runs a model turn");
  const saved = JSON.parse(await readFile(join(dir, ".toony-agent/settings.json"), "utf8"));
  assert.equal(saved.version, 2);
  assert.equal(saved.preferences.provider, "codex");
  assert.equal((await stat(join(dir, ".toony-agent/settings.json"))).mode & 0o777, 0o600);
  assert.ok(events.some((e) => e.type === "connection" && e.connection.status === "connected"));
  assert.ok(events.some((e) => e.type === "providers"));
  await assert.rejects(
    runtime.setPreferences(prefs({ provider: "claude" })),
    (e) => code(e) === "not-ready",
  );
  const changed = await runtime.setPreferences(prefs({ provider: "codex", autoApply: false }));
  assert.equal(changed.status === "connected" && changed.preferences.autoApply, false);
  await runtime.disconnect();
  assert.equal(runtime.connectionState().status, "disconnected");
  await assert.rejects(readFile(join(dir, ".toony-agent/settings.json")));
});

test("a turn streams text, posts items, completes, and request ids are used once", async (t) => {
  const { runtime, events, launches, scripts, dir } = await setup(t);
  await runtime.connect(prefs());
  const view = await runtime.open(null);
  assert.equal(view.items.length, 0);
  scripts.push(async ({ emit }) => {
    emit({ type: "session", id: "native" });
    emit({ type: "tools-ready", ready: true });
    emit({ type: "text-delta", text: "Hel" });
    emit({ type: "text-delta", text: "lo" });
    emit({ type: "tool", name: "get_status" });
    emit({ type: "text", text: "Hello there." });
    emit({ type: "completed" });
    return 0;
  });
  const requestId = randomUUID();
  const started = await runtime.send(view.id, requestId, "Hi!", { route: "library" });
  assert.equal(started.turn?.state, "running");
  assert.equal(started.items[0]?.kind, "user");
  assert.equal(started.title, "Hi!");
  await runtime.settled(view.id);
  const after = await runtime.open(null, view.id);
  assert.equal(after.turn?.state, "completed");
  assert.deepEqual(
    after.items.map((i) => i.kind),
    ["user", "assistant"],
  );
  // Streamed pieces are sent together, before the finished text replaces them.
  const deltaAt = events.findIndex((e) => e.type === "delta" && e.text === "Hello");
  const replyAt = events.findIndex((e) => e.type === "item" && e.item.kind === "assistant");
  assert.ok(deltaAt !== -1 && deltaAt < replyAt);
  assert.ok(events.some((e) => e.type === "turn" && e.turn?.step === "Checking the project"));
  // The first turn of a conversation is a new native session that starts from the brief.
  const first = launches[0];
  assert.ok(first);
  assert.equal(first.invocation.session.mode, "new");
  assert.match(first.prompt, /Toony status at the start of this session/);
  assert.match(first.prompt, /The person is in the library\./);
  assert.match(first.prompt, /The person says:\nHi!/);
  assert.equal(first.cwd, join(dir, ".toony-agent/sessions", view.id));
  assert.equal((await stat(first.cwd)).mode & 0o777, 0o700);

  // Same request id: no new turn. Same id, different text: refused.
  await runtime.send(view.id, requestId, "Hi!", { route: "library" });
  assert.equal(launches.length, 1);
  await assert.rejects(
    runtime.send(view.id, requestId, "Other", undefined),
    (e) => code(e) === "duplicate",
  );

  // The next turn resumes the same Claude session, without the brief.
  await runtime.send(view.id, randomUUID(), "And now?", undefined);
  await runtime.settled(view.id);
  const second = launches[1];
  assert.ok(second);
  assert.equal(second.invocation.session.mode, "resume");
  assert.equal(
    second.invocation.session.mode === "resume" && second.invocation.session.id,
    first.invocation.session.mode === "new" && first.invocation.session.id,
  );
  assert.doesNotMatch(second.prompt, /Toony status/);
  const file = join(dir, ".toony-agent/conversations/v2", `${view.id}.json`);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(stored.version, 2);
  assert.equal(stored.items.length, 4);
  assert.equal(runtime.history(null)[0]?.id, view.id);
});

test("one turn runs per conversation; cancel stops it and late output is ignored", async (t) => {
  const { runtime, scripts, launches } = await setup(t);
  await runtime.connect(prefs({ provider: "codex" }));
  const view = await runtime.open(null);
  let stopRequested = false;
  scripts.push(async ({ emit, stopped }) => {
    emit({ type: "session", id: "thread-a" });
    await stopped;
    stopRequested = true;
    emit({ type: "text", text: "Too late." });
    emit({ type: "completed" });
    return 130;
  });
  await runtime.send(view.id, randomUUID(), "Write a long story.", undefined);
  await until(() => launches.length === 1);
  await assert.rejects(
    runtime.send(view.id, randomUUID(), "Another", undefined),
    (e) => code(e) === "busy",
  );
  await assert.rejects(runtime.deleteConversation(view.id), (e) => code(e) === "busy");
  const cancelled = await runtime.cancel(view.id);
  assert.equal(cancelled.turn?.state, "cancelled");
  await runtime.settled(view.id);
  assert.ok(stopRequested);
  const after = await runtime.open(null, view.id);
  assert.equal(after.turn?.state, "cancelled");
  assert.ok(!after.items.some((i) => i.kind === "assistant"), "late output is dropped");
  // Retry runs the same message again.
  const retried = await runtime.retry(view.id);
  assert.equal(retried.turn?.state, "running");
  await runtime.settled(view.id);
});

test("a question ends the turn waiting; the answer starts the next turn", async (t) => {
  const { runtime, scripts, launches, events } = await setup(t);
  await runtime.connect(prefs());
  const view = await runtime.open(null);
  let token: string | null = null;
  scripts.push(async ({ spec, emit }) => {
    const result = await spec.callTool("ask_user", {
      question: "Which ending?",
      options: [{ label: "Hopeful" }, { label: "Open" }],
      multiSelect: false,
    });
    assert.equal(result.isError, undefined);
    token = JSON.parse(await readFile(spec.invocation.files.bridgeConfig, "utf8")).token;
    emit({ type: "text", text: "Tell me which ending you want." });
    emit({ type: "completed" });
    return 0;
  });
  await runtime.send(view.id, randomUUID(), "Plan the ending", undefined);
  await runtime.settled(view.id);
  const waiting = await runtime.open(null, view.id);
  assert.equal(waiting.turn?.state, "waiting");
  assert.equal(resolveTurnToken(token), null, "the turn token is revoked at turn end");
  assert.equal(await runtime.callTool(token, "get_status", {}), null);
  const question = waiting.items.find((i) => i.kind === "question");
  assert.ok(question && question.kind === "question");
  await assert.rejects(
    runtime.answer(view.id, question.questionId, randomUUID(), ["Sad"], undefined),
    (e) => code(e) === "answer",
  );
  await assert.rejects(
    runtime.answer(view.id, question.questionId, randomUUID(), ["Hopeful", "Open"], undefined),
    (e) => code(e) === "answer",
  );
  const answerId = randomUUID();
  const answered = await runtime.answer(
    view.id,
    question.questionId,
    answerId,
    ["Hopeful"],
    undefined,
  );
  assert.equal(answered.turn?.state, "running");
  const updated = answered.items.find((i) => i.kind === "question");
  assert.deepEqual(updated && updated.kind === "question" && updated.answer?.choices, ["Hopeful"]);
  await runtime.settled(view.id);
  assert.match(launches[1]?.prompt ?? "", /Answer to "Which ending\?": Hopeful/);
  // Answering twice with the same request id is a no-op; with a new one it is refused.
  await runtime.answer(view.id, question.questionId, answerId, ["Hopeful"], undefined);
  assert.equal(launches.length, 2);
  await assert.rejects(
    runtime.answer(view.id, question.questionId, randomUUID(), ["Open"], undefined),
    (e) => code(e) === "answered",
  );
  assert.ok(events.some((e) => e.type === "item" && e.item.kind === "question"));
});

test("a library chat moves to the work it creates; proposals continue after a decision", async (t) => {
  const { runtime, scripts, launches, events, dir } = await setup(t);
  await runtime.connect(prefs());
  const view = await runtime.open(null);
  scripts.push(async ({ spec, emit }) => {
    const created = await spec.callTool("create_work", { title: "Harbor Letters" });
    assert.equal(created.isError, undefined, created.content[0]?.text);
    const cast = await spec.callTool("save_characters", {
      characters: [{ id: "mina", name: "Mina" }],
    });
    assert.equal(cast.isError, undefined, cast.content[0]?.text);
    await spec.callTool("update_tasks", {
      tasks: [
        { title: "Create the work", status: "done" },
        { title: "Write episode 1", status: "pending" },
      ],
    });
    emit({ type: "completed" });
    return 0;
  });
  await runtime.send(view.id, randomUUID(), "Start a story about letters", undefined);
  await runtime.settled(view.id);
  const workId = (await listWorkspace(dir))[0]?.id ?? "";
  assert.ok(workId);
  assert.ok(events.some((e) => e.type === "rebind" && e.workId === workId));
  assert.ok(
    events.some(
      (e) => e.type === "navigate" && e.reason === "work-created" && e.href === `/w/${workId}`,
    ),
  );
  assert.ok(events.some((e) => e.type === "tasks" && e.tasks.length === 2));
  const moved = await runtime.open(workId, view.id);
  assert.equal(moved.workId, workId);
  assert.equal(moved.tasks.length, 2, "the plan moved into the work's memory");
  assert.equal(runtime.history(null).length, 0);
  assert.ok(moved.items.some((i) => i.kind === "change"));

  // With changes off, the next write is a proposal and the turn waits.
  await runtime.setPreferences(prefs({ autoApply: false }));
  scripts.push(async ({ spec, emit }) => {
    const result = await spec.callTool("create_episode", {
      title: "The Letter",
      script: {
        beats: [
          {
            purpose: "Find it",
            cuts: [{ intent: "Find", scene: "Mina finds a letter.", characters: ["mina"] }],
          },
        ],
      },
    });
    assert.match(result.content[0]?.text ?? "", /proposed/);
    emit({ type: "text", text: "I proposed the first episode." });
    emit({ type: "completed" });
    return 0;
  });
  await runtime.send(view.id, randomUUID(), "Write episode 1", { route: "story" });
  await runtime.settled(view.id);
  const waiting = await runtime.open(workId, view.id);
  assert.equal(waiting.turn?.state, "waiting");
  const proposal = waiting.items.find((i) => i.kind === "proposal");
  assert.ok(proposal && proposal.kind === "proposal" && proposal.state === "pending");
  assert.equal((await loadProject(join(dir, workId))).project.episodes.length, 0);

  const decided = await runtime.decideProposal(view.id, proposal.proposalId, "apply");
  const applied = decided.items.find((i) => i.kind === "proposal");
  assert.ok(
    applied && applied.kind === "proposal" && applied.state === "applied" && applied.changeId,
  );
  assert.equal((await loadProject(join(dir, workId))).project.episodes.length, 1);
  await runtime.settled(view.id);
  assert.equal(launches.length, 3, "the decision continued the work");
  assert.match(launches[2]?.prompt ?? "", /The person applied your proposal/);
  // Deciding again is a no-op; the opposite decision is refused.
  await runtime.decideProposal(view.id, proposal.proposalId, "apply");
  await assert.rejects(
    runtime.decideProposal(view.id, proposal.proposalId, "dismiss"),
    (e) => code(e) === "decided",
  );

  // Undo from the change card.
  const after = await runtime.open(workId, view.id);
  const change = [...after.items].reverse().find((i) => i.kind === "change" && i.undoable);
  assert.ok(change && change.kind === "change");
  const undone = await runtime.undo(view.id, change.changeId);
  const card = undone.items.find((i) => i.kind === "change" && i.changeId === change.changeId);
  assert.ok(card && card.kind === "change" && card.undone);
  assert.equal((await loadProject(join(dir, workId))).project.episodes.length, 0);
  const memory = await runtime.memory(workId);
  assert.equal(memory.tasks.length, 2);
  assert.ok(memory.journal.some((entry) => entry.actor === "human" && /Undid/.test(entry.summary)));
});

test("a lost native session is replaced by a fresh one that starts from the brief", async (t) => {
  const { runtime, scripts, launches } = await setup(t);
  await runtime.connect(prefs());
  const view = await runtime.open(null);
  await runtime.send(view.id, randomUUID(), "First", undefined);
  await runtime.settled(view.id);
  scripts.push(async ({ emit }) => {
    emit({ type: "resume-missing" });
    return 1;
  });
  await runtime.send(view.id, randomUUID(), "Second", undefined);
  await runtime.settled(view.id);
  assert.equal(launches.length, 3);
  assert.equal(launches[1]?.invocation.session.mode, "resume");
  const fresh = launches[2];
  assert.equal(fresh?.invocation.session.mode, "new");
  assert.match(fresh?.prompt ?? "", /Toony status at the start of this session/);
  assert.match(
    fresh?.prompt ?? "",
    /Recent conversation, oldest first:\nPerson: First\nYou: Done\./,
  );
  const after = await runtime.open(null, view.id);
  assert.equal(after.turn?.state, "completed");
});

test("a sign-in failure posts a notice and needs attention without hanging", async (t) => {
  const { runtime, scripts, events } = await setup(t);
  await runtime.connect(prefs());
  const view = await runtime.open(null);
  scripts.push(async ({ emit, stopped }) => {
    emit({ type: "auth-failed" });
    await stopped;
    return 1;
  });
  await runtime.send(view.id, randomUUID(), "Hello", undefined);
  await runtime.settled(view.id);
  const after = await runtime.open(null, view.id);
  assert.equal(after.turn?.state, "failed");
  assert.equal(after.turn?.error?.code, "auth");
  const notice = after.items.find(
    (i): i is Extract<ConversationItem, { kind: "notice" }> => i.kind === "notice",
  );
  assert.equal(notice?.action, "sign-in");
  assert.equal(notice?.command, "claude auth login");
  const state = runtime.connectionState();
  assert.equal(state.status, "needs-attention");
  assert.equal(state.status === "needs-attention" && state.reason, "sign-in");
  assert.ok(
    events.some((e) => e.type === "connection" && e.connection.status === "needs-attention"),
  );
  // A later successful turn clears it.
  await runtime.retry(view.id);
  await runtime.settled(view.id);
  assert.equal(runtime.connectionState().status, "connected");
});

test("a silent agent is stopped by the idle limit", async (t) => {
  const { runtime, scripts } = await setup(t, { idleLimitMs: 40 });
  await runtime.connect(prefs());
  const view = await runtime.open(null);
  scripts.push(async ({ stopped }) => {
    await stopped;
    return null;
  });
  await runtime.send(view.id, randomUUID(), "Hello", undefined);
  await runtime.settled(view.id);
  const after = await runtime.open(null, view.id);
  assert.equal(after.turn?.state, "failed");
  assert.equal(after.turn?.error?.code, "timeout");
});

test("previous-build settings migrate and old conversations stay readable", async (t) => {
  const oldId = randomUUID();
  const { runtime, dir } = await setup(t, {
    prepare: async (root) => {
      await mkdir(join(root, ".toony-agent"), { recursive: true, mode: 0o700 });
      await writeFile(
        join(root, ".toony-agent/settings.json"),
        JSON.stringify({ provider: "codex", model: "", projectContext: true, retainHistory: true }),
      );
      await writeFile(
        join(root, ".toony-agent", `${oldId}.json`),
        JSON.stringify({
          id: oldId,
          workId: null,
          settings: { provider: "codex", model: "", projectContext: true, retainHistory: true },
          messages: [
            {
              id: randomUUID(),
              role: "user",
              text: "An old question",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
            {
              id: randomUUID(),
              role: "assistant",
              text: "An old answer",
              createdAt: "2026-10-01T00:00:01.000Z",
            },
          ],
          updatedAt: "2026-10-01T00:00:01.000Z",
        }),
      );
    },
  });
  const state = runtime.connectionState();
  assert.equal(state.status, "connected");
  assert.deepEqual(state.status === "connected" && state.preferences, {
    provider: "codex",
    model: "",
    autoApply: true,
    viewArtwork: true,
    retainHistory: true,
  });
  const saved = JSON.parse(await readFile(join(dir, ".toony-agent/settings.json"), "utf8"));
  assert.equal(saved.version, 2);
  const [summary] = runtime.history(null);
  assert.equal(summary?.id, oldId);
  assert.equal(summary?.readOnly, true);
  assert.equal(summary?.title, "An old question");
  const old = await runtime.open(null, oldId);
  assert.equal(old.readOnly, true);
  assert.deepEqual(
    old.items.map((i) => i.kind),
    ["user", "assistant"],
  );
  await assert.rejects(
    runtime.send(oldId, randomUUID(), "Continue", undefined),
    (e) => code(e) === "read-only",
  );
  await runtime.deleteConversation(oldId);
  await assert.rejects(readFile(join(dir, ".toony-agent", `${oldId}.json`)));
});

test("conversations kept only in memory are never written; trimming keeps open items", async (t) => {
  const { runtime, dir } = await setup(t);
  await runtime.connect(prefs({ retainHistory: false }));
  const view = await runtime.open(null);
  await runtime.send(view.id, randomUUID(), "Private", undefined);
  await runtime.settled(view.id);
  await assert.rejects(readFile(join(dir, ".toony-agent/conversations/v2", `${view.id}.json`)));

  const items: ConversationItem[] = Array.from({ length: 500 }, (_, i) => ({
    kind: "assistant",
    id: `a${i}`,
    at: "2026-10-20T00:00:00.000Z",
    turnId: "t",
    text: `${i}`,
  }));
  items.splice(3, 0, {
    kind: "question",
    id: "q",
    at: "2026-10-20T00:00:00.000Z",
    turnId: "t",
    questionId: "q1",
    prompt: "Still open?",
    options: [{ label: "Yes" }, { label: "No" }],
    multiSelect: false,
    allowOther: true,
  });
  items.splice(5, 0, {
    kind: "proposal",
    id: "p",
    at: "2026-10-20T00:00:00.000Z",
    turnId: "t",
    proposalId: "p1",
    title: "Edit",
    summary: "Edit",
    targets: [],
    state: "pending",
  });
  const trimmed = trimItems(items, 100);
  assert.equal(trimmed.length, 100);
  assert.ok(trimmed.some((i) => i.id === "q"));
  assert.ok(trimmed.some((i) => i.id === "p"));
  assert.equal(trimmed.at(-1)?.id, "a499");
});

test("a conversation read back after a restart shows no step still running", () => {
  const id = randomUUID();
  const at = "2026-10-20T00:00:00.000Z";
  const record = parseRecord(
    {
      version: 2,
      id,
      workId: null,
      items: [
        {
          kind: "activity",
          id: "a1",
          at,
          turnId: "t",
          tool: "draw_cuts",
          title: "Draw",
          status: "running",
        },
        {
          kind: "activity",
          id: "a2",
          at,
          turnId: "t",
          tool: "read_story",
          title: "Read",
          status: "done",
        },
      ],
      turn: { id: "t", state: "running", startedAt: at },
    },
    id,
  );
  assert.ok(record);
  const [first, second] = record.items;
  assert.ok(first?.kind === "activity" && first.status === "failed");
  assert.match(first.detail ?? "", /Studio restarted/);
  assert.ok(second?.kind === "activity" && second.status === "done");
  assert.equal(record.turn?.state, "failed");
});
