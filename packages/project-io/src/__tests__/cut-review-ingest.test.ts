import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProviderResult } from "@toony/providers";
import { ingestImageAsset } from "../ingest.js";
import { loadProject } from "../reader.js";
import { buildInitialProject } from "../scaffold.js";
import { writeProject } from "../writer.js";

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
