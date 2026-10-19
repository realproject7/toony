import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { type AgentRunner, AgentStore, type ContextReader } from "../agent/store.js";
import type { AgentSettings } from "../agent/types.js";

const settings: AgentSettings = {
  provider: "codex",
  model: "",
  projectContext: true,
  retainHistory: true,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(
  t: TestContext,
  runner: AgentRunner = async () => "A suggestion",
  context: ContextReader = async () => "saved scene",
) {
  const root = await mkdtemp(join(tmpdir(), "agent-store-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "conversations");
  const store = new AgentStore(dir, runner, context);
  await store.init();
  return {
    store,
    dir,
    root,
    connect: async (config = settings) => {
      await store.verify(config);
      await store.configure(config);
    },
  };
}
test("connection settings require a successful matching check without project data", async (t) => {
  const prompts: string[] = [];
  const { store, dir } = await fixture(
    t,
    async (_, prompt) => {
      prompts.push(prompt);
      return "Hi";
    },
    async () => {
      throw new Error("Context must not be read");
    },
  );
  assert.deepEqual(store.view(null), { settings: null, conversation: null, turn: null });
  await assert.rejects(store.configure(settings), /Check this connection/);
  await store.verify(settings);
  await assert.rejects(
    store.configure({ ...settings, retainHistory: false }),
    /Check this connection/,
  );
  await store.configure(settings);
  assert.equal(prompts.length, 1);
  assert.ok(!prompts[0]?.includes("saved scene"));
  assert.equal((await stat(join(dir, "settings.json"))).mode & 0o777, 0o600);
});
test("accepted sends are idempotent and persisted before the provider runs", async (t) => {
  const done = deferred<string>();
  let calls = 0;
  let dir = "";
  const f = await fixture(t, async (_, prompt) => {
    calls++;
    if (calls === 1) return "Hi";
    assert.ok(prompt.includes("saved scene"));
    assert.ok((await readdir(dir)).some((name) => name !== "settings.json"));
    return done.promise;
  });
  dir = f.dir;
  await f.connect();
  const id =
    (await f.store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  const request = randomUUID();
  const first = await f.store.send("work", id, "Please help", request, {});
  assert.equal(first.turn?.state, "running");
  await f.store.send("work", id, "Please help", request, {});
  await assert.rejects(f.store.send("work", id, "Different", request, {}), /already used/);
  done.resolve("Suggestion");
  await f.store.settled();
  assert.equal(calls, 2);
  assert.equal(f.store.view("work").conversation?.messages.length, 2);
  assert.equal(
    JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")).messages[1].text,
    "Suggestion",
  );
});
test("work scope and connection preferences isolate conversation history", async (t) => {
  const { store, connect } = await fixture(t);
  await connect();
  const id =
    (await store.newConversation("one")).conversation?.id ?? assert.fail("Expected a conversation");
  await store.send("one", id, "Hello", randomUUID(), {});
  await store.settled();
  assert.throws(() => store.read("two", id), /unavailable/);
  assert.equal(store.history("two").length, 0);
  await store.verify({ ...settings, projectContext: false });
  await store.configure({ ...settings, projectContext: false });
  assert.equal(store.history("one")[0]?.canContinue, false);
  await assert.rejects(store.open("one", id), /different connection/);
});
test("stopping a response preserves the user's message and discards a late answer", async (t) => {
  const answer = deferred<string>();
  let calls = 0;
  const { store, connect } = await fixture(t, async () => (++calls === 1 ? "Hi" : answer.promise));
  await connect();
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  await store.send("work", id, "Draft", randomUUID(), {});
  store.cancel("work", id);
  answer.resolve("Too late");
  await store.settled();
  assert.equal(store.view("work").turn?.state, "cancelled");
  assert.deepEqual(
    store.view("work").conversation?.messages.map((m) => m.text),
    ["Draft"],
  );
});
test("disconnect during context loading prevents account transmission", async (t) => {
  const context = deferred<string>(),
    started = deferred<void>();
  let calls = 0;
  const { store, connect } = await fixture(
    t,
    async () => {
      calls++;
      return "Hi";
    },
    async () => {
      started.resolve();
      return context.promise;
    },
  );
  await connect();
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  const sending = store.send("work", id, "Draft", randomUUID(), {});
  await started.promise;
  const queued = store.send("work", id, "Queued", randomUUID(), {});
  const disconnect = store.disconnect();
  context.resolve("saved scene");
  await assert.rejects(sending, /connection changed/);
  await assert.rejects(queued, /connection changed/);
  await disconnect;
  assert.equal(calls, 1);
  assert.equal(store.view("work").settings, null);
});
test("new conversation cannot race a pending context read into a second active turn", async (t) => {
  const context = deferred<string>(),
    started = deferred<void>(),
    answer = deferred<string>();
  let calls = 0;
  const { store, connect } = await fixture(
    t,
    async () => (++calls === 1 ? "Hi" : answer.promise),
    async () => {
      started.resolve();
      return context.promise;
    },
  );
  await connect();
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  const sending = store.send("work", id, "Draft", randomUUID(), {});
  await started.promise;
  const next = store.newConversation("work");
  context.resolve("saved");
  await sending;
  await assert.rejects(next, /Stop the current response/);
  answer.resolve("Done");
  await store.settled();
  assert.equal(store.view("work").conversation?.id, id);
});
test("history survives restart and interrupted responses never resume automatically", async (t) => {
  const answer = deferred<string>();
  let calls = 0;
  const { store, dir, connect } = await fixture(t, async () =>
    ++calls === 1 ? "Hi" : answer.promise,
  );
  await connect();
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  const request = randomUUID();
  await store.send("work", id, "Draft", request, {});
  let restartedCalls = 0;
  const saved = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
  saved.extra = "TEST_PRIVATE_EXTRA";
  saved.messages[0].extra = "TEST_PRIVATE_EXTRA";
  await writeFile(join(dir, `${id}.json`), JSON.stringify(saved));
  const restarted = new AgentStore(
    dir,
    async () => {
      restartedCalls++;
      return "No";
    },
    async () => "saved",
  );
  await restarted.init();
  assert.equal(restarted.view("work").turn?.state, "failed");
  assert.equal(JSON.stringify(restarted.read("work", id)).includes("TEST_PRIVATE_EXTRA"), false);
  await restarted.send("work", id, "Draft", request, {});
  assert.equal(restartedCalls, 0);
  store.cancel("work", id);
  answer.resolve("Late");
  await store.settled();
});
test("memory-only conversations are never written and cannot reappear after restart", async (t) => {
  let contextReads = 0;
  const { store, dir, connect } = await fixture(
    t,
    async () => "Hi",
    async () => {
      contextReads++;
      return "private";
    },
  );
  await connect({ ...settings, retainHistory: false, projectContext: false });
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  await store.send("work", id, "Hello", randomUUID(), {});
  await store.settled();
  assert.equal(contextReads, 0);
  assert.deepEqual(await readdir(dir), ["settings.json"]);
  const restarted = new AgentStore(
    dir,
    async () => "Hi",
    async () => "private",
  );
  await restarted.init();
  assert.equal(restarted.history("work").length, 0);
});
test("disconnect keeps readable local history and explicit delete removes only that conversation", async (t) => {
  const { store, dir, connect } = await fixture(t);
  await connect();
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  await store.send("work", id, "Hello", randomUUID(), {});
  await store.settled();
  await store.disconnect();
  assert.equal(store.history("work").length, 1);
  await assert.rejects(readFile(join(dir, "settings.json")), { code: "ENOENT" });
  await store.deleteConversation("work", id);
  assert.equal(store.history("work").length, 0);
  await assert.rejects(readFile(join(dir, `${id}.json`)), { code: "ENOENT" });
});
test("conversation storage cannot follow a symlink", async (t) => {
  const { root } = await fixture(t);
  const link = join(root, "linked");
  await symlink(join(root, "conversations"), link);
  const store = new AgentStore(
    link,
    async () => "Hi",
    async () => "saved",
  );
  await assert.rejects(store.init(), /unavailable/);
});

test("connection verification cannot bypass a pending message admission", async (t) => {
  const context = deferred<string>(),
    started = deferred<void>(),
    answer = deferred<string>();
  let calls = 0;
  const { store, connect } = await fixture(
    t,
    async () => (++calls === 1 ? "Hi" : answer.promise),
    async () => {
      started.resolve();
      return context.promise;
    },
  );
  await connect();
  const id =
    (await store.newConversation("work")).conversation?.id ??
    assert.fail("Expected a conversation");
  const sending = store.send("work", id, "Draft", randomUUID(), {});
  await started.promise;
  const verifying = store.verify(settings);
  context.resolve("saved");
  await sending;
  await assert.rejects(verifying, /current response/);
  assert.equal(calls, 2);
  answer.resolve("Done");
  await store.settled();
});
