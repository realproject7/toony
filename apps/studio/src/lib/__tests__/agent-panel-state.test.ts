// The agent panel reducer: live events apply once and in seq order, only to
// the open conversation; streamed text becomes the running turn's draft until
// the reply item arrives; a restarted server or a resync marks the view stale;
// pending messages vanish when the server echoes them. Also the pure helpers
// the panel uses for status, plan progress, grouping, routes and server answers.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyLiveEvent,
  canAutoNavigate,
  episodeLabelFromId,
  focusChipLabel,
  focusForRoute,
  formatElapsed,
  groupItems,
  INITIAL_PANEL_STATE,
  labelForHref,
  lastUserText,
  openRequest,
  type PanelState,
  panelReducer,
  panelScope,
  panelStatus,
  readActionResult,
  relativeTime,
  routeInfo,
  startersFor,
  taskProgress,
} from "../agent/panel-state.js";
import type {
  ConnectionState,
  ConversationItem,
  ConversationView,
  LiveEvent,
  TurnState,
} from "../agent/protocol.js";

const connected: ConnectionState = {
  status: "connected",
  verifiedAt: "2026-10-20T00:00:00.000Z",
  preferences: {
    provider: "codex",
    model: "",
    autoApply: true,
    viewArtwork: true,
    retainHistory: true,
  },
};

function view(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "c1",
    workId: "my-work",
    title: "New conversation",
    provider: "codex",
    items: [],
    tasks: [],
    turn: null,
    ...overrides,
  };
}

const running: TurnState = {
  id: "t1",
  conversationId: "c1",
  state: "running",
  startedAt: "2026-10-20T00:00:01.000Z",
  step: "Reading the story",
};

function user(id: string, text: string, at = "2026-10-20T00:00:02.000Z"): ConversationItem {
  return { kind: "user", id, at, text };
}

function assistant(id: string, text: string, turnId = "t1"): ConversationItem {
  return { kind: "assistant", id, at: "2026-10-20T00:00:05.000Z", turnId, text };
}

function activity(
  id: string,
  status: "running" | "done" | "failed",
  turnId = "t1",
): ConversationItem {
  return {
    kind: "activity",
    id,
    at: "2026-10-20T00:00:03.000Z",
    turnId,
    tool: "create_episode",
    title: "Created Episode 2 · 8 cuts",
    status,
  };
}

function withView(v: ConversationView = view(), extra: Partial<PanelState> = {}): PanelState {
  return panelReducer({ ...INITIAL_PANEL_STATE, ...extra }, { type: "view", view: v });
}

function apply(state: PanelState, events: LiveEvent[]): PanelState {
  return events.reduce(applyLiveEvent, state);
}

test("hello sets the connection; a new server resets seq and marks the view stale", () => {
  let state = applyLiveEvent(INITIAL_PANEL_STATE, {
    type: "hello",
    seq: 40,
    serverId: "server-a",
    connection: connected,
  });
  assert.equal(state.serverId, "server-a");
  assert.deepEqual(state.connection, connected);
  assert.equal(state.lastSeq, 0, "hello never skips the replay that follows it");
  assert.equal(state.stale, false);
  state = applyLiveEvent(state, { type: "ping", seq: 41 });
  state = applyLiveEvent(state, {
    type: "connection",
    seq: 42,
    connection: { status: "disconnected" },
  });
  assert.equal(state.lastSeq, 42);
  const restarted = applyLiveEvent(state, {
    type: "hello",
    seq: 1,
    serverId: "server-b",
    connection: connected,
  });
  assert.equal(restarted.lastSeq, 0);
  assert.equal(restarted.stale, true);
  const after = applyLiveEvent(restarted, {
    type: "tasks",
    seq: 2,
    conversationId: "c1",
    tasks: [],
  });
  assert.equal(after.lastSeq, 2, "events from the new server apply");
  assert.equal(panelReducer(after, { type: "refreshed" }).stale, false);
});

test("resync marks the view stale and moves the seq forward", () => {
  const state = applyLiveEvent(withView(), { type: "resync", seq: 900 });
  assert.equal(state.stale, true);
  assert.equal(state.lastSeq, 900);
  const replay = applyLiveEvent(state, {
    type: "item",
    seq: 899,
    conversationId: "c1",
    item: user("u1", "old"),
  });
  assert.equal(replay, state);
});

