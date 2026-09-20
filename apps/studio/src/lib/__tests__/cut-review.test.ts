import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportStitched } from "@toony/export";
import {
  buildInitialProject,
  ingestImageAsset,
  loadProject,
  writeCuts,
  writeLettering,
  writeProject,
} from "@toony/project-io";
import { layoutCut } from "@toony/render";
import type { LetteringOverlay, ReviewStatus } from "@toony/schema";
import {
  cutReviewCounts,
  isCutReviewPayload,
  overviewEpisodes,
  resolveCutReviewArtwork,
  saveCutReview,
} from "../project.js";

const REVIEW_PAYLOAD = {
  workId: "work",
  episodeId: "ep-001",
  cutId: "cut-001",
  reviewStatus: "final" as const,
  artworkRevision: "0".repeat(64),
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

async function payloadFor(root: string, cutId = "cut-001", reviewStatus: ReviewStatus = "final") {
  const cut = (await loadProject(root)).project.episodes[0]?.cuts.find((c) => c.id === cutId);
  assert.ok(cut);
  const { artworkRevision } = await resolveCutReviewArtwork("work", root, cut);
  return { ...REVIEW_PAYLOAD, cutId, reviewStatus, artworkRevision };
}

test("review payload accepts only the existing states and required string ids", () => {
  for (const reviewStatus of ["draft", "human-edited", "final"]) {
    assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, reviewStatus }), true);
  }
  for (const reviewStatus of [undefined, null, "rejected", 0, {}]) {
    assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, reviewStatus }), false);
  }
  assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, cutId: 12 }), false);
  for (const artworkRevision of [undefined, null, "", "path-only", "g".repeat(64)]) {
    assert.equal(isCutReviewPayload({ ...REVIEW_PAYLOAD, artworkRevision }), false);
  }
});

test("review save patches current cut metadata and never writes lettering or sibling status", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-studio-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const project = buildInitialProject("Review save fixture");
  await writeProject(root, project);

  const pagePayload = await payloadFor(root);

  // Simulate an agent's metadata and lettering writes since the page loaded.
  const current = await loadProject(root);
  const bundle = current.project.episodes[0];
  assert.ok(bundle);
  const cut = bundle.cuts[0];
  assert.ok(cut);
  cut.imagePrompt = "New prompt written after the review page loaded";
  cut.palette = "amber and teal";
  await writeCuts(root, "ep-001", bundle.cuts);
  await writeLettering(root, "ep-001", [BUBBLE_FIXTURE]);
  const lettering = join(root, "episodes/ep-001/lettering.json");
  const beforeLettering = await readFile(lettering);
  const beforeCut = structuredClone(cut);
  assert.deepEqual(await saveCutReview(root, pagePayload), { ok: true });
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
  await saveCutReview(root, await payloadFor(root));
  await saveCutReview(root, await payloadFor(root, "cut-002", "human-edited"));
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
  await saveCutReview(root, await payloadFor(root));
  const reviewed = await exportStitched(root, "ep-001", { width: 320, format: "png" });
  assert.deepEqual(await readFile(join(reviewed.outDir, "episode.png")), pngBefore);
  assert.deepEqual(reviewed.manifest, before.manifest);
});

test("an old page cannot approve new artwork written to the same path", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-stale-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await writeProject(root, buildInitialProject("Same-path review fixture"));
  const target = { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" } as const;
  // Named fixtures: valid, distinct red and blue 8x8 PNG artwork.
  const images = [
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVBiVY9wpI/OfAQ9gwic5fBQAAAOlAgCFl6ZGAAAAAElFTkSuQmCC",
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVBiVY5T1u/GfAQ9gwic5fBQAAFY5AlKmUFKsAAAAAElFTkSuQmCC",
  ];
  const image = (index: number) => ({
    bytes: Buffer.from(images[index] ?? "", "base64"),
    format: "png" as const,
    provenance: { source: "manual" as const, providerId: "manual", contentType: "image/png" },
  });
  await ingestImageAsset(root, target, image(0));
  const oldPage = await payloadFor(root);
  const oldCut = (await loadProject(root)).project.episodes[0]?.cuts[0];
  assert.ok(oldCut);
  const oldView = await resolveCutReviewArtwork("work", root, oldCut);
  await saveCutReview(root, oldPage);
  const replaced = await ingestImageAsset(root, target, image(1));
  assert.equal(replaced.assetPath, oldCut.image?.clean);
  const newPage = await payloadFor(root);
  assert.notEqual(newPage.artworkRevision, oldPage.artworkRevision);
  const newCut = (await loadProject(root)).project.episodes[0]?.cuts[0];
  assert.ok(newCut);
  const newView = await resolveCutReviewArtwork("work", root, newCut);
  assert.notEqual(newView.art.src, oldView.art.src);
  assert.match(oldView.art.src ?? "", /&revision=[a-f0-9]{64}$/);
  assert.deepEqual([newView.art.width, newView.art.height], [8, 8]);

  const cutsPath = join(root, "episodes/ep-001/cuts.yaml");
  const beforeCuts = await readFile(cutsPath);
  const letteringPath = join(root, "episodes/ep-001/lettering.json");
  const beforeLettering = await readFile(letteringPath);
  const rejected = await saveCutReview(root, oldPage);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.conflict, true);
    assert.match(rejected.error, /Artwork changed/);
  }
  assert.deepEqual(await readFile(cutsPath), beforeCuts);
  assert.deepEqual(await readFile(letteringPath), beforeLettering);
  assert.equal((await loadProject(root)).project.episodes[0]?.cuts[0]?.reviewStatus, "draft");
  assert.deepEqual(await saveCutReview(root, newPage), { ok: true });
  assert.equal((await loadProject(root)).project.episodes[0]?.cuts[0]?.reviewStatus, "final");
});

test("review identity distinguishes no artwork and also binds the clean source behind a final image", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-sources-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await writeProject(root, buildInitialProject("Review source fixture"));
  const noArtwork = await payloadFor(root);
  const red = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVBiVY9wpI/OfAQ9gwic5fBQAAAOlAgCFl6ZGAAAAAElFTkSuQmCC",
    "base64",
  );
  const blue = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVBiVY5T1u/GfAQ9gwic5fBQAAFY5AlKmUFKsAAAAAElFTkSuQmCC",
    "base64",
  );
  const result = (bytes: Uint8Array) => ({
    bytes,
    format: "png" as const,
    provenance: { source: "manual" as const, providerId: "manual", contentType: "image/png" },
  });
  const target = { kind: "cut", episodeId: "ep-001", cutId: "cut-001" } as const;
  await ingestImageAsset(root, { ...target, slot: "final" }, result(red));
  assert.equal((await saveCutReview(root, noArtwork)).ok, false);
  const finalOnly = await payloadFor(root);
  await ingestImageAsset(root, { ...target, slot: "clean" }, result(blue));
  assert.equal((await saveCutReview(root, finalOnly)).ok, false);
  const withBoth = await payloadFor(root);
  await saveCutReview(root, withBoth);
  await ingestImageAsset(root, { ...target, slot: "clean" }, result(red));
  assert.equal((await saveCutReview(root, withBoth)).ok, false);
  const loaded = await loadProject(root);
  const cut = loaded.project.episodes[0]?.cuts[0];
  assert.ok(cut);
  const view = await resolveCutReviewArtwork("work", root, cut);
  assert.match(view.art.src ?? "", /assets%2Ffinal%2Fcut-001.png/);
  assert.equal(cut.reviewStatus, "draft");
});
