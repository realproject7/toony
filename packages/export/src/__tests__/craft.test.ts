// Craft measurement (#196).
//
// The load-bearing test here is discrimination. A metric that cannot separate two
// deliberately different episodes is a BROKEN measurement, not a weak signal —
// that is the lesson from the reference analyzer, whose first version sampled
// whole rows and reported every genre as the same near-white because the flat
// page margin dominated. So every metric is asserted to separate the restless
// fixture from the calm one, in the direction the craft implies.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
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

/** One measurement with some metrics overridden; everything else kept. */
function withMetrics(
  measured: CraftMeasurement,
  overrides: Partial<CraftMeasurement["metrics"]>,
): CraftMeasurement {
  return { ...measured, metrics: { ...measured.metrics, ...overrides } };
}

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
  const good = compareToCraftBand(calm, band);
  assert.equal(good.inBand, true);
  assert.equal(good.name, "calm");
  assert.deepEqual(
    good.metrics.map((verdict) => verdict.metric),
    ["gutterRatio", "panelHeightMedian", "valueMean"],
  );

  const bad = compareToCraftBand(restless, band);
  assert.equal(bad.inBand, false);
  assert.ok(bad.metrics.every((verdict) => !verdict.inBand));

  // One metric out of band is enough to fail, and the rest still report.
  const nearly = compareToCraftBand(withMetrics(calm, { valueMean: 10 }), band);
  assert.equal(nearly.inBand, false);
  assert.deepEqual(
    nearly.metrics.filter((verdict) => !verdict.inBand).map((verdict) => verdict.metric),
    ["valueMean"],
  );
});

test("an unmeasurable metric fails its range instead of passing by absence", () => {
  const band: CraftBand = { bandFormat: 1, metrics: { hueBias: { min: 0, max: 360 } } };
  const report = compareToCraftBand(withMetrics(calm, { hueBias: null }), band);
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

// --- A band records what it does not grade, and says what it came from (#235) ---
//
// Two claims are load-bearing here and both are asserted against the OTHER
// outcome rather than on their own: a recorded range is shown to be one the page
// genuinely fails, by grading it and watching the verdict flip, so "the verdict
// did not change" cannot pass because the range was satisfiable; and a band of
// the shape shipped today is shown to grade LIVE ranges, by moving one metric
// out of them, so "it grades as it did" cannot pass on a band that grades
// nothing.

/** The nine metrics a shipped band grades, in the order the report lists them. */
const SHIPPED_METRICS: readonly CraftMetricName[] = [
  "gutterRatio",
  "gutterMedian",
  "panelHeightMedian",
  "panelsPerScreen",
  "gutterIntrusionsPerScreen",
  "panelInset",
  "valueMean",
  "saturationMean",
  "hueBias",
];

/**
 * A band of the shape shipped before this change: `bandFormat` 1, a name, an
 * aspect, nine ranges, and no other key. Each range is a 10% window around the
 * measured value, so the band is a real target rather than one wide enough to
 * accept anything.
 */
function shippedBandFor(measured: CraftMeasurement): Record<string, unknown> {
  const metrics: Record<string, { min: number; max: number }> = {};
  for (const name of SHIPPED_METRICS) {
    const value = measured.metrics[name];
    assert.ok(value !== null, `${name} is measurable on this fixture`);
    const slack = Math.abs(value) * 0.1 + 0.001;
    metrics[name] = { min: value - slack, max: value + slack };
  }
  return { bandFormat: 1, name: "thriller cold", screenAspect: 2, metrics };
}

/** One valid studied work, to vary a single field at a time from. */
const WORK = {
  label: "work A",
  episodes: 2,
  captureMode: "contiguous",
  constantColumnWidth: true,
};

/**
 * Provenance every field of which is valid. The two works were captured
 * DIFFERENTLY on purpose: the capture facts belong to a work, and a band that
 * had to state one answer for both would be wrong about one of them.
 */
const PROVENANCE = {
  works: [
    {
      label: "thriller work A",
      episodes: 2,
      captureMode: "contiguous",
      constantColumnWidth: true,
      language: "eng",
      pageLengthInWidths: 118.4,
    },
    {
      label: "thriller work C (KOR)",
      episodes: 2,
      captureMode: "sampled",
      constantColumnWidth: false,
      language: "ko",
    },
  ],
};

/** Validation codes for a minimal valid band plus the fields under test. */
function bandCodes(extra: Record<string, unknown>): string[] {
  const value = { bandFormat: 1, metrics: { gutterRatio: { min: 0, max: 1 } }, ...extra };
  return validateCraftBandValue(value).issues.map((issue) => issue.code);
}

/** Codes for a band whose provenance lists exactly these works. */
function workCodes(entries: unknown[]): string[] {
  return bandCodes({ provenance: { works: entries } });
}

/** The repository root, found from this compiled test file. */
function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repository root not found from the test file");
}

test("a recorded metric is kept and reported, and never changes the verdict", () => {
  // No page can measure a mean luminance of 900 on a 0..255 scale.
  const unreachable = { min: 900, max: 1000 };
  const graded: CraftBand = { bandFormat: 1, metrics: { gutterRatio: { min: 0, max: 1 } } };

  // The range is one this episode genuinely misses: graded, it fails the band.
  const ifGraded = compareToCraftBand(calm, {
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 }, valueMean: unreachable },
  });
  assert.equal(ifGraded.inBand, false);

  const recorded = compareToCraftBand(calm, {
    ...graded,
    recorded: { valueMean: unreachable },
  });
  const plain = compareToCraftBand(calm, graded);
  assert.equal(recorded.inBand, true);
  assert.deepEqual(recorded.metrics, plain.metrics);
  assert.deepEqual(recorded.recorded, [
    { metric: "valueMean", value: calm.metrics.valueMean, min: 900, max: 1000 },
  ]);
  assert.deepEqual(plain.recorded, []);
  // A recorded entry carries no verdict field at all, so no caller can fold one
  // into a verdict by treating the two lists alike.
  assert.ok(!Object.hasOwn(recorded.recorded[0] as object, "inBand"));
});

