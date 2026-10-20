// The sixty-cut scale fixture (#314): control flow, output volume and stage
// wall-clock, recorded for every shipped stage, at sixty cuts. Nothing else.
//
// The run builds the synthetic episode into a scratch directory, drives the real
// command surface over it, records exit code, whole-second wall-clock and output
// volume per stage, and prints one record the release gate retains in its test
// log. Timings are recorded and never gated: a verdict that moved with the
// machine's speed would not be a verdict. Each stage carries a liveness guard,
// which stops a run that is no longer making progress and says nothing about a
// slow one.
//
// The limits clause is printed with the record on every run and its presence is
// asserted here, so a number quoted from this output travels with its limits.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CANVAS_PIXELS_MAX,
  EPISODE_RASTER_BYTES_MAX,
  IMAGE_FILE_BYTES_MAX,
  IMAGE_PIXELS_MAX,
  RASTER_DIMENSION_MAX,
} from "@toony/export";
import { loadProject, writeProject } from "@toony/project-io";
import { SHOT_TYPES, validateProject } from "@toony/schema";
import {
  BEAT_COUNT,
  beatSpecs,
  buildSixtyCutProject,
  cutId,
  EPISODE_ID,
  LIMITS_CLAUSE,
  SIXTY,
  SOURCE_WIDTH_PX,
  sixtyCutPlan,
  structureImagePng,
} from "../../__fixtures__/sixty-cuts.js";
import { runImportImage } from "../../commands/import-image.js";
import { EXIT_OK } from "../../exit.js";

const CLI = fileURLToPath(new URL("../../bin.js", import.meta.url));

/**
 * Liveness guards, in ms: a stage that has not finished by then has stopped
 * making progress and the run says so. They are not time budgets; the recorded
 * timings are never compared to them or to anything else.
 */
const LIVENESS_COMPOSE_MS = 600_000;
const LIVENESS_OTHER_MS = 120_000;

/**
 * The exact lint result the fixture produces, as "severity code" to count,
 * pinned so a changed finding set fails the run. Both lint commands produce
 * this same multiset over the one episode. It is EMPTY, and asserted as empty:
 * the sixty structure images pass every shipped image check and the varied
 * shapes, shot types and gap heights trip no craft rule. An empty result on its
 * own is not evidence the stage ran, which is why the stage's exit code, its
 * output size and its text report's line count are recorded beside it.
 */
const EXPECTED_LINT: Record<string, number> = {};

/** The five page-geometry metrics both plan forms must agree on. */
const GEOMETRY = [
  "gutterRatio",
  "gutterMedian",
  "panelHeightMedian",
  "panelHeightSpread",
  "panelsPerScreen",
] as const;
/** Relative tolerance for the two plan forms, asserted in code. */
const PLAN_AGREEMENT = 0.01;

interface StageRecord {
  stage: string;
  command: string;
  exit: number | null;
  seconds: number;
  ms: number;
  [extra: string]: unknown;
}

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-sixty-cuts-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function spawnStage(args: string[], timeout: number) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: workdir,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  assert.equal(result.error, undefined, `toony ${args[0]}: ${String(result.error)}`);
  assert.equal(
    result.signal,
    null,
    `toony ${args[0]} stopped making progress and hit the ${timeout} ms liveness guard`,
  );
  return { ...result, ms };
}

async function volume(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { files, bytes };
  }
  for (const name of entries) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      const inner = await volume(full);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files += 1;
      bytes += info.size;
    }
  }
  return { files, bytes };
}

