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
import { buildInitialProject, writeProject, writeWebtoon } from "@toony/project-io";
import { STANDARD_CANVAS_WIDTH_PX } from "@toony/schema";
import { CALM, RESTLESS, writeRhythmProject } from "../__fixtures__/craft.js";
import {
  asCraftBand,
  CRAFT_METRIC_NAMES,
  type CraftBand,
  type CraftMeasurement,
  type CraftMetricName,
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

/** The only two metrics allowed to read the screen definition. */
const SCREEN_DEPENDENT: readonly CraftMetricName[] = [
  "panelsPerScreen",
  "gutterIntrusionsPerScreen",
];

/** The run set behind a per-screen count, recovered from the reported figure. */
function runCount(measured: CraftMeasurement, name: CraftMetricName): number {
  return Math.round(((measured.metrics[name] as number) * measured.height) / measured.screenHeight);
}

test("only the two per-screen counts move with the aspect, and they move linearly", async () => {
  const sweep: CraftMeasurement[] = [];
  for (const screenAspect of [1, 2, 4, 8]) {
    sweep.push(
      await measureEpisodeCraft(join(workdir, "restless"), "ep-001", {
        width: WIDTH,
        screenAspect,
      }),
    );
  }
  const first = sweep[0] as CraftMeasurement;

  // Every metric not on the list above is asserted, so a metric added later is
  // invariant unless someone deliberately says otherwise.
  //
  // Two rounds of this defect were caught by measuring the same page twice.
  // #205 divided run lengths by the screen height, so panelHeightMedian read
  // 0.28 at aspect 2 and 0.14 at aspect 4. #214 found the run-detection floors
  // still keyed to the screen: they decide which runs exist, so all nine of
  // these moved anyway, and on examples/dead-air gutterRatio ran 0.1660, 0.1603,
  // 0.1461 and gutterMedian jumped 17% between aspect 2 and aspect 8.
  const invariant = (measured: CraftMeasurement) =>
    CRAFT_METRIC_NAMES.filter((name) => !SCREEN_DEPENDENT.includes(name)).map(
      (name) => [name, measured.metrics[name]] as const,
    );
  for (const measured of sweep) {
    assert.deepEqual(invariant(measured), invariant(first), `aspect ${measured.screenAspect}`);
  }

  // A per-screen count is one run set over a different divisor, so the run set
  // must not move either. Recovered from the same page before #214, the
  // intrusion count read 8, then 5, then 4 as the aspect doubled.
  for (const measured of sweep) {
    for (const name of SCREEN_DEPENDENT) {
      assert.equal(
        runCount(measured, name),
        runCount(first, name),
        `${name} at aspect ${measured.screenAspect}`,
      );
    }
  }

  // Doubling the screen doubles the count. Reported figures carry two decimals,
  // which is the whole of the slack allowed here.
  for (let i = 1; i < sweep.length; i++) {
    const lower = sweep[i - 1] as CraftMeasurement;
    const upper = sweep[i] as CraftMeasurement;
    assert.equal(upper.screenHeight, lower.screenHeight * 2);
    for (const name of SCREEN_DEPENDENT) {
      const expected = (lower.metrics[name] as number) * 2;
      const actual = upper.metrics[name] as number;
      assert.ok(
        Math.abs(actual - expected) <= 0.015,
        `${name} ${lower.metrics[name]} at aspect ${lower.screenAspect} vs ${actual} at ${upper.screenAspect}`,
      );
    }
  }
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

// --- Page rhythm is a property of the work, not of the export width (#217) ---
//
// Measured on the real rasters, because that is the only thing that settles it:
// a conversion function checked against its own formula would have passed while
// the exported page still changed shape.

test("the same episode measures the same at every export width", async () => {
  const root = join(workdir, "restless");
  const widths = [400, 600, 900, 1200, 1600];
  const measured: CraftMeasurement[] = [];
  for (const width of widths) {
    measured.push(await measureEpisodeCraft(root, "ep-001", { width }));
  }
  const first = measured[0] as CraftMeasurement;

  // The metric must be worth holding fixed: a measurement that reported no
  // gutters at all would satisfy every equality below.
  assert.ok(first.metrics.gutterMedian > 0.3, `gutterMedian ${first.metrics.gutterMedian}`);
  assert.ok(first.metrics.panelsPerScreen > 2, `panelsPerScreen ${first.metrics.panelsPerScreen}`);

  // Band heights land on whole pixels, so a share can move by a fraction of a
  // pixel per band. Nothing here is near that: before this was fixed the same
  // four-fold width range moved gutterMedian 0.625 → 0.249 and panelsPerScreen
  // 2.04 → 3.31.
  for (const [i, m] of measured.entries()) {
    const at = `width ${widths[i]}`;
    assert.ok(
      Math.abs(m.metrics.gutterMedian - first.metrics.gutterMedian) < 0.002,
      `${at}: gutterMedian ${m.metrics.gutterMedian} vs ${first.metrics.gutterMedian}`,
    );
    assert.ok(
      Math.abs(m.metrics.gutterRatio - first.metrics.gutterRatio) < 0.002,
      `${at}: gutterRatio ${m.metrics.gutterRatio} vs ${first.metrics.gutterRatio}`,
    );
    assert.equal(
      m.metrics.panelsPerScreen,
      first.metrics.panelsPerScreen,
      `${at}: panelsPerScreen`,
    );
    // The page itself is the same shape, independently of how any row is
    // classified: its height is the same multiple of its width.
    assert.ok(
      Math.abs(m.height / m.width - first.height / first.width) < 0.01,
      `${at}: page ${m.height}/${m.width} vs ${first.height}/${first.width}`,
    );
  }
});

test("the declared reference column is what the export scales from", async () => {
  const root = join(workdir, "restless-wide-column");
  const project = await writeRhythmProject(root, RESTLESS);
  // 600 renders both reference columns to whole pixels, so the expected page
  // heights are exact and no rounding has to be argued about.
  const width = 600;
  const bands = RESTLESS.cutHeights.length - 1;
  const authored = await measureEpisodeCraft(root, "ep-001", { width });

  const wider = STANDARD_CANVAS_WIDTH_PX * 2;
  await writeWebtoon(root, { ...project.webtoon, referenceWidth: wider });
  const onWiderColumn = await measureEpisodeCraft(root, "ep-001", { width });

  // The same authored number on a column twice as wide is half the reading
  // pause, so the page loses half of every band. The art is untouched.
  const drawn = (reference: number) => (RESTLESS.gutterHeight * width) / reference;
  assert.equal(
    authored.height - onWiderColumn.height,
    bands * (drawn(STANDARD_CANVAS_WIDTH_PX) - drawn(wider)),
  );
  assert.ok(
    onWiderColumn.metrics.gutterRatio < authored.metrics.gutterRatio,
    `gutterRatio ${onWiderColumn.metrics.gutterRatio} vs ${authored.metrics.gutterRatio}`,
  );
});
