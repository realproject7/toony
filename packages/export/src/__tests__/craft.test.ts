// Craft measurement (#196).
//
// The load-bearing test here is discrimination. A metric that cannot separate two
// deliberately different episodes is a BROKEN measurement, not a weak signal —
// that is the lesson from the reference analyzer, whose first version sampled
// whole rows and reported every genre as the same near-white because the flat
// page margin dominated. So every metric is asserted to separate the restless
// fixture from the calm one, in the direction the craft implies.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { buildInitialProject, writeProject } from "@toony/project-io";
import { CALM, RESTLESS, writeRhythmProject } from "../__fixtures__/craft.js";
import {
  asCraftBand,
  CRAFT_METRIC_NAMES,
  type CraftBand,
  type CraftMeasurement,
  compareToCraftBand,
  measureEpisodeCraft,
  validateCraftBandValue,
} from "../craft.js";

const WIDTH = 600;

let workdir: string;
let restless: CraftMeasurement;
let calm: CraftMeasurement;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-craft-"));
  const restlessRoot = join(workdir, "restless");
  const calmRoot = join(workdir, "calm");
  await writeRhythmProject(restlessRoot, RESTLESS);
  await writeRhythmProject(calmRoot, CALM);
  restless = await measureEpisodeCraft(restlessRoot, "ep-001", { width: WIDTH });
  calm = await measureEpisodeCraft(calmRoot, "ep-001", { width: WIDTH });
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("every metric separates two deliberately different episodes", () => {
  const r = restless.metrics;
  const c = calm.metrics;

  // Wide gutters between short cuts spend far more of the page on empty space.
  assert.ok(r.gutterRatio > c.gutterRatio * 2, `gutterRatio ${r.gutterRatio} vs ${c.gutterRatio}`);
  assert.ok(
    r.gutterMedian > c.gutterMedian * 2,
    `gutterMedian ${r.gutterMedian} vs ${c.gutterMedian}`,
  );
  // Short cuts vs tall ones, and varied heights vs identical ones.
  assert.ok(
    r.panelHeightMedian < c.panelHeightMedian / 2,
    `panelHeightMedian ${r.panelHeightMedian} vs ${c.panelHeightMedian}`,
  );
  assert.ok(
    r.panelHeightSpread > c.panelHeightSpread,
    `panelHeightSpread ${r.panelHeightSpread} vs ${c.panelHeightSpread}`,
  );
  // Cut density: how fast the eye moves.
  assert.ok(
    r.panelsPerScreen > c.panelsPerScreen * 2,
    `panelsPerScreen ${r.panelsPerScreen} vs ${c.panelsPerScreen}`,
  );
  // The restless art floats an element in the empty space below each cut; the
  // calm art has no empty space at all.
  assert.ok(r.gutterIntrusionsPerScreen > 0, "restless has elements floating in empty space");
  assert.equal(c.gutterIntrusionsPerScreen, 0);
  // Inset art in a white column vs full-bleed art.
  assert.ok(r.panelInset > 0.3, `panelInset ${r.panelInset}`);
  assert.ok(r.panelInset > c.panelInset * 3, `panelInset ${r.panelInset} vs ${c.panelInset}`);
  // Palette: dark, high-contrast, saturated blue vs light, flat, pale green.
  assert.ok(r.valueMean < c.valueMean / 2, `valueMean ${r.valueMean} vs ${c.valueMean}`);
  assert.ok(r.valueSpread > c.valueSpread * 2, `valueSpread ${r.valueSpread} vs ${c.valueSpread}`);
  assert.ok(
    r.saturationMean > c.saturationMean * 2,
    `saturationMean ${r.saturationMean} vs ${c.saturationMean}`,
  );
  assert.ok(r.hueBias !== null && c.hueBias !== null);
  assert.ok(
    Math.abs((r.hueBias as number) - (c.hueBias as number)) > 60,
    `hueBias ${r.hueBias} vs ${c.hueBias}`,
  );
});

test("the reported metric set is exactly the graded metric set", () => {
  assert.deepEqual(Object.keys(restless.metrics), [...CRAFT_METRIC_NAMES]);
});

test("the same episode measured twice is identical", async () => {
  const again = await measureEpisodeCraft(join(workdir, "restless"), "ep-001", { width: WIDTH });
  assert.deepEqual(again, restless);
  assert.equal(JSON.stringify(again), JSON.stringify(restless));
});