test("a band of the shape shipped today validates and grades exactly as it did", () => {
  const value = shippedBandFor(calm);
  assert.deepEqual(validateCraftBandValue(value).issues, []);

  const band = asCraftBand(value);
  // Narrowing an old band must not invent the new fields, or a band read and
  // written back would gain keys it never declared.
  assert.ok(!Object.hasOwn(band, "recorded"));
  assert.ok(!Object.hasOwn(band, "provenance"));

  const report = compareToCraftBand(calm, band);
  assert.equal(report.inBand, true);
  assert.deepEqual(
    report.metrics.map((verdict) => verdict.metric),
    [...SHIPPED_METRICS],
  );
  assert.deepEqual(report.recorded, []);
  assert.equal(report.provenance, null);

  // The nine ranges decide something: one metric moved off its measured value
  // leaves the band, and only that metric.
  const moved = compareToCraftBand(
    withMetrics(calm, { valueMean: calm.metrics.valueMean * 2 + 10 }),
    band,
  );
  assert.equal(moved.inBand, false);
  assert.deepEqual(
    moved.metrics.filter((verdict) => !verdict.inBand).map((verdict) => verdict.metric),
    ["valueMean"],
  );

  // The same band with the new fields added grades identically: the recorded
  // metric and the provenance are beside the verdict, never inside it.
  const extended = asCraftBand({
    ...value,
    recorded: { valueSpread: { min: 0, max: 0.0001 } },
    provenance: PROVENANCE,
  });
  const after = compareToCraftBand(calm, extended);
  assert.deepEqual(after.metrics, report.metrics);
  assert.equal(after.inBand, report.inBand);
  assert.equal(after.recorded.length, 1);
});

test("provenance round-trips through validation, narrowing, and the report", () => {
  const value = {
    bandFormat: 1,
    name: "thriller cold",
    metrics: { gutterRatio: { min: 0, max: 1 } },
    provenance: PROVENANCE,
  };
  assert.deepEqual(validateCraftBandValue(value).issues, []);

  const band = asCraftBand(value);
  assert.deepEqual(band.provenance, PROVENANCE);
  // A work that declared no page extent does not acquire one, and the two works
  // keep the different capture facts they were written with.
  assert.ok(!Object.hasOwn(band.provenance?.works[1] as object, "pageLengthInWidths"));
  assert.deepEqual(
    band.provenance?.works.map((work) => [work.captureMode, work.constantColumnWidth]),
    [
      ["contiguous", true],
      ["sampled", false],
    ],
  );
  assert.deepEqual(compareToCraftBand(calm, band).provenance, PROVENANCE);
});

