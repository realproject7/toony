import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProviderResult } from "@toony/providers";
import { ingestImageAsset } from "../ingest.js";
import { loadProject } from "../reader.js";
import {
  applyArtRevision,
  artRevisionBrief,
  artRevisionContext,
  createArtRevision,
  listArtRevisions,
  readArtRevision,
  stageArtRevision,
} from "../revisions.js";
import { buildInitialProject } from "../scaffold.js";
import { writeCuts, writeProject, writeWebtoon } from "../writer.js";

// Minimal metadata-parser fixtures. Not rendered artwork or quality evidence.
function image(width: number): ProviderResult {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return {
    format: "png",
    provenance: { source: "manual", providerId: "manual", contentType: "image/png" },
    bytes: Uint8Array.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...chunk("IHDR", [...u32(width), ...u32(1), 8, 2, 0, 0, 0]),
      ...chunk("IDAT", [8, 29, 1]),
      ...chunk("IEND", []),
    ]),
  };
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(join(tmpdir(), "toony-revision-test-"));
  const root = join(base, "work");
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeProject(root, buildInitialProject("Revision fixture"));
  await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    image(1),
  );
  const current = await artRevisionContext(root, "ep-001", "cut-001");
  const request = await createArtRevision(root, {
    episodeId: "ep-001",
    cutId: "cut-001",
    contextRevision: current.contextRevision,
    change: "Relax the expression",
    preserve: "Identity, outfit and setting",
  });
  return { root, current, request };
}
test("request snapshots exact source and context without touching active art or lettering", async (t) => {
  const { root, current, request } = await fixture(t);
  assert.deepEqual(await readFile(join(root, request.source.snapshotPath)), current.bytes);
  assert.deepEqual(await readFile(join(root, request.source.assetPath)), current.bytes);
  assert.equal((await listArtRevisions(root, "ep-001", "cut-001"))[0]?.id, request.id);
  assert.match(artRevisionBrief(request), /does not edit source pixels/);
  assert.deepEqual(
    (await loadProject(root)).project.episodes[0]?.lettering,
    current.bundle.lettering,
  );
});
test("staging leaves active art alone; adoption preserves source, siblings and lettering and resets review", async (t) => {
  const { root, current, request } = await fixture(t);
  const before = (await loadProject(root)).project.episodes[0];
  assert.ok(before);
  await writeCuts(
    root,
    "ep-001",
    before.cuts.map((c) => (c.id === "cut-001" ? { ...c, reviewStatus: "final" } : c)),
  );
  const staged = await stageArtRevision(
    root,
    request.id,
    image(2),
    "Expression revised; pose preserved.",
  );
  assert.ok(staged.candidate);
  assert.equal(
    (await loadProject(root)).project.episodes[0]?.cuts[0]?.image?.clean,
    current.source.assetPath,
  );
  await applyArtRevision(root, request.id, staged.candidate.sha256);
  const after = (await loadProject(root)).project.episodes[0];
  assert.ok(after);
  assert.equal(after.cuts[0]?.image?.clean, staged.candidate.assetPath);
  assert.equal(after.cuts[0]?.reviewStatus, "draft");
  assert.deepEqual(after.cuts.slice(1), before.cuts.slice(1));
  assert.deepEqual(after.lettering, before.lettering);
  assert.deepEqual(await readFile(join(root, current.source.assetPath)), current.bytes);
  assert.equal((await readArtRevision(root, request.id)).state, "applied");
});
test("same-path source replacement refuses creation and staging from stale context", async (t) => {
  const { root, current, request } = await fixture(t);
  await writeFile(join(root, current.source.assetPath), image(3).bytes);
  await assert.rejects(
    createArtRevision(root, {
      episodeId: "ep-001",
      cutId: "cut-001",
      contextRevision: current.contextRevision,
      change: "Smile",
      preserve: "Everything else",
    }),
    /changed/,
  );
  await assert.rejects(stageArtRevision(root, request.id, image(2), "Smile"), /stale/);
});
test("changed identity or wardrobe prevents applying an old candidate", async (t) => {
  const { root, request } = await fixture(t);
  const staged = await stageArtRevision(root, request.id, image(2), "Smile");
  assert.ok(staged.candidate);
  const loaded = await loadProject(root);
  await writeWebtoon(root, {
    ...loaded.project.webtoon,
    characters: [
      {
        id: "hero",
        name: "Hero",
        lockstring: "Cropped hair",
        wardrobe: [{ id: "coat", description: "Blue coat" }],
      },
    ],
  });
  await assert.rejects(applyArtRevision(root, request.id, staged.candidate.sha256), /stale/);
});
test("candidate tampering and outdated comparison digests cannot replace art", async (t) => {
  const { root, request } = await fixture(t);
  const staged = await stageArtRevision(root, request.id, image(2), "Smile");
  assert.ok(staged.candidate);
  await assert.rejects(applyArtRevision(root, request.id, "a".repeat(64)), /candidate changed/);
  await writeFile(join(root, staged.candidate.assetPath), image(3).bytes);
  await assert.rejects(
    applyArtRevision(root, request.id, staged.candidate.sha256),
    /candidate image changed/,
  );
});
test("request ids and symlinked source paths cannot escape the work", async (t) => {
  const { root, current } = await fixture(t);
  await assert.rejects(readArtRevision(root, "../outside"), /Invalid revision id/);
  const other = await mkdtemp(join(tmpdir(), "toony-revision-outside-"));
  t.after(() => rm(other, { recursive: true, force: true }));
  await writeFile(join(other, "image.png"), image(2).bytes);
  await rm(join(root, current.source.assetPath));
  await symlink(join(other, "image.png"), join(root, current.source.assetPath));
  await assert.rejects(artRevisionContext(root, "ep-001", "cut-001"), /stay inside/);
});
