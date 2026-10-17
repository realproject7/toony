// `toony plan` — the grade that runs before the art exists (#234).
//
// The geometry is tested in `@toony/export`; what matters here is the command
// contract an agent relies on. Two parts of it are load bearing and are asserted
// in every shape the command can print:
//
//   A plan report NEVER reads as a measurement. It names the six metrics it did
//   not check, in text and in JSON, band or no band, in band or out.
//
//   A cut with no declared shape is called out. The resolver has a fallback, so
//   the panel figures always come back looking like an answer; only the note
//   says whether they describe the pack or the constant.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runInit } from "../commands/init.js";
import { runPlan } from "../commands/plan.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

let workdir: string;

function capture(env?: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { cwd: workdir, out: (l: string) => out.push(l), err: (l: string) => err.push(l), env },
    out,
    err,
  };
}

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  return join(workdir, "demo");
}

/** A plan stating a short episode as two beats with lengths. */
async function planFile(name: string, body?: string): Promise<string> {
  const path = join(workdir, name);
  await writeFile(
    path,
    body ??
      [
        "planFormat: 1",
        "name: Cold open",
        "referenceWidth: 800",
        "beats:",
        "  - label: the open",
        "    cuts: 3",
        "    panelAspect: 1.4",
        "    gap:",
        "      type: gutter",
        "      gutterHeight: 120",
        "  - label: the turn",
        "    cuts: 2",
        "    panelAspect: 2.0",
        "    openWith:",
        "      type: void",
        "      gutterHeight: 300",
        "    gap:",
        "      type: gutter",
        "      gutterHeight: 120",
        "",
      ].join("\n"),
  );
  return path;
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-plan-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("plan reports an episode's page structure from its lists, reading no image", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001"], c.io), EXIT_OK, c.err.join("\n"));
  const text = c.out.join("\n");
  assert.match(text, /planned ep-001/);
  assert.match(text, /no image read/);
  for (const metric of ["gutterRatio", "gutterMedian", "panelHeightMedian", "panelsPerScreen"]) {
    assert.match(text, new RegExp(`${metric}\\s+[-\\d.]`));
  }
  // And never the ones it cannot reach.
  assert.doesNotMatch(text, /^ {2}valueMean\s+[-\d.]/m);
  assert.doesNotMatch(text, /^ {2}panelInset\s+[-\d.]/m);
});

test("the report always names the six metrics it did not check", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001"], c.io), EXIT_OK);
  const text = c.out.join("\n");
  assert.match(text, /NOT CHECKED — a plan has no pixels/);
  for (const metric of [
    "gutterIntrusionsPerScreen",
    "panelInset",
    "valueMean",
    "valueSpread",
    "saturationMean",
    "hueBias",
  ]) {
    assert.match(text, new RegExp(`    ${metric} `));
  }
});

test("a cut with no declared shape is named, with the fallback it was graded at", async () => {
  // `toony init` scaffolds cuts without `panelAspect`, which is exactly the case
  // that must not pass quietly: every panel figure below the note is the
  // fallback constant, not the pack.
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001"], c.io), EXIT_OK);
  assert.match(c.out.join("\n"), /cuts declare no panelAspect; they were graded at the fallback/);
});

test("--json carries the metrics, the unchecked list, and the fallback count", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--json"], c.io), EXIT_OK);
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.episodeId, "ep-001");
  assert.equal(report.planName, null);
  assert.equal(report.screenHeight, report.width * 2);
  assert.equal(report.band, null);
  assert.equal(typeof report.metrics.gutterRatio, "number");
  assert.equal(report.metrics.valueMean, undefined);
  assert.deepEqual(
    report.unchecked.map((entry: { metric: string }) => entry.metric),
    [
      "gutterIntrusionsPerScreen",
      "panelInset",
      "valueMean",
      "valueSpread",
      "saturationMean",
      "hueBias",
    ],
  );
  assert.equal(report.cutsWithoutDeclaredShape, report.cuts);
  assert.equal(report.fallbackAspect, 1.4);
});