test("each new band field is rejected for every way it can be wrong", () => {
  assert.ok(bandCodes({ recorded: "valueMean" }).includes("band.recorded.type"));
  assert.ok(bandCodes({ recorded: {} }).includes("band.recorded.empty"));
  assert.ok(bandCodes({ recorded: { bubbleDensity: { min: 1 } } }).includes("band.metric.unknown"));
  assert.ok(bandCodes({ recorded: { valueMean: {} } }).includes("band.range.empty"));
  // A metric cannot be graded and recorded at once: the band would be saying
  // both that it decides the verdict and that it does not.
  assert.ok(
    bandCodes({ recorded: { gutterRatio: { min: 0, max: 1 } } }).includes("band.recorded.graded"),
  );

  assert.ok(bandCodes({ provenance: "two works" }).includes("band.provenance.type"));
  assert.ok(bandCodes({ provenance: { works: {} } }).includes("band.provenance.works.type"));
  assert.ok(workCodes([]).includes("band.provenance.works.empty"));
  assert.ok(workCodes(["work A"]).includes("band.provenance.work.type"));
  assert.ok(workCodes([{ ...WORK, label: undefined }]).includes("band.provenance.work.label"));
  assert.ok(workCodes([{ ...WORK, episodes: 0 }]).includes("band.provenance.work.episodes"));
  assert.ok(workCodes([{ ...WORK, episodes: 1.5 }]).includes("band.provenance.work.episodes"));
  // The capture facts are required ON THE WORK, and absent is as wrong as bad.
  assert.ok(workCodes([{ ...WORK, captureMode: "partial" }]).includes("band.provenance.capture"));
  assert.ok(workCodes([{ ...WORK, captureMode: undefined }]).includes("band.provenance.capture"));
  assert.ok(
    workCodes([{ ...WORK, constantColumnWidth: "yes" }]).includes("band.provenance.column-width"),
  );
  assert.ok(
    workCodes([{ ...WORK, constantColumnWidth: undefined }]).includes(
      "band.provenance.column-width",
    ),
  );
  assert.ok(
    workCodes([{ ...WORK, language: "a long spoken name" }]).includes(
      "band.provenance.work.language",
    ),
  );
  assert.ok(
    workCodes([{ ...WORK, pageLengthInWidths: 0 }]).includes("band.provenance.work.page-widths"),
  );
  assert.ok(workCodes([WORK, { ...WORK, episodes: 1 }]).includes("band.provenance.work.duplicate"));

  // Like every other band error, a new one names the field it is about.
  const issues = validateCraftBandValue({
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 } },
    provenance: { works: [{ ...WORK, episodes: 0 }] },
  }).issues;
  assert.deepEqual(
    issues.map((issue) => issue.path),
    ["band.provenance.works[0].episodes"],
  );
});

test("a language tag is the shape the docs promise and nothing wider", () => {
  for (const language of ["ko", "eng", "ko-KR", "ko-Hang-KR", "en-001"]) {
    assert.deepEqual(workCodes([{ ...WORK, language }]), [], language);
  }
  // An open-ended subtag chain is room for a source shorthand to ride along.
  for (const language of ["k", "korean", "ko-x-private", "ko-KR-extra", "ko-ABCDEFGH", "ko-"]) {
    assert.ok(
      workCodes([{ ...WORK, language }]).includes("band.provenance.work.language"),
      language,
    );
  }
});

test("the counts a band declares are bounded above as well as below", () => {
  for (const episodes of [0, -1, 1.5, 1e308, Number.POSITIVE_INFINITY, 10001]) {
    assert.ok(
      workCodes([{ ...WORK, episodes }]).includes("band.provenance.work.episodes"),
      String(episodes),
    );
  }
  for (const pages of [0, -1, 1e308, Number.POSITIVE_INFINITY, 1000001]) {
    assert.ok(
      workCodes([{ ...WORK, pageLengthInWidths: pages }]).includes(
        "band.provenance.work.page-widths",
      ),
      String(pages),
    );
  }
  // Ceilings, not bans: the largest accepted values still validate.
  assert.deepEqual(workCodes([{ ...WORK, episodes: 10000, pageLengthInWidths: 1000000 }]), []);

  // And one band cannot list an unbounded number of works.
  const many = Array.from({ length: 101 }, (_, i) => ({ ...WORK, label: `work ${i}` }));
  assert.ok(workCodes(many).includes("band.provenance.works.count"));
  assert.deepEqual(workCodes(many.slice(0, 100)), []);
});

