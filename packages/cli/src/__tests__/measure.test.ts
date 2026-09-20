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

// --- The transition vocabulary (#236) ---------------------------------------

/** A band grading only the scaffold's one `gutter` gap, in or out of band. */
async function vocabularyBand(file: string, share: { min: number; max: number }): Promise<string> {
  const path = join(workdir, file);
  await writeFile(
    path,
    JSON.stringify({
      bandFormat: 1,
      name: "vocabulary",
      metrics: { gutterRatio: { min: 0, max: 1 } },
      transitionVocabulary: [{ kinds: ["gutter"], share, height: { min: 0, max: 1 } }],
    }),
  );
  return path;
}

test("the measured transition mix prints and reports with or without a band", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--json"], c.io), EXIT_OK);
  const report = JSON.parse(c.out.join("\n"));
  // The scaffold's one transition is a plain gutter, 48px on an 800px column.
  assert.equal(report.transitions.gaps, 1);
  assert.equal(report.transitions.undrawn, 0);
  assert.deepEqual(report.transitions.kinds, [
    { kind: "gutter", count: 1, share: 1, heightMedian: 0.06, heights: [0.06] },
  ]);
  assert.equal(report.band, null);

  const text = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001"], text.io), EXIT_OK);
  const printed = text.out.join("\n");
  assert.match(printed, /transition mix — 1 gap\(s\) drawn, from the declared kinds/);
  assert.match(printed, /gutter\s+1\s+share\s+1\s+height\s+0\.06/);
});

test("a vocabulary the episode misses fails the band and the exit code", async () => {
  const dir = await scaffoldWithArt();
  const inBand = await vocabularyBand("vocab-in.json", { min: 0.5, max: 1 });
  const outOfBand = await vocabularyBand("vocab-out.json", { min: 0, max: 0.5 });

  const good = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", inBand], good.io),
    EXIT_OK,
    good.err.join("\n"),
  );
  assert.match(
    good.out.join("\n"),
    /verdict: IN BAND — 1 metric\(s\) and 1 transition entry\(s\) graded/,
  );

  // The same episode, the same one metric, a share range it cannot meet.
  const bad = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", outOfBand], bad.io),
    EXIT_VALIDATION,
    bad.err.join("\n"),
  );
  const text = bad.out.join("\n");
  assert.match(text, /verdict: OUT OF BAND — 0 of 1 metric\(s\) and 1 of 1 transition entry\(s\)/);
  assert.match(text, /transition vocabulary — 1 entry\(s\) graded/);
  assert.match(text, /share\s+1\s+0\.\.0\.5\s+OUT/);
  assert.match(text, /height\s+0\.06\s+0\.\.1\s+in/);
});

test("a band with no vocabulary prints the verdict line it always printed", async () => {
  const dir = await scaffoldWithArt();
  const band = await writeBandFor(dir, "plain.json");
  const good = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--against", band], good.io), EXIT_OK);
  // Neither line mentions transitions: a band that does not use the field must
  // report exactly as it did before the field existed.
  assert.ok(
    good.out.some(
      (line) => line === 'verdict: IN BAND — 2 metric(s) graded against band "scaffold"',
    ),
    good.out.join("\n"),
  );

  await writeFile(
    join(workdir, "plain-out.json"),
    JSON.stringify({ bandFormat: 1, name: "scaffold", metrics: { gutterRatio: { min: 0.99 } } }),
  );
  const bad = capture();
  assert.equal(
    await runMeasure(
      [dir, "--episode", "ep-001", "--against", join(workdir, "plain-out.json")],
      bad.io,
    ),
    EXIT_VALIDATION,
  );
  assert.ok(
    bad.out.some(
      (line) => line === 'verdict: OUT OF BAND — 1 of 1 metric(s) outside band "scaffold"',
    ),
    bad.out.join("\n"),
  );
});

test("a height range with no gap to measure prints as neither passed nor failed", async () => {
  const dir = await scaffold();
  const path = join(workdir, "absent.json");
  await writeFile(
    path,
    JSON.stringify({
      bandFormat: 1,
      metrics: { gutterRatio: { min: 0, max: 1 } },
      transitionVocabulary: [
        { kinds: ["gutter"], share: { min: 0, max: 1 } },
        // The scaffold uses no void at all, and zero of it is allowed.
        { kinds: ["void"], share: { min: 0, max: 0.5 }, height: { min: 0.3, max: 0.4 } },
      ],
    }),
  );
  const c = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--against", path], c.io), EXIT_OK);
  const text = c.out.join("\n");
  assert.match(text, /void\s+0 gap\(s\)/);
  assert.match(text, /height\s+—\s+0\.3\.\.0\.4\s+no gap of these kinds/);
  // And it is not printed as a pass, which is the whole point of the marker.
  assert.doesNotMatch(text, /height\s+—\s+0\.3\.\.0\.4\s+in/);
});