test("--spec grades a structure stated as beats with lengths", async () => {
  const spec = await planFile("plan.yaml");
  const c = capture();
  assert.equal(await runPlan(["--spec", spec, "--json"], c.io), EXIT_OK, c.err.join("\n"));
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.planName, "Cold open");
  assert.equal(report.episodeId, null);
  assert.equal(report.cuts, 5);
  assert.equal(report.cutsWithoutDeclaredShape, 0);
  // Three cuts at 1.4 columns, two at 2.0, four gaps: two internal 120px gutters
  // in the first beat, a 300px void opening the second, one 120px gutter inside
  // it. At the default 1200px column and an 800px reference that is 1.5x.
  assert.equal(report.width, 1200);
  assert.equal(report.height, 3 * 1680 + 2 * 2400 + 2 * 180 + 450 + 180);
  assert.equal(report.transitions.gaps, 4);
});

test("both modes print the same report sections, so one report is read one way", async () => {
  // The agreement between a plan and the cut list it stands for is asserted in
  // `@toony/export` against a rendered page. What the command owns is that the
  // two ways of reaching it read identically — same table, same mix, same
  // unchecked list — so an agent does not have to learn two reports.
  const dir = await scaffold();
  const spec = await planFile("plan.yaml");
  const fromEpisode = capture();
  const fromSpec = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001"], fromEpisode.io), EXIT_OK);
  assert.equal(await runPlan(["--spec", spec], fromSpec.io), EXIT_OK);
  for (const section of [
    /gutterRatio\s+[-\d.]/,
    /panelsPerScreen\s+[-\d.]/,
    /transition mix — \d+ gap\(s\) drawn/,
    /NOT CHECKED — a plan has no pixels/,
  ]) {
    assert.match(fromEpisode.out.join("\n"), section);
    assert.match(fromSpec.out.join("\n"), section);
  }
  // Only the plan states beats, because only a plan has them.
  assert.match(fromSpec.out.join("\n"), /beats — 2, in column widths/);
  assert.doesNotMatch(fromEpisode.out.join("\n"), /beats —/);
});