test("a band's printed text cannot forge a line of the report", () => {
  // The report is plain lines, so a label that can hold a newline can write a
  // verdict of its own above the real one.
  // The documented bound, written out here rather than imported: a test that
  // asks the code what its own limit is pins nothing.
  const maxLength = 80;
  const newline = String.fromCharCode(10);
  const forged = `work A${newline}verdict: IN BAND — 9 metric(s) graded against band`;
  const oversized = "w".repeat(maxLength + 1);
  // 0x2028 and 0x2029 are line breaks to anything that splits text the Unicode
  // way, and 0x202e reverses everything printed after it.
  const controls = [7, 0x1b, 0x1f, 0x7f, 0x9f, 0x2028, 0x2029, 0x202e, 0x2066].map(
    (code) => `work${String.fromCharCode(code)}A`,
  );

  for (const text of [forged, oversized, ...controls]) {
    assert.ok(
      workCodes([{ ...WORK, label: text }]).includes("band.provenance.work.label"),
      JSON.stringify(text),
    );
    assert.ok(bandCodes({ name: text }).includes("band.name"), JSON.stringify(text));
  }

  // An empty name prints as an empty quoted string in the verdict, which names
  // nothing at all.
  assert.ok(bandCodes({ name: "" }).includes("band.name"));

  // A bound, not a ban: the longest one-line text there is room for validates.
  const longest = "w".repeat(maxLength);
  assert.deepEqual(
    bandCodes({ name: longest, provenance: { works: [{ ...WORK, label: longest }] } }),
    [],
  );
});

test("the band file shipped in this repository validates and grades", async () => {
  const file = join(repositoryRoot(), "packages/packs/examples/example-pack/bands/noir.json");
  const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  assert.deepEqual(validateCraftBandValue(value).issues, []);

  const band = asCraftBand(value);
  assert.ok(!Object.hasOwn(band, "recorded"));
  assert.ok(!Object.hasOwn(band, "provenance"));

  const report = compareToCraftBand(calm, band);
  assert.equal(report.metrics.length, Object.keys(band.metrics).length);
  assert.deepEqual(
    [...report.metrics.map((verdict) => verdict.metric)].sort(),
    Object.keys(band.metrics).sort(),
  );
  assert.deepEqual(report.recorded, []);
  assert.equal(report.provenance, null);

  // It grades live ranges: a metric that passes this file's ceiling, pushed
  // past it, flips — and nothing else moves. Without this the assertions above
  // would hold just as well for a file that graded nothing.
  const capped = report.metrics.find((verdict) => verdict.max !== null && verdict.inBand);
  assert.ok(capped !== undefined, "the shipped band caps at least one metric this page passes");
  const moved = { ...calm.metrics };
  (moved as Record<CraftMetricName, number | null>)[capped.metric] = (capped.max as number) + 1;

  const over = compareToCraftBand({ ...calm, metrics: moved }, band);
  assert.equal(over.inBand, false);
  const before = new Map(report.metrics.map((verdict) => [verdict.metric, verdict.inBand]));
  assert.deepEqual(
    over.metrics
      .filter((verdict) => before.get(verdict.metric) !== verdict.inBand)
      .map((verdict) => verdict.metric),
    [capped.metric],
  );
});

test("no band field can hold a title, a source, or a link", () => {
  // There is no key to put one in, at either level.
  for (const field of [{ title: "x" }, { source: "x" }, { url: "https://a.invalid/x" }]) {
    assert.ok(
      workCodes([{ ...WORK, ...field }]).includes("band.unexpected-field"),
      `works[0].${Object.keys(field)[0]}`,
    );
  }
  assert.ok(
    bandCodes({ provenance: { works: [WORK], source: "x" } }).includes("band.unexpected-field"),
  );
  // Nor a free-text field at the top level, which is where one would end up.
  assert.ok(bandCodes({ note: "captured from ..." }).includes("band.unexpected-field"));

  // And the one free-text field there is refuses the obvious forms. This is a
  // backstop, not the guarantee: the guarantee is that no field for a source
  // exists at all.
  for (const label of ["https://a.invalid/work-a", "a.invalid work A", "work A (a.invalid)"]) {
    assert.ok(workCodes([{ ...WORK, label }]).includes("band.provenance.work.label.link"), label);
  }
  // A neutral label with punctuation in it is still accepted.
  for (const label of ["thriller work C (KOR)", "medieval-europe work C", "work no.2"]) {
    assert.deepEqual(workCodes([{ ...WORK, label }]), [], label);
  }
});