test("run lengths are a share of WIDTH, so the aspect cannot move them", async () => {
  const half = await measureEpisodeCraft(join(workdir, "restless"), "ep-001", {
    width: WIDTH,
    screenAspect: 1,
  });
  assert.equal(half.screenHeight, restless.screenHeight / 2);

  // Panel and gutter heights are multiples of column width, which is the
  // invariant of a vertical-scroll page. This test previously asserted the
  // opposite — that halving the screen doubles them — which pinned a real
  // defect: the same page reported panelHeightMedian 0.28 at aspect 2 and 0.14
  // at aspect 4, so neither figure could be compared to a reference band, and a
  // style pack graded against one was being graded against a moving unit.
  assert.equal(half.metrics.panelHeightMedian, restless.metrics.panelHeightMedian);
  assert.equal(half.metrics.gutterMedian, restless.metrics.gutterMedian);
  assert.ok(Math.abs(half.metrics.gutterRatio - restless.metrics.gutterRatio) < 0.02);

  // Only the per-screen COUNTS may depend on the screen definition: a shorter
  // screen genuinely holds fewer panels.
  assert.ok(half.metrics.panelsPerScreen < restless.metrics.panelsPerScreen * 0.6);
});

test("an episode with no art measures, and says how much art is missing", async () => {
  const root = join(workdir, "artless");
  await writeProject(root, buildInitialProject("Artless"));
  const measured = await measureEpisodeCraft(root, "ep-001", { width: WIDTH });
  assert.equal(measured.cuts, 2);
  assert.equal(measured.cutsWithoutImage, 2);
  // A cut with no image composes a flat neutral fill, which honestly reads as
  // empty space — the number to be reported, not hidden.
  assert.ok(measured.metrics.gutterRatio > 0.9);
});

test("measuring a missing episode fails rather than reporting zeros", async () => {
  await assert.rejects(() => measureEpisodeCraft(join(workdir, "restless"), "ep-404"), /ep-404/);
});

test("a valid band is accepted and narrowed", () => {
  const value = {
    bandFormat: 1,
    name: "restless",
    screenAspect: 2,
    metrics: { gutterRatio: { min: 0.2, max: 0.6 }, valueMean: { max: 120 } },
  };
  assert.deepEqual(validateCraftBandValue(value).issues, []);
  const band = asCraftBand(value);
  assert.equal(band.name, "restless");
  assert.equal(band.screenAspect, 2);
  assert.deepEqual(band.metrics.valueMean, { max: 120 });
});

test("a band file is rejected for every way it can be wrong", () => {
  const codes = (value: unknown): string[] =>
    validateCraftBandValue(value).issues.map((issue) => issue.code);

  assert.deepEqual(codes("nope"), ["band.type"]);
  assert.ok(codes({ metrics: { gutterRatio: { min: 1 } } }).includes("band.format-version"));
  assert.ok(
    codes({ bandFormat: 1, script: "x", metrics: { gutterRatio: { min: 1 } } }).includes(
      "band.unexpected-field",
    ),
  );
  assert.ok(codes({ bandFormat: 1, metrics: {} }).includes("band.metrics.empty"));
  assert.ok(
    codes({ bandFormat: 1, metrics: { bubbleDensity: { min: 1 } } }).includes(
      "band.metric.unknown",
    ),
  );
  assert.ok(codes({ bandFormat: 1, metrics: { gutterRatio: {} } }).includes("band.range.empty"));
  assert.ok(
    codes({ bandFormat: 1, metrics: { gutterRatio: { min: 0.9, max: 0.1 } } }).includes(
      "band.range.order",
    ),
  );
  assert.ok(
    codes({ bandFormat: 1, metrics: { gutterRatio: { min: "wide" } } }).includes("band.range.min"),
  );
  assert.ok(
    codes({ bandFormat: 1, screenAspect: 0, metrics: { gutterRatio: { min: 1 } } }).includes(
      "band.screen-aspect",
    ),
  );
});

test("a band grades only the metrics it declares, and one miss fails the verdict", () => {
  const band: CraftBand = {
    bandFormat: 1,
    name: "calm",
    metrics: {
      gutterRatio: { min: 0, max: 0.1 },
      panelHeightMedian: { min: 0.5 },
      valueMean: { min: 150, max: 255 },
    },
  };
  const good = compareToCraftBand(calm.metrics, band);
  assert.equal(good.inBand, true);
  assert.equal(good.name, "calm");
  assert.deepEqual(
    good.metrics.map((verdict) => verdict.metric),
    ["gutterRatio", "panelHeightMedian", "valueMean"],
  );

  const bad = compareToCraftBand(restless.metrics, band);
  assert.equal(bad.inBand, false);
  assert.ok(bad.metrics.every((verdict) => !verdict.inBand));

  // One metric out of band is enough to fail, and the rest still report.
  const nearly = compareToCraftBand({ ...calm.metrics, valueMean: 10 }, band);
  assert.equal(nearly.inBand, false);
  assert.deepEqual(
    nearly.metrics.filter((verdict) => !verdict.inBand).map((verdict) => verdict.metric),
    ["valueMean"],
  );
});

test("an unmeasurable metric fails its range instead of passing by absence", () => {
  const band: CraftBand = { bandFormat: 1, metrics: { hueBias: { min: 0, max: 360 } } };
  const report = compareToCraftBand({ ...calm.metrics, hueBias: null }, band);
  assert.equal(report.inBand, false);
  assert.equal(report.metrics[0]?.value, null);
});
