// `toony measure` — the style-pack build loop's exit condition (#196).
//
// Measurement itself is tested in `@toony/export`; what matters here is the
// command contract agents rely on: a human table, a JSON report, a band verdict
// with a non-zero exit when the episode is out of band, and a band that can come
// from an installed pack instead of a file path.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { runImportImage } from "../commands/import-image.js";
import { runInit } from "../commands/init.js";
import { runMeasure } from "../commands/measure.js";
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

/** Striped art, so a measured page carries real panels rather than flat fill. */
async function artFile(): Promise<string> {
  const canvas = createCanvas(320, 440);
  const ctx = canvas.getContext("2d");
  for (let x = 0; x < 320; x += 8) {
    ctx.fillStyle = (x / 8) % 2 === 0 ? "#12203a" : "#8fb4e8";
    ctx.fillRect(x, 0, 8, 440);
  }
  const path = join(workdir, "art.png");
  await writeFile(path, canvas.toBuffer("image/png"));
  return path;
}

/** A scaffold whose two cuts carry art, so the metrics describe a real page. */
async function scaffoldWithArt(): Promise<string> {
  const dir = await scaffold();
  const src = await artFile();
  for (const cut of ["cut-001", "cut-002"]) {
    const c = capture();
    assert.equal(
      await runImportImage(
        [dir, "--episode", "ep-001", "--cut", cut, "--slot", "clean", "--from", src],
        c.io,
      ),
      EXIT_OK,
      c.err.join("\n"),
    );
  }
  return dir;
}

/** A band whose ranges the scaffold's own measurement lands inside. */
async function writeBandFor(dir: string, file: string): Promise<string> {
  const c = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--json"], c.io), EXIT_OK);
  const measured = JSON.parse(c.out.join("\n")) as { metrics: Record<string, number> };
  const path = join(workdir, file);
  await writeFile(
    path,
    JSON.stringify({
      bandFormat: 1,
      name: "scaffold",
      metrics: {
        gutterRatio: {
          min: (measured.metrics.gutterRatio as number) - 0.05,
          max: (measured.metrics.gutterRatio as number) + 0.05,
        },
        valueMean: {
          min: (measured.metrics.valueMean as number) - 5,
          max: (measured.metrics.valueMean as number) + 5,
        },
      },
    }),
  );
  return path;
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-measure-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("measure reports a table for every metric, and the render it measured", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001"], c.io), EXIT_OK, c.err.join("\n"));
  const text = c.out.join("\n");
  assert.match(text, /measured ep-001/);
  assert.match(text, /screens at aspect 2/);
  for (const metric of ["gutterRatio", "panelHeightMedian", "panelsPerScreen", "hueBias"]) {
    assert.match(text, new RegExp(`${metric}\\s+[-\\d.]`));
  }
  // The scaffold has no art yet, and the report says so rather than letting the
  // flat neutral fill read as craft.
  assert.match(text, /cuts have no image asset/);
});

test("--json emits the metrics, the render assumptions, and no band", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--json"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.episodeId, "ep-001");
  assert.equal(report.screenAspect, 2);
  assert.equal(report.screenHeight, report.width * 2);
  assert.equal(report.band, null);
  assert.equal(typeof report.metrics.gutterRatio, "number");
});

test("the same episode measured twice produces byte-identical JSON", async () => {
  const dir = await scaffold();
  const first = capture();
  const second = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--json"], first.io), EXIT_OK);
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--json"], second.io), EXIT_OK);
  assert.equal(first.out.join("\n"), second.out.join("\n"));
});

test("--against passes in band and exits non-zero out of band", async () => {
  const dir = await scaffoldWithArt();
  const band = await writeBandFor(dir, "band.json");

  const good = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", band], good.io),
    EXIT_OK,
    good.err.join("\n"),
  );
  assert.match(good.out.join("\n"), /verdict: IN BAND/);

  await writeFile(
    join(workdir, "impossible.json"),
    JSON.stringify({
      bandFormat: 1,
      name: "impossible",
      metrics: { gutterRatio: { min: 0.99 }, valueMean: { max: 0.5 } },
    }),
  );
  const bad = capture();
  assert.equal(
    await runMeasure(
      [dir, "--episode", "ep-001", "--against", join(workdir, "impossible.json")],
      bad.io,
    ),
    EXIT_VALIDATION,
  );
  const text = bad.out.join("\n");
  assert.match(text, /verdict: OUT OF BAND — 2 of 2/);
  assert.match(text, /gutterRatio.*OUT/);
});