function multiset(findings: Array<{ severity: string; code: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const key = `${f.severity} ${f.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

async function manifestOf(root: string, target: string) {
  const dir = join(root, "episodes", EPISODE_ID, "exports", target);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
    files: Array<{ path: string; width: number; height: number; byteSize: number; post?: number }>;
  };
  return { dir, manifest, ...(await volume(dir)) };
}

test("sixty cuts run every shipped stage in order, and the run records what each emitted and how long it took", async () => {
  const root = join(workdir, "sixty");
  const stages: StageRecord[] = [];
  const record = (stage: StageRecord): void => {
    stages.push(stage);
    const { stage: name, command, exit, seconds: s, ms, ...extra } = stage;
    console.log(
      `scale-fixture: ${name} exit=${exit} seconds=${s} ms=${ms} ${JSON.stringify(extra)} (${command})`,
    );
  };

  // --- build: the fixture's own stage. Sixty records, valid by construction. ---
  let started = Date.now();
  const project = buildSixtyCutProject();
  const built = validateProject(project);
  assert.deepEqual(built.issues, []);
  await writeProject(root, project);
  // The scale is pinned here and nowhere else: every later criterion records a
  // number a smaller fixture would carry down with it.
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes.find((e) => e.episode.id === EPISODE_ID);
  assert.ok(bundle, `the written project has no episode ${EPISODE_ID}`);
  const cutsBuilt = bundle.cuts.length;
  assert.equal(
    cutsBuilt,
    SIXTY,
    `the fixture built ${cutsBuilt} cuts; the scale this fixture is pinned at is ${SIXTY}`,
  );
  assert.equal(bundle.transitions.length, SIXTY - 1);
  assert.equal(bundle.episode.sequence.length, SIXTY * 2 - 1);
  assert.equal(loaded.validation.valid, true);
  const projectVolume = await volume(root);
  record({
    stage: "build",
    command: "writeProject + loadProject",
    exit: 0,
    seconds: seconds(Date.now() - started),
    ms: Date.now() - started,
    cuts: cutsBuilt,
    transitions: bundle.transitions.length,
    ...projectVolume,
  });

  // --- validate ---
  let r = spawnStage(["validate", root, "--json"], LIVENESS_OTHER_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const validated = JSON.parse(r.stdout) as { valid: boolean; issueCount?: number };
  assert.equal(validated.valid, true);
  record({
    stage: "validate",
    command: "toony validate --json",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    outputChars: r.stdout.length,
  });

  // --- plan, from the episode's own declarations ---
  r = spawnStage(["plan", root, "--episode", EPISODE_ID, "--json"], LIVENESS_OTHER_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const fromEpisode = JSON.parse(r.stdout) as {
    cuts: number;
    cutsWithoutDeclaredShape: number;
    width: number;
    height: number;
    metrics: Record<string, number>;
  };
  assert.equal(fromEpisode.cuts, SIXTY);
  assert.equal(fromEpisode.cutsWithoutDeclaredShape, 0);
  record({
    stage: "plan-episode",
    command: "toony plan --episode --json",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    width: fromEpisode.width,
    height: fromEpisode.height,
    metrics: pick(fromEpisode.metrics),
  });

  // --- plan, from beats with lengths ---
  const specPath = join(workdir, "sixty-cut-plan.json");
  await writeFile(specPath, JSON.stringify(sixtyCutPlan(), null, 2));
  r = spawnStage(["plan", root, "--spec", specPath, "--json"], LIVENESS_OTHER_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const fromBeats = JSON.parse(r.stdout) as {
    cuts: number;
    beats: Array<{ label: string; cuts: number; lengthInWidths: number }> | null;
    metrics: Record<string, number>;
  };
  assert.equal(fromBeats.cuts, SIXTY);
  assert.equal(fromBeats.beats?.length, BEAT_COUNT);
  // The two forms describe one episode, so their geometry agrees within the
  // tolerance above. This proves agreement; it does not pin the scale.
  const agreement: Record<string, { episode: number; beats: number }> = {};
  for (const metric of GEOMETRY) {
    const a = fromEpisode.metrics[metric];
    const b = fromBeats.metrics[metric];
    assert.equal(typeof a, "number", metric);
    assert.equal(typeof b, "number", metric);
    agreement[metric] = { episode: a as number, beats: b as number };
    const allowed = Math.max(0.002, PLAN_AGREEMENT * Math.abs(a as number));
    assert.ok(
      Math.abs((a as number) - (b as number)) <= allowed,
      `${metric}: the episode form gives ${a} and the beats form ${b}; they differ by more than ${allowed}`,
    );
  }
  const beatLengths = (fromBeats.beats ?? []).map((b) => b.lengthInWidths);
  record({
    stage: "plan-beats",
    command: "toony plan --spec --json",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    beats: fromBeats.beats?.length,
    beatLengthRange: [Math.min(...beatLengths), Math.max(...beatLengths)],
    agreement,
  });

  // --- import x60: the manual provider, in process, the same `runImportImage`
  // the binary runs. Generation wall-clock is NOT measured by this stage or any
  // other: the images are drawn structure, and this timing is ingest alone. ---
  const sources = join(workdir, "sources");
  await mkdir(sources);
  const imageHeights: number[] = [];
  const imageBytes: number[] = [];
  started = Date.now();
  let drawMs = 0;
  const specs = beatSpecs();
  for (let k = 0; k < SIXTY; k++) {
    const aspect = specs[Math.floor(k / 3)]?.aspect as number;
    const drawStarted = Date.now();
    const png = structureImagePng(k, aspect);
    drawMs += Date.now() - drawStarted;
    const file = join(sources, `${cutId(k)}.png`);
    await writeFile(file, png);
    imageHeights.push(Math.round(SOURCE_WIDTH_PX * aspect));
    imageBytes.push(png.length);
    const err: string[] = [];
    const exit = await runImportImage(
      [root, "--episode", EPISODE_ID, "--cut", cutId(k), "--from", file],
      { cwd: workdir, out: () => {}, err: (line) => err.push(line) },
    );
    assert.equal(exit, EXIT_OK, `import ${cutId(k)}: ${err.join("\n")}`);
  }
  const importMs = Date.now() - started - drawMs;
  const ingestLog = JSON.parse(
    await readFile(join(root, "episodes", EPISODE_ID, "logs", "ingest.json"), "utf8"),
  ) as Array<{ source?: string; providerId?: string }>;
  assert.equal(ingestLog.length, SIXTY);
  assert.ok(
    ingestLog.every((entry) => entry.source === "manual"),
    "every ingest records the manual source",
  );
  const assets = await volume(join(root, "episodes", EPISODE_ID, "assets"));
  assert.equal(assets.files, SIXTY);
  const afterImport = await loadProject(root);
  const imported = afterImport.project.episodes[0]?.cuts ?? [];
  assert.equal(imported.filter((c) => c.image?.clean !== null && c.image !== null).length, SIXTY);
  assert.ok(imported.every((c) => c.reviewStatus === "draft"));
  record({
    stage: "import",
    command: "runImportImage x60 (manual provider, in process)",
    exit: 0,
    seconds: seconds(importMs),
    ms: importMs,
    drawMs,
    ...assets,
    imageWidth: SOURCE_WIDTH_PX,
    imageHeightRange: [Math.min(...imageHeights), Math.max(...imageHeights)],
    imageBytesRange: [Math.min(...imageBytes), Math.max(...imageBytes)],
    generationWallClock: "not measured: no model provider runs in this fixture",
  });

  // --- lint, project and episode ---
  for (const [stage, args, command] of [
    ["lint", ["lint", root, "--json"], "toony lint --json"],
    [
      "lint-episode",
      ["lint-episode", EPISODE_ID, root, "--json"],
      "toony lint-episode <id> --json",
    ],
  ] as const) {
    r = spawnStage([...args], LIVENESS_OTHER_MS);
    const report = JSON.parse(r.stdout) as {
      clean: boolean;
      findingCount: number;
      findings: Array<{ severity: string; code: string }>;
    };
    const found = multiset(report.findings);
    assert.deepEqual(
      found,
      EXPECTED_LINT,
      `${stage}: the finding multiset changed; pin the new one with its reason`,
    );
    assert.equal(r.status, report.clean ? EXIT_OK : 1, r.stderr);
    const text = spawnStage([...args.filter((a) => a !== "--json")], LIVENESS_OTHER_MS);
    record({
      stage,
      command,
      exit: r.status,
      seconds: seconds(r.ms),
      ms: r.ms,
      findings: report.findingCount,
      bySeverityAndCode: found,
      jsonChars: r.stdout.length,
      textLines: text.stdout.split("\n").length,
    });
  }

  // --- measure: the whole page composed in memory at the default width ---
  r = spawnStage(["measure", root, "--episode", EPISODE_ID, "--json"], LIVENESS_COMPOSE_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const measured = JSON.parse(r.stdout) as {
    width: number;
    height: number;
    cuts: number;
    cutsWithoutImage: number;
    metrics: Record<string, number>;
  };
  assert.equal(measured.cuts, SIXTY);
  assert.equal(measured.cutsWithoutImage, 0);
  record({
    stage: "measure",
    command: "toony measure --episode --json",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    pageWidth: measured.width,
    pageHeight: measured.height,
    pagePixels: measured.width * measured.height,
    metrics: pick(measured.metrics),
    caps: {
      IMAGE_FILE_BYTES_MAX,
      IMAGE_PIXELS_MAX,
      CANVAS_PIXELS_MAX,
      RASTER_DIMENSION_MAX,
      EPISODE_RASTER_BYTES_MAX,
    },
  });

  // --- export strip, cuts, webtoon parts, Instagram frames ---
  r = spawnStage(["export", EPISODE_ID, root, "--output", "strip"], LIVENESS_COMPOSE_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const strip = await manifestOf(root, "strip");
  assert.ok(strip.manifest.files.length >= 1);
  record({
    stage: "export-strip",
    command: "toony export <episode> --output strip",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    files: strip.files,
    bytes: strip.bytes,
    pages: strip.manifest.files.map((f) => [f.width, f.height, f.byteSize]),
  });

  r = spawnStage(["export", EPISODE_ID, root, "--output", "cuts"], LIVENESS_COMPOSE_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const cuts = await manifestOf(root, "cuts");
  assert.equal(cuts.manifest.files.length, SIXTY);
  const cutHeights = cuts.manifest.files.map((f) => f.height);
  record({
    stage: "export-cuts",
    command: "toony export <episode> --output cuts",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    files: cuts.files,
    bytes: cuts.bytes,
    cutFiles: cuts.manifest.files.length,
    cutHeightRange: [Math.min(...cutHeights), Math.max(...cutHeights)],
  });

  r = spawnStage(["export", EPISODE_ID, root, "--output", "webtoon"], LIVENESS_COMPOSE_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const webtoon = await manifestOf(root, "webtoon");
  assert.ok(webtoon.manifest.files.every((f) => f.width === 800 && f.height <= 1280));
  record({
    stage: "export-webtoon",
    command: "toony export <episode> --output webtoon",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    files: webtoon.files,
    bytes: webtoon.bytes,
    parts: webtoon.manifest.files.length,
    partRows: webtoon.manifest.files.reduce((sum, f) => sum + f.height, 0),
  });

  r = spawnStage(["export", EPISODE_ID, root, "--output", "instagram"], LIVENESS_COMPOSE_MS);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const instagram = await manifestOf(root, "instagram");
  assert.ok(instagram.manifest.files.every((f) => f.width === 1080 && f.height === 1350));
  record({
    stage: "export-instagram",
    command: "toony export <episode> --output instagram",
    exit: r.status,
    seconds: seconds(r.ms),
    ms: r.ms,
    files: instagram.files,
    bytes: instagram.bytes,
    frames: instagram.manifest.files.length,
    posts: instagram.manifest.files.at(-1)?.post ?? 0,
  });

  // --- ranges: nothing the fixture records is a constant across its cuts ---
  const aspects = bundle.cuts.map((c) => c.panelAspect as number);
  const gaps = bundle.transitions.map((t) => t.gutterHeight);
  const kinds = new Set(bundle.transitions.map((t) => t.type));
  const shots = new Set(bundle.cuts.map((c) => c.shotType));
  const ranges = {
    panelAspect: {
      min: Math.min(...aspects),
      max: Math.max(...aspects),
      distinct: new Set(aspects).size,
    },
    gutterHeightPx: {
      min: Math.min(...gaps),
      max: Math.max(...gaps),
      distinct: new Set(gaps).size,
    },
    transitionKinds: [...kinds].sort(),
    shotTypes: [...shots].sort(),
    imageHeightPx: { min: Math.min(...imageHeights), max: Math.max(...imageHeights) },
    imageBytes: { min: Math.min(...imageBytes), max: Math.max(...imageBytes) },
  };
  assert.equal(ranges.panelAspect.distinct, BEAT_COUNT);
  assert.ok(ranges.gutterHeightPx.distinct > BEAT_COUNT);
  assert.equal(ranges.shotTypes.length, SHOT_TYPES.length);
  assert.ok(ranges.transitionKinds.length >= 9);
  assert.ok(ranges.imageHeightPx.min < ranges.imageHeightPx.max);
  assert.ok(ranges.imageBytes.min < ranges.imageBytes.max);

  // --- the record, with its limits ---
  const summary = {
    fixture: "sixty-cut synthetic scale fixture (#314)",
    cuts: cutsBuilt,
    node: process.version,
    stages,
    ranges,
    limits: LIMITS_CLAUSE,
  };
  const text = `scale-fixture-record ${JSON.stringify(summary)}\nscale-fixture-limits: ${LIMITS_CLAUSE}`;
  assert.ok(text.includes(LIMITS_CLAUSE), "the record carries the limits clause verbatim");
  console.log(text);
});

function pick(metrics: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of GEOMETRY) if (typeof metrics[name] === "number") out[name] = metrics[name];
  return out;
}