test("connection and providers events replace their state", () => {
  const state = apply(INITIAL_PANEL_STATE, [
    { type: "connection", seq: 1, connection: connected },
    {
      type: "providers",
      seq: 2,
      providers: [
        {
          provider: "claude",
          label: "Claude Code",
          readiness: {
            state: "sign-in-required",
            version: "2.1.300",
            command: "claude auth login",
          },
        },
      ],
    },
  ]);
  assert.equal(state.connection?.status, "connected");
  assert.equal(state.providers?.[0]?.readiness.state, "sign-in-required");
});

test("items append, replace by id, and replays are ignored", () => {
  let state = withView();
  state = apply(state, [
    { type: "item", seq: 5, conversationId: "c1", item: user("u1", "Make a story") },
    { type: "item", seq: 6, conversationId: "c1", item: activity("a1", "running") },
    { type: "item", seq: 7, conversationId: "c1", item: activity("a1", "done") },
  ]);
  assert.deepEqual(
    state.conversation?.items.map((item) => [item.id, item.kind === "activity" ? item.status : ""]),
    [
      ["u1", ""],
      ["a1", "done"],
    ],
  );
  const replayed = apply(state, [
    { type: "item", seq: 6, conversationId: "c1", item: activity("a1", "running") },
    { type: "item", seq: 7, conversationId: "c1", item: activity("a1", "done") },
  ]);
  assert.equal(replayed, state, "a replayed event returns the same state");
  assert.equal(replayed.conversation?.items.length, 2);
});

test("events are applied in seq order; an older event after a newer one is dropped", () => {
  const state = apply(withView(), [
    { type: "item", seq: 10, conversationId: "c1", item: activity("a1", "done") },
    { type: "item", seq: 9, conversationId: "c1", item: activity("a1", "running") },
  ]);
  const item = state.conversation?.items[0];
  assert.equal(item?.kind === "activity" ? item.status : null, "done");
  assert.equal(state.lastSeq, 10);
});

test("events for another conversation leave the open one unchanged", () => {
  const base = withView();
  const state = apply(base, [
    { type: "item", seq: 1, conversationId: "other", item: user("u9", "elsewhere") },
    {
      type: "turn",
      seq: 2,
      conversationId: "other",
      turn: { ...running, conversationId: "other" },
    },
    { type: "delta", seq: 3, conversationId: "other", turnId: "t1", text: "x" },
    {
      type: "tasks",
      seq: 4,
      conversationId: "other",
      tasks: [{ id: "1", title: "x", status: "done" }],
    },
    { type: "rebind", seq: 5, conversationId: "other", workId: "w2" },
    { type: "conversation", seq: 6, view: view({ id: "other", title: "Other" }) },
  ]);
  assert.deepEqual(state.conversation, base.conversation);
  assert.equal(state.lastSeq, 6);
});

test("deltas build the running turn's draft until the reply item arrives", () => {
  let state = apply(withView(), [
    { type: "turn", seq: 1, conversationId: "c1", turn: running },
    { type: "delta", seq: 2, conversationId: "c1", turnId: "t1", text: "Here is " },
    { type: "delta", seq: 3, conversationId: "c1", turnId: "t1", text: "a plan." },
  ]);
  assert.equal(state.conversation?.turn?.draft, "Here is a plan.");
  // A turn update without draft text (a new step label) keeps the draft.
  state = applyLiveEvent(state, {
    type: "turn",
    seq: 4,
    conversationId: "c1",
    turn: { ...running, step: "Writing episode 2" },
  });
  assert.equal(state.conversation?.turn?.draft, "Here is a plan.");
  assert.equal(state.conversation?.turn?.step, "Writing episode 2");
  // A delta for another turn is ignored.
  state = applyLiveEvent(state, {
    type: "delta",
    seq: 5,
    conversationId: "c1",
    turnId: "t0",
    text: "stray",
  });
  assert.equal(state.conversation?.turn?.draft, "Here is a plan.");
  state = applyLiveEvent(state, {
    type: "item",
    seq: 6,
    conversationId: "c1",
    item: assistant("r1", "Here is a plan."),
  });
  assert.equal(state.conversation?.turn?.draft, undefined);
  assert.equal(state.conversation?.items.at(-1)?.kind, "assistant");
  // Deltas after the turn ended are ignored.
  state = apply(state, [
    {
      type: "turn",
      seq: 7,
      conversationId: "c1",
      turn: { ...running, state: "completed", endedAt: "2026-10-20T00:00:09.000Z" },
    },
    { type: "delta", seq: 8, conversationId: "c1", turnId: "t1", text: "late" },
  ]);
  assert.equal(state.conversation?.turn?.state, "completed");
  assert.equal(state.conversation?.turn?.draft, undefined);
  state = applyLiveEvent(state, { type: "turn", seq: 9, conversationId: "c1", turn: null });
  assert.equal(state.conversation?.turn, null);
});

