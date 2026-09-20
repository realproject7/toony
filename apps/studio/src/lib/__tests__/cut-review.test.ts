import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportStitched } from "@toony/export";
import {
  buildInitialProject,
  loadProject,
  writeCuts,
  writeLettering,
  writeProject,
} from "@toony/project-io";
import { layoutCut } from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";
import { cutReviewCounts, isCutReviewPayload, saveCutReview } from "../cut-review.js";
import { overviewEpisodes } from "../project.js";

const REVIEW_PAYLOAD = {
  workId: "work",
  episodeId: "ep-001",
  cutId: "cut-001",
  reviewStatus: "final" as const,
};
const BUBBLE_FIXTURE: LetteringOverlay = {
  id: "bubble-fixture",
  cutId: "cut-001",
  speaker: "Mira",
  kind: "speech",
  text: "A fresh start.",
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  geometry: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 },
  overflow: false,
  reviewStatus: "final",
};

test("review payload accepts only the existing states and required string ids", () => {
  for (const reviewStatus of ["draft", "human-edited", "final"]) {
    assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, reviewStatus }), true);
  }
  for (const reviewStatus of [undefined, null, "rejected", 0, {}]) {
    assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, reviewStatus }), false);
  }
  assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, cutId: 12 }), false);
});

test("review save patches current cut metadata and never writes lettering or sibling status", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-studio-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Review save fixture");
  await writeProject(root, project);

  // Simulate an agent's metadata and lettering writes since the page loaded.
  const current = await loadProject(root);
  const bundle = current.project.episodes[0];
  assert.ok(bundle);
  const cut = bundle.cuts[0];
  assert.ok(cut);
  cut.imagePrompt = "New prompt written after the review page loaded";
  cut.palette = "amber and teal";
  cut.image = { clean: "episodes/ep-001/assets/clean/new.png", final: null };
  await writeCuts(root, "ep-001", bundle.cuts);
  await writeLettering(root, "ep-001", [BUBBLE_FIXTURE]);
  const lettering = join(root, "episodes/ep-001/lettering.json");
  const beforeLettering = await readFile(lettering);
  const beforeCut = structuredClone(cut);
  assert.deepEqual(await saveCutReview(root, REVIEW_PAYLOAD), { ok: true });
  const reloaded = (await loadProject(root)).project.episodes[0];
  assert.deepEqual(reloaded?.cuts[0], { ...beforeCut, reviewStatus: "final" });
  assert.deepEqual(reloaded?.cuts[1], project.episodes[0]?.cuts[1]);
  assert.deepEqual(await readFile(lettering), beforeLettering);

  const cutsPath = join(root, "episodes/ep-001/cuts.yaml");
  const beforeCuts = await readFile(cutsPath);
  assert.equal(
    (await saveCutReview(root, { ...REVIEW_PAYLOAD, episodeId: "../outside" })).ok,
    false,
  );
  assert.equal((await saveCutReview(root, { ...REVIEW_PAYLOAD, cutId: "missing" })).ok, false);
  assert.deepEqual(await readFile(cutsPath), beforeCuts);
});

test("progress counts cut states even when every bubble is final", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-progress-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Cut progress fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.lettering = [BUBBLE_FIXTURE];
  await writeProject(root, project);
  assert.deepEqual(cutReviewCounts(bundle.cuts), { draft: 2, "human-edited": 0, final: 0 });
  assert.equal(overviewEpisodes(await loadProject(root))[0]?.finalCutCount, 0);
  await saveCutReview(root, REVIEW_PAYLOAD);
  await saveCutReview(root, { ...REVIEW_PAYLOAD, cutId: "cut-002", reviewStatus: "human-edited" });
  const loaded = await loadProject(root);
  assert.deepEqual(cutReviewCounts(loaded.project.episodes[0]?.cuts ?? []), {
    draft: 0,
    "human-edited": 1,
    final: 1,
  });
  assert.equal(overviewEpisodes(loaded)[0]?.finalCutCount, 1);
});

test("legacy no-field projects keep load, render, and actual PNG export bytes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-compat-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Legacy review fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.lettering = [BUBBLE_FIXTURE];
  await writeProject(root, project);
  const cutsPath = join(root, "episodes/ep-001/cuts.yaml");
  const cutsBefore = await readFile(cutsPath);
  const before = await exportStitched(root, "ep-001", { width: 320, format: "png" });
  const pngBefore = await readFile(join(before.outDir, "episode.png"));
  const plansBefore = layoutCut(bundle.lettering, 320, 400);

  const loaded = await loadProject(root);
  const loadedBundle = loaded.project.episodes[0];
  assert.ok(loadedBundle);
  assert.deepEqual(loaded.project, project);
  assert.ok(loadedBundle.cuts.every((cut) => !Object.hasOwn(cut, "reviewStatus")));
  await writeCuts(root, "ep-001", loadedBundle.cuts);
  assert.deepEqual(await readFile(cutsPath), cutsBefore);
  assert.deepEqual(layoutCut(loadedBundle.lettering, 320, 400), plansBefore);
  const after = await exportStitched(root, "ep-001", { width: 320, format: "png" });
  assert.deepEqual(await readFile(join(after.outDir, "episode.png")), pngBefore);
  assert.deepEqual(after.manifest, before.manifest);

  // The review metadata itself must also be invisible to render/export.
  await saveCutReview(root, REVIEW_PAYLOAD);
  const reviewed = await exportStitched(root, "ep-001", { width: 320, format: "png" });
  assert.deepEqual(await readFile(join(reviewed.outDir, "episode.png")), pngBefore);
  assert.deepEqual(reviewed.manifest, before.manifest);
});
