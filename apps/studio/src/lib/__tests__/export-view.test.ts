// The export page's options map onto export requests, and its preview plans
// the same layout the engine renders.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInitialProject } from "@toony/project-io";
import {
  choiceForOutput,
  defaultSettings,
  exportRequest,
  type PreviewItem,
  planSummary,
  previewBands,
  previewPlan,
} from "../export-view.js";

function items(): PreviewItem[] {
  const bundle = buildInitialProject("Preview fixture").episodes[0];
  assert.ok(bundle);
  return bundle.episode.sequence.map((item) => {
    if (item.type === "cut") {
      return {
        type: "cut",
        id: item.id,
        art: item.id === "cut-001" ? { width: 600, height: 900, src: "/api/asset?x" } : null,
      };
    }
    const transition = bundle.transitions.find((t) => t.id === item.id);
    assert.ok(transition);
    return { type: "transition", id: item.id, transition };
  });
}

test("each choice maps to an output and only the options it offers", () => {
  const settings = defaultSettings(720);
  assert.deepEqual(exportRequest("strip", settings), { output: "strip", options: { width: 720 } });
  settings.strip.split = true;
  assert.deepEqual(exportRequest("strip", settings), {
    output: "strip",
    options: { width: 720, sliceHeight: 1280 },
  });
  assert.deepEqual(exportRequest("cuts", settings), {
    output: "cuts",
    options: { width: 1200, margin: 0, textCards: false },
  });
  settings.instagram = { shape: "square", tallCuts: "fit" };
  assert.deepEqual(exportRequest("instagram", settings), {
    output: "instagram-square",
    options: { tallCuts: "fit" },
  });
  assert.deepEqual(exportRequest("x", settings), { output: "x", options: { tallCuts: "split" } });
  assert.deepEqual(exportRequest("webtoon", settings), { output: "webtoon", options: {} });
  assert.equal(choiceForOutput("instagram-square"), "instagram");
  assert.equal(choiceForOutput("webtoon"), "webtoon");
  assert.equal(choiceForOutput("gif"), null);
});

test("the preview plans files with the engine's layout and the output's pinned options", () => {
  const bands = previewBands(items(), 800);
  assert.deepEqual(
    bands.map((band) => [band.type, band.id, band.role, band.hasArt ?? null]),
    [
      ["cut", "cut-001", "cut", true],
      ["transition", "tr-001", "spacer", null],
      ["cut", "cut-002", "cut", false],
    ],
  );
  // Art keeps its own shape: 600 x 900 art is 1200 rows at 800 px.
  assert.equal(bands[0]?.heightAt(800), 1200);
  const webtoon = previewPlan(bands, { output: "webtoon", options: {} }, 800);
  assert.ok(webtoon.files.every((file) => file.width === 800 && file.height <= 1280));
  assert.equal(
    webtoon.files.reduce((sum, file) => sum + file.height, 0),
    1200 + 48 + 1120,
  );
  const x = previewPlan(bands, { output: "x", options: { tallCuts: "split" } }, 800);
  assert.ok(x.files.every((file) => file.width === 1600 && file.height === 900));
  assert.match(planSummary(x), /^1600 × 900 · \d+ images/);
  assert.deepEqual(
    x.warnings.map((w) => w.code),
    ["artless-cuts", "social.split", "social.posts"],
  );
  assert.equal(planSummary({ files: [], warnings: [] }), "Nothing to export yet.");
  assert.equal(planSummary(webtoon), `800 px wide · ${webtoon.files.length} images`);
});