test("tasks, rebind and conversation events update the open conversation", () => {
  let state = apply(withView(view({ workId: null })), [
    {
      type: "tasks",
      seq: 1,
      conversationId: "c1",
      tasks: [
        { id: "1", title: "Outline", status: "done" },
        { id: "2", title: "Write episode 1", status: "in_progress" },
      ],
    },
    { type: "rebind", seq: 2, conversationId: "c1", workId: "new-work" },
  ]);
  assert.equal(state.conversation?.tasks.length, 2);
  assert.equal(state.conversation?.workId, "new-work");
  state = applyLiveEvent(state, {
    type: "conversation",
    seq: 3,
    view: view({ title: "Fresh title", items: [user("u1", "hello")] }),
  });
  assert.equal(state.conversation?.title, "Fresh title");
  assert.equal(state.conversation?.items.length, 1);
});

test("project, navigate and export events only advance the seq", () => {
  const base = withView();
  const state = apply(base, [
    {
      type: "project",
      seq: 1,
      change: {
        workId: "my-work",
        changeId: "ch1",
        actor: "agent",
        summary: "Created Episode 2",
        scopes: [{ kind: "episodes" }],
        at: "2026-10-20T00:00:00.000Z",
      },
    },
    {
      type: "navigate",
      seq: 2,
      conversationId: "c1",
      href: "/w/my-work/episodes/ep-002",
      reason: "episode-created",
    },
    {
      type: "export",
      seq: 3,
      job: {
        id: "j1",
        workId: "my-work",
        episodeId: "ep-001",
        output: "strip",
        state: "running",
        progress: { done: 1, total: 3 },
      },
    },
  ]);
  assert.equal(state.conversation, base.conversation);
  assert.equal(state.lastSeq, 3);
});

test("a pending message shows until the server echoes it or the send fails", () => {
  let state = withView();
  state = panelReducer(state, {
    type: "pending",
    message: { requestId: "r1", conversationId: "c1", text: "yes", at: "2026-10-20T00:00:02.000Z" },
  });
  state = panelReducer(state, {
    type: "pending",
    message: { requestId: "r2", conversationId: "c1", text: "yes", at: "2026-10-20T00:00:03.000Z" },
  });
  assert.equal(state.pending.length, 2);
  state = applyLiveEvent(state, {
    type: "item",
    seq: 1,
    conversationId: "c1",
    item: user("u1", "yes", "2026-10-20T00:00:02.100Z"),
  });
  assert.deepEqual(
    state.pending.map((message) => message.requestId),
    ["r2"],
    "one echo answers one pending message",
  );
  state = panelReducer(state, { type: "pending-done", requestId: "r2" });
  assert.equal(state.pending.length, 0);
  const cleared = panelReducer(
    panelReducer(state, {
      type: "pending",
      message: { requestId: "r3", conversationId: "c1", text: "x", at: "2026-10-20T00:00:04.000Z" },
    }),
    { type: "view", view: null },
  );
  assert.equal(cleared.conversation, null);
  assert.equal(cleared.pending.length, 0);
});

test("a local item update replaces the card (answered question)", () => {
  const question: ConversationItem = {
    kind: "question",
    id: "q1",
    at: "2026-10-20T00:00:04.000Z",
    turnId: "t1",
    questionId: "qq1",
    prompt: "Which tone?",
    options: [{ label: "Warm" }, { label: "Dark" }],
    multiSelect: false,
    allowOther: true,
  };
  let state = withView(view({ items: [user("u1", "go"), question] }));
  assert.equal(panelStatus(connected, state.conversation), "waiting");
  state = panelReducer(state, {
    type: "item",
    conversationId: "c1",
    item: { ...question, answer: { choices: ["Warm"], at: "2026-10-20T00:00:06.000Z" } },
  });
  assert.equal(panelStatus(connected, state.conversation), "ready");
  assert.equal(panelReducer(state, { type: "item", conversationId: "zz", item: question }), state);
});