test("--against reports the band verdict in JSON too", async () => {
  const dir = await scaffoldWithArt();
  const band = await writeBandFor(dir, "band.json");
  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", band, "--json"], c.io),
    EXIT_OK,
  );
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.band.name, "scaffold");
  assert.equal(report.band.inBand, true);
  assert.deepEqual(
    report.band.metrics.map((verdict: { metric: string }) => verdict.metric),
    ["gutterRatio", "valueMean"],
  );
});

test("a band a pack ships is selected by id, not by path", async () => {
  const dir = await scaffoldWithArt();
  const packDir = join(dir, ".toony", "packs", "genre-pack");
  await mkdir(join(packDir, "bands"), { recursive: true });
  await writeFile(
    join(packDir, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "genre-pack",
      name: "Genre Pack",
      craftBands: [{ id: "noir-band", file: "bands/noir.json" }],
    }),
  );
  await writeFile(
    join(packDir, "bands", "noir.json"),
    JSON.stringify({
      bandFormat: 1,
      name: "noir",
      metrics: { gutterRatio: { min: 0.99 } },
    }),
  );

  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", "noir-band"], c.io),
    EXIT_VALIDATION,
    c.err.join("\n"),
  );
  assert.match(c.out.join("\n"), /band "noir"/);
});

test("a band pins the screen it was measured at, and an explicit flag still wins", async () => {
  const dir = await scaffold();
  await writeFile(
    join(workdir, "wide.json"),
    JSON.stringify({
      bandFormat: 1,
      screenAspect: 3,
      metrics: { gutterRatio: { min: 0, max: 1 } },
    }),
  );
  const fromBand = capture();
  assert.equal(
    await runMeasure(
      [dir, "--episode", "ep-001", "--against", join(workdir, "wide.json"), "--json"],
      fromBand.io,
    ),
    EXIT_OK,
  );
  assert.equal(JSON.parse(fromBand.out.join("\n")).screenAspect, 3);

  const flagWins = capture();
  assert.equal(
    await runMeasure(
      [
        dir,
        "--episode",
        "ep-001",
        "--against",
        join(workdir, "wide.json"),
        "--screen-aspect",
        "1.5",
        "--json",
      ],
      flagWins.io,
    ),
    EXIT_OK,
  );
  assert.equal(JSON.parse(flagWins.out.join("\n")).screenAspect, 1.5);
});

test("a malformed band is a usage error naming the field and the code", async () => {
  const dir = await scaffold();
  await writeFile(
    join(workdir, "bad.json"),
    JSON.stringify({ bandFormat: 1, metrics: { io: {} } }),
  );
  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", join(workdir, "bad.json")], c.io),
    EXIT_USAGE,
  );
  assert.match(c.err.join("\n"), /band\.metric\.unknown/);

  const missing = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", "no-such-band.json"], missing.io),
    EXIT_USAGE,
  );
  assert.match(missing.err.join("\n"), /band file could not be read/);
});

test("bad arguments are usage errors", async () => {
  const dir = await scaffold();
  for (const args of [
    [dir],
    [dir, "--episode"],
    [dir, "--episode", "ep-001", "--width", "0"],
    [dir, "--episode", "ep-001", "--screen-aspect", "0"],
    [dir, "--episode", "ep-001", "--nope"],
    [dir, "--episode", "ep-404"],
  ]) {
    const c = capture();
    assert.equal(await runMeasure(args, c.io), EXIT_USAGE, `expected usage error for ${args}`);
    assert.ok(c.err.length > 0);
  }
});

test("measure defaults to the current directory like lint does", async () => {
  await scaffold();
  const c = capture();
  c.io.cwd = join(workdir, "demo");
  assert.equal(await runMeasure(["--episode", "ep-001"], c.io), EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /measured ep-001/);
});