test("a band whose vocabulary is malformed is refused, naming the field", async () => {
  const dir = await scaffold();
  const path = join(workdir, "broken.json");
  await writeFile(
    path,
    JSON.stringify({
      bandFormat: 1,
      metrics: { gutterRatio: { min: 0, max: 1 } },
      transitionVocabulary: [{ kinds: ["slow_wipe"], share: { min: 0, max: 1 } }],
    }),
  );
  const c = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--against", path], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /band\.transitions\.kind\.unknown/);
  assert.match(c.err.join("\n"), /band\.transitionVocabulary\[0]\.kinds\[0]/);
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

// --- A band records what it does not grade, and says what it came from (#235) ---

/**
 * The provenance used below: two works captured DIFFERENTLY, so the report has
 * to say so per work rather than summarise both wrongly in one line.
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

/**
 * A band the scaffold passes on one graded metric, records a second metric the
 * scaffold misses by a mile, and declares where its numbers came from.
 */
async function writeStyleBandFor(dir: string, file: string): Promise<string> {
  const c = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--json"], c.io), EXIT_OK);
  const measured = JSON.parse(c.out.join("\n")) as { metrics: Record<string, number> };
  const gutterRatio = measured.metrics.gutterRatio as number;
  const path = join(workdir, file);
  await writeFile(
    path,
    JSON.stringify({
      bandFormat: 1,
      name: "style",
      metrics: { gutterRatio: { min: gutterRatio - 0.05, max: gutterRatio + 0.05 } },
      // No page can carry 900 floating elements per screen.
      recorded: { gutterIntrusionsPerScreen: { min: 900, max: 1000 } },
      provenance: PROVENANCE,
    }),
  );
  return path;
}

test("--against shows the provenance and marks recorded metrics in the table", async () => {
  const dir = await scaffoldWithArt();
  const band = await writeStyleBandFor(dir, "style.json");

  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", band], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const text = c.out.join("\n");

  // Where the numbers came from, in the report that grades against them — and
  // each work's own capture facts, which differ between these two.
  assert.match(text, /measured from 2 work\(s\), 4 episode\(s\)$/m);
  assert.match(
    text,
    /thriller work A — 2 episode\(s\), contiguous capture, constant column width, eng, 118\.4 column widths of page$/m,
  );
  assert.match(
    text,
    /thriller work C \(KOR\) — 2 episode\(s\), sampled capture, varying column width, ko$/m,
  );

  // The recorded metric is far outside the range the band kept for it, and the
  // verdict is IN BAND anyway — marked, not graded, and not in the exit code.
  assert.match(text, /gutterIntrusionsPerScreen\s+[\d.]+\s+900\.\.1000\s+recorded, not graded$/m);
  assert.match(
    text,
    /verdict: IN BAND — 1 metric\(s\) graded against band "style" \(1 further metric\(s\) recorded, not graded\)/,
  );
  // A graded metric still reads as a verdict, so the two can be told apart.
  assert.match(text, /gutterRatio\s+[\d.]+\s+[\d.-]+\.\.[\d.-]+\s+in$/m);
});

test("--json keeps recorded metrics apart from graded ones and carries the provenance", async () => {
  const dir = await scaffoldWithArt();
  const band = await writeStyleBandFor(dir, "style.json");

  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", band, "--json"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const report = JSON.parse(c.out.join("\n"));

  assert.equal(report.band.inBand, true);
  assert.deepEqual(
    report.band.metrics.map((verdict: { metric: string }) => verdict.metric),
    ["gutterRatio"],
  );
  assert.deepEqual(report.band.recorded, [
    {
      metric: "gutterIntrusionsPerScreen",
      value: report.metrics.gutterIntrusionsPerScreen,
      min: 900,
      max: 1000,
    },
  ]);
  assert.deepEqual(report.band.provenance, PROVENANCE);
});

test("a band with neither new field reports neither, and grades as it always did", async () => {
  const dir = await scaffoldWithArt();
  const band = await writeBandFor(dir, "band.json");
  const c = capture();
  assert.equal(
    await runMeasure([dir, "--episode", "ep-001", "--against", band, "--json"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.band.inBand, true);
  assert.deepEqual(report.band.recorded, []);
  assert.equal(report.band.provenance, null);

  const text = capture();
  assert.equal(await runMeasure([dir, "--episode", "ep-001", "--against", band], text.io), EXIT_OK);
  const lines = text.out.join("\n");
  assert.doesNotMatch(lines, /recorded/);
  assert.doesNotMatch(lines, /measured from/);
  assert.match(lines, /verdict: IN BAND — 2 metric\(s\) graded against band "scaffold"$/m);
});

test("a malformed new field is a usage error naming the field and the code", async () => {
  const dir = await scaffold();
  const cases: [string, Record<string, unknown>, RegExp][] = [
    [
      "recorded-graded.json",
      { recorded: { gutterRatio: { min: 0, max: 1 } } },
      /band\.recorded\.graded.*band\.recorded\.gutterRatio/s,
    ],
    [
      "recorded-unknown.json",
      { recorded: { bubbleDensity: { min: 1 } } },
      /band\.metric\.unknown.*band\.recorded\.bubbleDensity/s,
    ],
    [
      "capture.json",
      {
        provenance: {
          works: [
            { label: "work A", episodes: 2, captureMode: "partial", constantColumnWidth: true },
          ],
        },
      },
      /band\.provenance\.capture.*works\[0\]\.captureMode/s,
    ],
    [
      "work-label.json",
      {
        provenance: {
          works: [
            {
              label: "a.invalid work A",
              episodes: 2,
              captureMode: "contiguous",
              constantColumnWidth: true,
            },
          ],
        },
      },
      /band\.provenance\.work\.label\.link.*works\[0\]\.label/s,
    ],
    [
      "work-title.json",
      {
        provenance: {
          works: [
            {
              label: "work A",
              episodes: 2,
              captureMode: "contiguous",
              constantColumnWidth: true,
              title: "not a field",
            },
          ],
        },
      },
      /band\.unexpected-field.*works\[0\]\.title/s,
    ],
  ];
  for (const [file, extra, expected] of cases) {
    await writeFile(
      join(workdir, file),
      JSON.stringify({ bandFormat: 1, metrics: { gutterRatio: { min: 0, max: 1 } }, ...extra }),
    );
    const c = capture();
    assert.equal(
      await runMeasure([dir, "--episode", "ep-001", "--against", join(workdir, file)], c.io),
      EXIT_USAGE,
      file,
    );
    assert.match(c.err.join("\n"), expected, file);
  }
});
