import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, loadProject, writeProject } from "@toony/project-io";
import type { Transition } from "@toony/schema";
import {
  isTransitionSavePayload,
  saveTransitions,
  transitionRevision,
} from "../transition-save.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-transition-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Transition save fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const sibling = structuredClone(bundle);
  sibling.episode.id = "ep-002";
  project.episodes.push(sibling);
  await writeProject(root, project);
  const request = {
    workId: "fixture",
    episodeId: bundle.episode.id,
    sequence: bundle.episode.sequence,
    transitions: bundle.transitions,
    baseRevision: transitionRevision(bundle.episode.sequence, bundle.transitions),
  };
  const files = [
    "webtoon.json",
    "episodes/ep-001/cuts.yaml",
    "episodes/ep-001/lettering.json",
    "episodes/ep-002/episode.yaml",
    "episodes/ep-002/transitions.yaml",
  ];
  return { root, request, unchanged: () => Promise.all(files.map((f) => readFile(join(root, f)))) };
}

test("transition save requires a valid base revision and revisions ignore object key order", async (t) => {
  const { request } = await fixture(t);
  assert.equal(isTransitionSavePayload(request), true);
  for (const baseRevision of [undefined, null, "", "bad", "x".repeat(64)])
    assert.equal(isTransitionSavePayload({ ...request, baseRevision }), false);
  const reordered = request.transitions.map(
    (value) => Object.fromEntries(Object.entries(value).reverse()) as unknown as Transition,
  );
  assert.equal(transitionRevision(request.sequence, reordered), request.baseRevision);
});

test("simultaneous transition saves admit one revision and reject stale retries without changing files", async (t) => {
  const f = await fixture(t);
  const untouched = await f.unchanged();
  const results = await Promise.all(
    [120, 250].map((gutterHeight) =>
      saveTransitions(f.root, {
        ...f.request,
        transitions: f.request.transitions.map((tr) => ({ ...tr, gutterHeight })),
      }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok && r.conflict).length, 1);
  const saved = await loadProject(f.root);
  const stale = await saveTransitions(f.root, f.request);
  assert.ok(!stale.ok && stale.conflict);
  assert.deepEqual((await loadProject(f.root)).project, saved.project);
  assert.deepEqual(await f.unchanged(), untouched);
});

test("mixed transition replacement preserves cuts, lettering and other episodes", async (t) => {
  const f = await fixture(t);
  const untouched = await f.unchanged();
  const first = f.request.transitions[0];
  assert.ok(first);
  const transitions = [{ ...first, id: "new-transition", gutterHeight: 320 }];
  const sequence = f.request.sequence.map((item) =>
    item.type === "transition" ? { ...item, id: "new-transition" } : item,
  );
  const result = await saveTransitions(f.root, { ...f.request, transitions, sequence });
  assert.ok(result.ok);
  const saved = (await loadProject(f.root)).project.episodes[0];
  assert.ok(saved);
  assert.deepEqual(saved.transitions, transitions);
  assert.deepEqual(saved.episode.sequence, sequence);
  assert.equal(result.revision, transitionRevision(sequence, transitions));
  assert.deepEqual(await f.unchanged(), untouched);
});

test("invalid sequence references and malformed transitions are rejected before writing", async (t) => {
  const f = await fixture(t);
  const original = (await loadProject(f.root)).project;
  const first = f.request.transitions[0];
  const firstItem = f.request.sequence[0];
  assert.ok(first && firstItem);
  for (const change of [
    { sequence: [{ type: "cut" as const, id: "missing" }] },
    { transitions: [null as unknown as Transition] },
    { transitions: [{ ...first, gutterHeight: -1 }] },
    { sequence: [...f.request.sequence, firstItem] },
    { episodeId: "../outside" },
  ]) {
    assert.equal((await saveTransitions(f.root, { ...f.request, ...change })).ok, false);
    assert.deepEqual((await loadProject(f.root)).project, original);
  }
});