test("panel status covers every state", () => {
  assert.equal(panelStatus(null, null), "loading");
  assert.equal(panelStatus({ status: "disconnected" }, null), "not-connected");
  assert.equal(
    panelStatus(
      {
        status: "needs-attention",
        preferences: connected.preferences,
        reason: "sign-in",
        message: "Sign in to Claude.",
        command: "claude auth login",
      },
      null,
    ),
    "needs-attention",
  );
  assert.equal(panelStatus(connected, null), "ready");
  assert.equal(panelStatus(connected, view({ turn: running })), "working");
  assert.equal(panelStatus(connected, view({ turn: { ...running, state: "waiting" } })), "waiting");
  const proposal: ConversationItem = {
    kind: "proposal",
    id: "p1",
    at: "2026-10-20T00:00:04.000Z",
    turnId: "t1",
    proposalId: "pp1",
    title: "Replace lettering",
    summary: "",
    targets: [],
    state: "pending",
  };
  assert.equal(openRequest([proposal]), proposal);
  assert.equal(openRequest([proposal, user("u2", "never mind")]), null);
  assert.equal(panelStatus(connected, view({ items: [proposal] })), "waiting");
});

test("plan progress counts done tasks and picks the current step", () => {
  assert.deepEqual(taskProgress([]), { done: 0, total: 0, current: null });
  const progress = taskProgress([
    { id: "1", title: "Outline", status: "done" },
    { id: "2", title: "Cast", status: "done" },
    { id: "3", title: "Episode 1", status: "pending" },
    { id: "4", title: "Dialogue", status: "in_progress" },
    { id: "5", title: "Export", status: "pending" },
  ]);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, 5);
  assert.equal(progress.current?.title, "Dialogue");
});

test("activity rows group per turn; other items stay single", () => {
  const blocks = groupItems([
    user("u1", "go"),
    activity("a1", "done"),
    activity("a2", "running"),
    assistant("r1", "Done."),
    activity("a3", "done"),
    activity("a4", "done", "t2"),
  ]);
  assert.deepEqual(
    blocks.map((block) =>
      block.kind === "activity" ? `act:${block.items.length}` : block.item.id,
    ),
    ["u1", "act:2", "r1", "act:1", "act:1"],
  );
  assert.equal(lastUserText([user("u1", "a"), assistant("r1", "b"), user("u2", "c")]), "c");
  assert.equal(lastUserText([]), null);
});

test("routes: scope, auto navigation and labels", () => {
  assert.deepEqual(routeInfo("/"), { kind: "library", workId: null });
  assert.deepEqual(routeInfo("/settings"), { kind: "settings", workId: null });
  assert.deepEqual(routeInfo("/w/my%20work"), { kind: "story", workId: "my work" });
  assert.equal(routeInfo("/w/a/characters").kind, "characters");
  assert.equal(routeInfo("/w/a/episodes").kind, "episodes");
  assert.deepEqual(routeInfo("/w/a/episodes/ep-002?item=cut:cut-001"), {
    kind: "episode",
    workId: "a",
    episodeId: "ep-002",
  });
  assert.equal(routeInfo("/w/a/episodes/ep-002/read").kind, "preview");
  assert.equal(routeInfo("/w/a/episodes/ep-002/export").kind, "export");
  assert.equal(routeInfo("/w/a/episodes/ep-002/script").kind, "script");
  assert.equal(panelScope("/", "a"), null);
  assert.equal(panelScope("/settings", "a"), "a", "Settings keeps the current work");
  assert.equal(panelScope("/w/b/characters", "a"), "b");
  assert.equal(canAutoNavigate("/"), true);
  assert.equal(canAutoNavigate("/w/a"), true);
  assert.equal(canAutoNavigate("/w/a/episodes"), true);
  assert.equal(canAutoNavigate("/w/a/episodes/ep-001"), false, "never from an editor");
  assert.equal(canAutoNavigate("/w/a/characters"), false);
  assert.equal(canAutoNavigate("/settings"), false);
  assert.equal(episodeLabelFromId("ep-002"), "Episode 2");
  assert.equal(episodeLabelFromId("ep-010"), "Episode 10");
  assert.equal(episodeLabelFromId("pilot"), null);
  assert.equal(labelForHref("/w/a/episodes/ep-003"), "Episode 3");
  assert.equal(labelForHref("/w/a"), "Story");
  assert.equal(labelForHref("/w/a/episodes/ep-003/export"), "Episode 3 export");
  assert.equal(labelForHref("https://example.com"), "Open");
});

