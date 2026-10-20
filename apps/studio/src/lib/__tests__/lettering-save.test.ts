import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, loadProject, stagingPathFor, writeProject } from "@toony/project-io";
import type { LetteringOverlay } from "@toony/schema";
import {
  cutLetteringRevision,
  isCutLetteringPayload,
  saveCutLettering,
} from "../lettering-save.js";

const overlay = (cutId: string, text: string): LetteringOverlay => ({
  id: `bubble-${cutId}`,
  cutId,
  speaker: "Speaker",
  kind: "speech",
  text,
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  geometry: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
  overflow: false,
  reviewStatus: "human-edited",
});

const payload = (cutId: string, overlays: LetteringOverlay[]) => ({
  workId: "fixture",
  episodeId: "ep-001",
  cutId,
  overlays,
});

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-lettering-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Cut lettering save fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.lettering = [overlay("cut-001", "First original"), overlay("cut-002", "Second original")];
  await writeProject(root, project);
  return {
    root,
    path: join(root, "episodes/ep-001/lettering.json"),
    read: async () => (await loadProject(root)).project.episodes[0]?.lettering,
  };
}

test("lettering payload requires an explicit cut even when deleting its last bubble", () => {
  assert.equal(isCutLetteringPayload(payload("cut-001", [])), true);
  for (const cutId of [undefined, null, "", 1]) {
    assert.equal(isCutLetteringPayload({ ...payload("cut-001", []), cutId }), false);
  }
  assert.equal(
    isCutLetteringPayload({ workId: "fixture", episodeId: "ep-001", overlays: [] }),
    false,
  );
  assert.equal(isCutLetteringPayload({ ...payload("cut-001", []), overlays: null }), false);
  for (const baseRevision of [null, 0, "", "bad", "x".repeat(64)])
    assert.equal(isCutLetteringPayload({ ...payload("cut-001", []), baseRevision }), false);
});

test("a stale cut revision cannot overwrite saved content and its current revision can retry", async (t) => {
  const f = await fixture(t),
    before = (await f.read()) ?? [],
    baseRevision = cutLetteringRevision(before.filter((b) => b.cutId === "cut-001"));
  const first = await saveCutLettering(f.root, {
    ...payload("cut-001", [overlay("cut-001", "Saved first")]),
    baseRevision,
  });
  assert.equal(first.ok, true);
  assert.ok(first.ok && first.revision);
  const bytes = await readFile(f.path);
  const stale = await saveCutLettering(f.root, {
    ...payload("cut-001", [overlay("cut-001", "Stale overwrite")]),
    baseRevision,
  });
  assert.ok(!stale.ok && stale.conflict);
  assert.deepEqual(await readFile(f.path), bytes);
  assert.ok(first.ok);
  assert.equal(
    (await saveCutLettering(f.root, { ...payload("cut-001", []), baseRevision: first.revision }))
      .ok,
    true,
  );
  assert.equal(
    (await f.read())?.some((b) => b.cutId === "cut-002"),
    true,
  );
});

test("simultaneous same-cut editors serialize to one success and one conflict", async (t) => {
  const f = await fixture(t),
    baseRevision = cutLetteringRevision(
      ((await f.read()) ?? []).filter((b) => b.cutId === "cut-001"),
    );
  const results = await Promise.all(
    ["First tab", "Second tab"].map((text) =>
      saveCutLettering(f.root, { ...payload("cut-001", [overlay("cut-001", text)]), baseRevision }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok && r.conflict).length, 1);
  const other = await saveCutLettering(f.root, {
    ...payload("cut-002", [overlay("cut-002", "Independent sibling")]),
    baseRevision: cutLetteringRevision([overlay("cut-002", "Second original")]),
  });
  assert.equal(other.ok, true);
});

test("cut revisions ignore object key insertion order and reflect literal text or style changes", () => {
  const a = overlay("cut-001", "안녕"),
    reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as LetteringOverlay;
  assert.equal(cutLetteringRevision([a]), cutLetteringRevision([reordered]));
  assert.notEqual(cutLetteringRevision([a]), cutLetteringRevision([{ ...a, text: "안녕하세요" }]));
  assert.notEqual(cutLetteringRevision([a]), cutLetteringRevision([{ ...a, fontSize: 30 }]));
});

test("sequential cut saves and empty deletion preserve sibling lettering and project files", async (t) => {
  const f = await fixture(t);
  const cutsPath = join(f.root, "episodes/ep-001/cuts.yaml");
  const cutsBefore = await readFile(cutsPath);
  const first = overlay("cut-001", "First edited");
  const second = overlay("cut-002", "두 번째\n대사");
  assert.deepEqual(await saveCutLettering(f.root, payload("cut-001", [first])), {
    ok: true,
    count: 1,
  });
  assert.deepEqual(await saveCutLettering(f.root, payload("cut-002", [second])), {
    ok: true,
    count: 1,
  });
  assert.deepEqual(await f.read(), [first, second]);
  assert.deepEqual(await saveCutLettering(f.root, payload("cut-002", [])), { ok: true, count: 0 });
  assert.deepEqual(await f.read(), [first]);
  assert.deepEqual(await readFile(cutsPath), cutsBefore);
});

test("unknown cuts, cross-cut records and invalid merged IDs never change the saved file", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.path);
  const invalid = [
    payload("missing", []),
    { ...payload("cut-001", []), episodeId: "../outside" },
    payload("cut-001", [overlay("cut-002", "Wrong cut")]),
    payload("cut-001", [null as unknown as LetteringOverlay]),
    payload("cut-001", [{ ...overlay("cut-001", "Conflict"), id: "bubble-cut-002" }]),
    payload("cut-001", [
      { ...overlay("cut-001", "Bad geometry"), geometry: { x: 2, y: 0, width: 1, height: 1 } },
    ]),
  ];
  for (const value of invalid) {
    assert.equal((await saveCutLettering(f.root, value)).ok, false);
    assert.deepEqual(await readFile(f.path), before);
  }
});

test("concurrent saves read the latest episode inside the queue and retain both edits", async (t) => {
  const f = await fixture(t);
  const first = overlay("cut-001", "Concurrent first");
  const second = overlay("cut-002", "Concurrent second");
  const results = await Promise.all([
    saveCutLettering(f.root, payload("cut-001", [first])),
    saveCutLettering(join(f.root, "."), payload("cut-002", [second])),
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.deepEqual(
    new Map((await f.read())?.map((b) => [b.cutId, b])),
    new Map([
      [first.cutId, first],
      [second.cutId, second],
    ]),
  );
});

test("an actual disk write failure releases the queue for a later valid save", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.path);
  await mkdir(stagingPathFor(f.path));
  const request = payload("cut-001", [overlay("cut-001", "Retry after disk failure")]);
  await assert.rejects(saveCutLettering(f.root, request));
  assert.deepEqual(await readFile(f.path), before);
  await rm(stagingPathFor(f.path), { recursive: true });
  assert.equal((await saveCutLettering(f.root, request)).ok, true);
  assert.equal((await f.read())?.length, 2);
});