test("--against grades only what a plan checks, and says what it skipped", async () => {
  const dir = await scaffold();
  const band = join(workdir, "band.json");
  await writeFile(
    band,
    JSON.stringify({
      bandFormat: 1,
      name: "wide open",
      metrics: {
        gutterRatio: { min: 0, max: 1 },
        valueMean: { min: 0, max: 255 },
        panelInset: { min: 0, max: 1 },
      },
    }),
  );
  const c = capture();
  assert.equal(
    await runPlan([dir, "--episode", "ep-001", "--against", band], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const text = c.out.join("\n");
  assert.match(text, /plan verdict: IN BAND ON WHAT A PLAN CHECKS/);
  assert.match(text, /2 further metric\(s\) the band grades NOT CHECKED \(panelInset, valueMean\)/);
  assert.doesNotMatch(text, /verdict: IN BAND —/);
});

test("a band a plan CAN check still fails, with a non-zero exit", async () => {
  const dir = await scaffold();
  const band = join(workdir, "impossible.json");
  await writeFile(
    band,
    JSON.stringify({
      bandFormat: 1,
      name: "impossible",
      metrics: { gutterRatio: { min: 0.99 }, valueMean: { max: 0.5 } },
    }),
  );
  const c = capture();
  assert.equal(
    await runPlan([dir, "--episode", "ep-001", "--against", band], c.io),
    EXIT_VALIDATION,
  );
  const text = c.out.join("\n");
  assert.match(text, /plan verdict: OUT OF BAND — 1 of 1 metric\(s\)/);
  // The metric it could not check is named on the failing line too, so neither
  // verdict can be read as covering the whole band.
  assert.match(text, /NOT CHECKED \(valueMean\)/);
});

test("--against reports the same split in JSON, and carries no whole verdict", async () => {
  const dir = await scaffold();
  const band = join(workdir, "band.json");
  await writeFile(
    band,
    JSON.stringify({
      bandFormat: 1,
      metrics: { gutterRatio: { min: 0, max: 1 }, hueBias: { min: 0, max: 360 } },
      recorded: { panelsPerScreen: { min: 0, max: 99 } },
    }),
  );
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--against", band, "--json"], c.io), 0);
  const report = JSON.parse(c.out.join("\n")).band;
  assert.equal(report.inBand, undefined);
  assert.equal(report.checkedInBand, true);
  assert.deepEqual(
    report.metrics.map((verdict: { metric: string }) => verdict.metric),
    ["gutterRatio"],
  );
  assert.deepEqual(
    report.unchecked.map((entry: { metric: string }) => entry.metric),
    ["hueBias"],
  );
  assert.deepEqual(
    report.recorded.map((entry: { metric: string }) => entry.metric),
    ["panelsPerScreen"],
  );
});

test("a band that grades nothing a plan can check is refused, not passed", async () => {
  // The chain this protects is `toony plan --against <band> && toony generate`.
  // Before this, a band whose every graded range needs pixels printed the words
  // "IN BAND" over zero checked metrics and exited 0, so the generate ran and
  // paid the hours this command exists to save.
  const dir = await scaffold();
  const band = join(workdir, "colour-only.json");
  await writeFile(
    band,
    JSON.stringify({
      bandFormat: 1,
      name: "colour only",
      metrics: {
        valueMean: { max: 10 },
        saturationMean: { max: 0.01 },
        panelInset: { max: 0.01 },
      },
    }),
  );
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--against", band], c.io), EXIT_USAGE);
  const text = c.out.join("\n");
  assert.match(text, /plan verdict: NOT GRADED/);
  assert.match(text, /a plan can check none of them/);
  // The words a caller greps for must not appear at all.
  assert.doesNotMatch(text, /IN BAND/);
  assert.doesNotMatch(text, /OUT OF BAND/);
  assert.match(c.err.join("\n"), /grades nothing a plan can check/);

  // The five figures still print: the measurement was fine, the band was not.
  assert.match(text, /gutterRatio\s+[-\d.]/);
});

test("the same band with one checkable range added grades and exits normally", async () => {
  const dir = await scaffold();
  const band = join(workdir, "mostly-colour.json");
  await writeFile(
    band,
    JSON.stringify({
      bandFormat: 1,
      name: "mostly colour",
      metrics: { valueMean: { max: 10 }, gutterRatio: { min: 0, max: 1 } },
    }),
  );
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--against", band], c.io), EXIT_OK);
  assert.match(c.out.join("\n"), /plan verdict: IN BAND ON WHAT A PLAN CHECKS/);
});

test("an ungraded band carries no verdict field in JSON either", async () => {
  const dir = await scaffold();
  const band = join(workdir, "colour-only.json");
  await writeFile(
    band,
    JSON.stringify({ bandFormat: 1, metrics: { hueBias: { min: 0, max: 360 } } }),
  );
  const c = capture();
  assert.equal(
    await runPlan([dir, "--episode", "ep-001", "--against", band, "--json"], c.io),
    EXIT_USAGE,
  );
  const report = JSON.parse(c.out.join("\n")).band;
  assert.equal(report.graded, false);
  assert.equal(report.checkedInBand, undefined);
  assert.equal(report.inBand, undefined);
  assert.deepEqual(
    report.unchecked.map((entry: { metric: string }) => entry.metric),
    ["hueBias"],
  );
});

test("a plan too tall to grade fails as a usage error, with no stack trace", async () => {
  // A valid plan whose page cannot be held in memory used to throw out of the
  // unwrapped --spec path: a stack trace on stderr and exit 1, which this CLI
  // documents as an out-of-band verdict. A scripted gate reads that as a band
  // result.
  const spec = await planFile(
    "huge.yaml",
    [
      "planFormat: 1",
      "referenceWidth: 800",
      "beats:",
      "  - label: far too much page",
      "    cuts: 1000",
      "    panelAspect: 10",
      "  - label: and again",
      "    cuts: 1000",
      "    panelAspect: 10",
      "",
    ].join("\n"),
  );
  const c = capture();
  assert.equal(await runPlan(["--spec", spec, "--width", "1200"], c.io), EXIT_USAGE);
  const err = c.err.join("\n");
  assert.match(err, /plan failed: this plan comes to \d+ rows/);
  assert.doesNotMatch(err, /RangeError|at Array\.push|^\s+at /m);
  assert.equal(c.out.length, 0);
});

test("the same plan at a column where it fits is graded", async () => {
  const spec = await planFile(
    "large.yaml",
    [
      "planFormat: 1",
      "referenceWidth: 800",
      "beats:",
      "  - label: far too much page",
      "    cuts: 1000",
      "    panelAspect: 10",
      "  - label: and again",
      "    cuts: 1000",
      "    panelAspect: 10",
      "",
    ].join("\n"),
  );
  const c = capture();
  assert.equal(await runPlan(["--spec", spec, "--width", "800", "--json"], c.io), EXIT_OK);
  assert.equal(JSON.parse(c.out.join("\n")).cuts, 2000);
});

test("the same plan graded twice produces byte-identical JSON", async () => {
  const dir = await scaffold();
  const first = capture();
  const second = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--json"], first.io), EXIT_OK);
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--json"], second.io), EXIT_OK);
  assert.equal(first.out.join("\n"), second.out.join("\n"));
});

test("a plan file that does not validate is refused with its own error codes", async () => {
  const bad = join(workdir, "bad.yaml");
  await writeFile(bad, "planFormat: 1\nreferenceWidth: 800\nbeats:\n  - label: x\n    cuts: 0\n");
  const c = capture();
  assert.equal(await runPlan(["--spec", bad], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /plan error \[plan\.beat-cuts\]/);

  const unreadable = capture();
  assert.equal(await runPlan(["--spec", join(workdir, "nope.yaml")], unreadable.io), EXIT_USAGE);
  assert.match(unreadable.err.join("\n"), /plan file could not be read/);
});

test("exactly one of --episode and --spec is required", async () => {
  const dir = await scaffold();
  const spec = await planFile("plan.yaml");
  const neither = capture();
  assert.equal(await runPlan([dir], neither.io), EXIT_USAGE);
  assert.match(neither.err.join("\n"), /exactly one of --episode/);

  const both = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-001", "--spec", spec], both.io), EXIT_USAGE);
  assert.match(both.err.join("\n"), /exactly one of --episode/);
});

test("an episode that does not exist fails as a usage error, not a crash", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runPlan([dir, "--episode", "ep-404"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /plan failed: episode not found/);
});

test("a band an installed pack ships is named by id, exactly as measure names it", async () => {
  const dir = await scaffold();
  const packs = join(workdir, "packs");
  const pack = join(packs, "demo-pack");
  await mkdir(join(pack, "bands"), { recursive: true });
  await writeFile(
    join(pack, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "demo-pack",
      name: "Demo",
      craftBands: [{ id: "demo-band", file: "bands/demo.json" }],
    }),
  );
  await writeFile(
    join(pack, "bands", "demo.json"),
    JSON.stringify({ bandFormat: 1, name: "Demo", metrics: { gutterRatio: { min: 0, max: 1 } } }),
  );
  const c = capture({ TOONY_PACKS: packs });
  assert.equal(
    await runPlan([dir, "--episode", "ep-001", "--against", "demo-band"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  assert.match(c.out.join("\n"), /band "Demo"/);
  // Nothing was written into the project by planning it.
  await assert.rejects(() => readFile(join(dir, "episodes/ep-001/exports/plan.json"), "utf8"));
});