test("the context chip uses labels, never raw ids", () => {
  assert.equal(focusChipLabel({ route: "library" }), null);
  assert.equal(focusChipLabel({ route: "settings" }), null);
  assert.equal(focusChipLabel({ route: "story" }), "Story");
  assert.equal(
    focusChipLabel({
      route: "episode",
      episodeId: "ep-002",
      cutId: "cut-x9",
      bubbleIds: ["b1", "b2"],
      labels: { cut: "Cut 3" },
    }),
    "Episode 2 · Cut 3 · 2 bubbles",
  );
  const unlabeled = focusChipLabel({
    route: "episode",
    episodeId: "pilot-7f",
    cutId: "cut-x9",
    bubbleIds: ["b1"],
  });
  assert.equal(unlabeled, "This episode · Selected cut · 1 bubble");
  assert.ok(!unlabeled?.includes("cut-x9"));
  assert.equal(
    focusChipLabel({ route: "episode", episodeId: "ep-001", transitionId: "tr-1" }),
    "Episode 1 · Transition",
  );
  assert.equal(
    focusChipLabel({ route: "characters", characterId: "mina", labels: { character: "Mina" } }),
    "Characters · Mina",
  );
  assert.equal(focusChipLabel({ route: "export", episodeId: "ep-004" }), "Episode 4 · Export");
});

test("the focus follows the page on screen until the workspace reports", () => {
  const episodeRoute = routeInfo("/w/a/episodes/ep-002");
  const reported = { route: "episode" as const, episodeId: "ep-002", cutId: "cut-003" };
  assert.equal(focusForRoute(episodeRoute, reported), reported);
  assert.deepEqual(focusForRoute(episodeRoute, { route: "library" }), {
    route: "episode",
    episodeId: "ep-002",
  });
  assert.deepEqual(
    focusForRoute(episodeRoute, { route: "episode", episodeId: "ep-001", cutId: "cut-001" }),
    { route: "episode", episodeId: "ep-002" },
    "a report from the previous episode is not reused",
  );
  assert.deepEqual(focusForRoute(routeInfo("/w/a/episodes"), { route: "library" }), {
    route: "story",
  });
  assert.deepEqual(focusForRoute(routeInfo("/"), reported), { route: "library" });
});

test("starters depend on where the person is", () => {
  assert.deepEqual(
    startersFor("library").map((starter) => starter.label),
    ["I have a story idea", "Help me find an idea", "Turn a short story into episodes"],
  );
  assert.deepEqual(
    startersFor("story").map((starter) => starter.label),
    ["Plan the next episode", "Review the story so far"],
  );
  assert.deepEqual(
    startersFor("episode").map((starter) => starter.label),
    [
      "Check this episode's dialogue",
      "Add a cut after this one",
      "Export this episode for Instagram",
    ],
  );
  assert.equal(startersFor("library")[0]?.send, false, "an idea starter waits for the idea");
});

test("server answers are read tolerantly", () => {
  const v = view();
  assert.deepEqual(readActionResult({ ok: true, view: v }).view, v);
  assert.deepEqual(readActionResult({ ok: true, conversation: v }).view, v);
  assert.equal(readActionResult({ ok: true, view: null }).view, null);
  assert.equal("view" in readActionResult({ ok: true }), false);
  assert.equal(
    readActionResult({ ok: true, connection: connected }).connection?.status,
    "connected",
  );
  assert.equal(readActionResult({ ok: true, connection: { status: "odd" } }).connection, undefined);
  const summary = {
    id: "c1",
    workId: null,
    title: "Idea",
    updatedAt: "2026-10-20T00:00:00.000Z",
    preview: "hi",
  };
  assert.equal(readActionResult({ ok: true, conversations: [summary] }).conversations?.length, 1);
  assert.equal(readActionResult({ ok: true, history: [summary] }).conversations?.length, 1);
  const memory = readActionResult({
    ok: true,
    memory: { notes: [{ id: "n1", kind: "decision", text: "Tone is warm", at: "x" }] },
  }).memory;
  assert.equal(memory?.notes.length, 1);
  assert.deepEqual(memory?.journal, []);
  assert.equal(
    readActionResult({ ok: true, notes: [], tasks: [], journal: [] }).memory?.notes.length,
    0,
  );
  assert.deepEqual(readActionResult(null), {});
});

test("time labels", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(12_400), "12s");
  assert.equal(formatElapsed(65_000), "1m 05s");
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  assert.equal(relativeTime("2026-10-20T11:59:30.000Z", now), "just now");
  assert.equal(relativeTime("2026-10-20T11:30:00.000Z", now), "30 min ago");
  assert.equal(relativeTime("2026-10-20T09:00:00.000Z", now), "3 h ago");
  assert.equal(relativeTime("2026-10-19T09:00:00.000Z", now), "Yesterday");
  assert.equal(relativeTime("not a date", now), "");
});
