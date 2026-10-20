// The single write path: one lock per project, undo snapshots, the journal, the
// live event, restore on failure, refusal of new validation errors, and undo
// that refuses to reverse a change newer edits depend on.

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, loadProject, writeProject, writeWebtoon } from "@toony/project-io";
import type { LiveEvent } from "../agent/protocol.js";
import { liveBus } from "../live/bus.js";
import { listManifests, pruneHistory } from "../ops/history.js";
import { contextFor, OpError, undoChange, withProjectWrite } from "../ops/index.js";
import { readJournal } from "../ops/journal.js";

async function project(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-ops-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "harbor");
  await writeProject(root, buildInitialProject("Harbor"));
  return { root, ctx: contextFor(root, { workId: "harbor", clientId: "tab-12345678" }) };
}

async function retitle(root: string, title: string) {
  const loaded = await loadProject(root);
  await writeWebtoon(root, { ...loaded.project.webtoon, title });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("writes to one project run one at a time", async (t) => {
  const { root, ctx } = await project(t);
  const order: string[] = [];
  const plan = {
    summary: "Retitled",
    scopes: [{ kind: "work" as const }],
    files: ["webtoon.json"],
  };
  await Promise.all([
    withProjectWrite(ctx, plan, async () => {
      order.push("first:start");
      await sleep(30);
      await retitle(root, "First");
      order.push("first:end");
    }),
    withProjectWrite(ctx, plan, async (tx) => {
      order.push(`second:start:${tx.before.project.webtoon.title}`);
      await retitle(root, "Second");
      order.push("second:end");
    }),
  ]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start:First", "second:end"]);
});

test("a change is snapshotted, journaled and published; no change records nothing", async (t) => {
  const { root, ctx } = await project(t);
  const events: LiveEvent[] = [];
  const stop = liveBus().subscribe((event) => events.push(event));
  try {
    const { change } = await withProjectWrite(
      ctx,
      { summary: "Renamed", scopes: [{ kind: "work" }], files: ["webtoon.json"] },
      async () => retitle(root, "Lighthouse"),
    );
    assert.ok(change);
    assert.equal(change.actor, "human");
    assert.equal(change.clientId, "tab-12345678");
    const journal = await readJournal(root);
    assert.deepEqual(
      journal.map((entry) => [entry.changeId, entry.summary, entry.files]),
      [[change.changeId, "Renamed", ["webtoon.json"]]],
    );
    const manifests = await listManifests(root);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.entries[0]?.existed, true);
    assert.ok(events.some((e) => e.type === "project" && e.change.changeId === change.changeId));

    const unchanged = await withProjectWrite(
      ctx,
      { summary: "Nothing", scopes: [{ kind: "work" }], files: ["webtoon.json"] },
      async () => retitle(root, "Lighthouse"),
    );
    assert.equal(unchanged.change, null);
    assert.equal((await readJournal(root)).length, 1);
    assert.equal((await listManifests(root)).length, 1);
  } finally {
    stop();
  }
});

test("a failed change is restored and leaves no journal entry", async (t) => {
  const { root, ctx } = await project(t);
  const before = await readFile(join(root, "webtoon.json"), "utf8");
  await assert.rejects(
    withProjectWrite(
      ctx,
      { summary: "Broken", scopes: [{ kind: "work" }], files: ["webtoon.json", "notes.md"] },
      async () => {
        await retitle(root, "Half done");
        await writeFile(join(root, "notes.md"), "new file");
        throw new Error("disk full");
      },
    ),
    (error: unknown) => error instanceof OpError && error.code === "failed",
  );
  assert.equal(await readFile(join(root, "webtoon.json"), "utf8"), before);
  await assert.rejects(readFile(join(root, "notes.md")), "a file that did not exist is removed");
  assert.deepEqual(await readJournal(root), []);
  assert.deepEqual(await listManifests(root), []);
});

test("a change that adds a validation error in its scope is refused and restored", async (t) => {
  const { root, ctx } = await project(t);
  const before = await readFile(join(root, "episodes/ep-001/cuts.yaml"), "utf8");
  await assert.rejects(
    withProjectWrite(
      ctx,
      {
        summary: "Bad",
        scopes: [{ kind: "episode", episodeId: "ep-001" }],
        files: ["episodes/ep-001/cuts.yaml"],
      },
      async () => writeFile(join(root, "episodes/ep-001/cuts.yaml"), "- id: cut-001\n"),
    ),
    (error: unknown) =>
      error instanceof OpError && error.code === "invalid" && /errors/.test(error.message),
  );
  assert.equal(await readFile(join(root, "episodes/ep-001/cuts.yaml"), "utf8"), before);
  assert.equal((await loadProject(root)).validation.valid, true);
});

test("undo restores files and refuses while a newer change depends on them", async (t) => {
  const { root, ctx } = await project(t);
  const original = await readFile(join(root, "webtoon.json"), "utf8");
  const plan = {
    summary: "Retitled",
    scopes: [{ kind: "work" as const }],
    files: ["webtoon.json"],
  };
  const first = (await withProjectWrite(ctx, plan, async () => retitle(root, "One"))).change;
  const second = (await withProjectWrite(ctx, plan, async () => retitle(root, "Two"))).change;
  assert.ok(first && second);

  await assert.rejects(
    undoChange(ctx, first.changeId),
    (error: unknown) =>
      error instanceof OpError &&
      error.code === "stale" &&
      /Newer edits depend/.test(error.message),
  );
  const undoSecond = await undoChange(ctx, second.changeId);
  assert.equal(undoSecond.undoes, second.changeId);
  assert.equal((await loadProject(root)).project.webtoon.title, "One");
  await assert.rejects(undoChange(ctx, second.changeId), /already undone/);

  await undoChange(ctx, first.changeId);
  assert.equal(await readFile(join(root, "webtoon.json"), "utf8"), original);
  const journal = await readJournal(root);
  assert.deepEqual(
    journal.map((entry) => entry.undoes ?? null),
    [null, null, second.changeId, first.changeId],
  );
});

test("undo refuses after an edit outside Studio and for unknown changes", async (t) => {
  const { root, ctx } = await project(t);
  const { change } = await withProjectWrite(
    ctx,
    { summary: "Retitled", scopes: [{ kind: "work" }], files: ["webtoon.json"] },
    async () => retitle(root, "Studio title"),
  );
  assert.ok(change);
  await retitle(root, "Edited by hand");
  await assert.rejects(undoChange(ctx, change.changeId), /changed after this change/);
  await assert.rejects(
    undoChange(ctx, "c0000000000-abcdef"),
    (error: unknown) => error instanceof OpError && error.code === "not-found",
  );
  await assert.rejects(undoChange(ctx, "../../etc"), /can no longer be undone/);
});

test("only the newest snapshots are kept", async (t) => {
  const { root, ctx } = await project(t);
  const plan = {
    summary: "Retitled",
    scopes: [{ kind: "work" as const }],
    files: ["webtoon.json"],
  };
  const ids: string[] = [];
  for (const title of ["A", "B", "C", "D"]) {
    const { change } = await withProjectWrite(ctx, plan, async () => retitle(root, title));
    assert.ok(change);
    ids.push(change.changeId);
  }
  await pruneHistory(root, 2);
  assert.deepEqual((await readdir(join(root, ".toony/history"))).sort(), ids.slice(2).sort());
  await assert.rejects(undoChange(ctx, ids[0] ?? ""), /can no longer be undone/);
});
