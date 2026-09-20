import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProviderResult } from "@toony/providers";
import { ingestImageAsset } from "../ingest.js";
import { loadProject } from "../reader.js";
import { buildInitialProject } from "../scaffold.js";
import { writeCuts, writeProject } from "../writer.js";

// Named fixture: a real 1x1 PNG, accepted by the common metadata stripper.
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
  "base64",
);

for (const source of ["manual", "comfyui"] as const) {
  for (const slot of ["clean", "final"] as const) {
    test(`${source} ingest into ${slot} resets only the replaced cut to draft`, async (t) => {
      const dir = await mkdtemp(join(tmpdir(), "toony-review-ingest-"));
      t.after(() => rm(dir, { recursive: true, force: true }));
      const root = join(dir, "work");
      const project = buildInitialProject("Review ingest fixture");
      const bundle = project.episodes[0];
      assert.ok(bundle);
      for (const cut of bundle.cuts) cut.reviewStatus = "final";
      await writeProject(root, project);
      const letteringFile = join(root, "episodes/ep-001/lettering.json");
      const before = await readFile(letteringFile);
      const result: ProviderResult = {
        bytes: PNG_FIXTURE,
        format: "png",
        provenance: { source, providerId: source, contentType: "image/png" },
      };
      await ingestImageAsset(
        root,
        { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot },
        result,
      );
      const loaded = await loadProject(root);
      assert.equal(loaded.project.episodes[0]?.cuts[0]?.reviewStatus, "draft");
      assert.equal(loaded.project.episodes[0]?.cuts[1]?.reviewStatus, "final");
      assert.deepEqual(await readFile(letteringFile), before);
    });
  }
}

test("a failed import preserves cut review and existing record bytes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-failure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Failed import fixture");
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.reviewStatus = "human-edited";
  await writeProject(root, project);
  const cuts = join(root, "episodes/ep-001/cuts.yaml");
  const before = await readFile(cuts);
  await mkdir(join(root, "episodes/ep-001/assets/clean/cut-001.png"));
  await assert.rejects(
    ingestImageAsset(
      root,
      { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
      {
        bytes: PNG_FIXTURE,
        format: "png",
        provenance: { source: "manual", providerId: "manual", contentType: "image/png" },
      },
    ),
  );
  assert.deepEqual(await readFile(cuts), before);
  assert.equal(
    (await loadProject(root)).project.episodes[0]?.cuts[0]?.reviewStatus,
    "human-edited",
  );
});

for (const reviewStatus of ["final", "human-edited"] as const) {
  test(`an unwritable cuts directory cannot replace ${reviewStatus} artwork`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "toony-review-readonly-"));
    const root = join(dir, "work");
    const episode = join(root, "episodes/ep-001");
    t.after(async () => {
      await chmod(episode, 0o755);
      await rm(dir, { recursive: true, force: true });
    });
    await writeProject(root, buildInitialProject("Read-only cuts fixture"));
    const target = { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" } as const;
    const result = (bytes: Uint8Array): ProviderResult => ({
      bytes,
      format: "png",
      provenance: { source: "manual", providerId: "manual", contentType: "image/png" },
    });
    const first = await ingestImageAsset(root, target, result(PNG_FIXTURE));
    const bundle = (await loadProject(root)).project.episodes[0];
    assert.ok(bundle?.cuts[0]);
    bundle.cuts[0].reviewStatus = reviewStatus;
    await writeCuts(root, "ep-001", bundle.cuts);
    const originalImage = await readFile(join(root, first.assetPath));
    const originalCuts = await readFile(join(episode, "cuts.yaml"));
    // Named fixture: valid blue 8x8 PNG, different from the approved first image.
    const blue = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVBiVY5T1u/GfAQ9gwic5fBQAAFY5AlKmUFKsAAAAAElFTkSuQmCC",
      "base64",
    );
    await chmod(episode, 0o555);
    // Its existing assets/clean directory remains writable, reproducing the
    // ordering defect: image commit used to succeed before cuts commit failed.
    await assert.rejects(ingestImageAsset(root, target, result(blue)));
    assert.deepEqual(await readFile(join(root, first.assetPath)), originalImage);
    assert.deepEqual(await readFile(join(episode, "cuts.yaml")), originalCuts);
    assert.equal(
      (await loadProject(root)).project.episodes[0]?.cuts[0]?.reviewStatus,
      reviewStatus,
    );
  });
}

test("a failed image commit restores the exact approval record over the original artwork", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-rollback-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await writeProject(root, buildInitialProject("Review rollback fixture"));
  const target = { kind: "cut", episodeId: "ep-001", cutId: "cut-001" } as const;
  const result: ProviderResult = {
    bytes: PNG_FIXTURE,
    format: "png",
    provenance: { source: "manual", providerId: "manual", contentType: "image/png" },
  };
  const original = await ingestImageAsset(root, { ...target, slot: "clean" }, result);
  const bundle = (await loadProject(root)).project.episodes[0];
  assert.ok(bundle?.cuts[0]);
  bundle.cuts[0].reviewStatus = "final";
  bundle.cuts[0].imagePrompt = "Preserve the existing reviewed art and prompt.";
  await writeCuts(root, "ep-001", bundle.cuts);
  const cutsPath = join(root, "episodes/ep-001/cuts.yaml");
  const originalCuts = await readFile(cutsPath);
  const originalImage = await readFile(join(root, original.assetPath));
  // Staging succeeds, but the final image rename fails after review was
  // invalidated because the destination is a directory. The clean image stays.
  await mkdir(join(root, "episodes/ep-001/assets/final/cut-001.png"));
  await assert.rejects(ingestImageAsset(root, { ...target, slot: "final" }, result));
  assert.deepEqual(await readFile(cutsPath), originalCuts);
  assert.deepEqual(await readFile(join(root, original.assetPath)), originalImage);
  assert.equal((await loadProject(root)).project.episodes[0]?.cuts[0]?.reviewStatus, "final");
});
