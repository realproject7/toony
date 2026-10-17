// Spawn the actual CLI so native signal exits cannot masquerade as JS errors.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { buildInitialProject, writeProject } from "@toony/project-io";

const CLI = fileURLToPath(new URL("../bin.js", import.meta.url));
const MALFORMED_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080200000090773dfa0000000c4944415408d763f8cfc0000003010100b7b8b7bf0000000049454e44ae426082",
  "hex",
);
let workdir: string;
let allocationGuard: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-safe-raster-"));
  allocationGuard = join(workdir, "fixture-allocation-guard.cjs");
  // A regression must fail the test, not actually allocate the giant canvas.
  // Preload this only in the oversized-project controls, before the CLI imports
  // canvas, and stop at the first attempted large native allocation.
  await writeFile(
    allocationGuard,
    `
const canvas = require(${JSON.stringify(createRequire(import.meta.url).resolve("@napi-rs/canvas"))});
const original = canvas.createCanvas;
canvas.createCanvas = (width, height, ...rest) => {
  if (width * height > 1000000) {
    process.stderr.write('fixture allocation attempted: ' + width + ' x ' + height);
    process.exit(71);
  }
  return original(width, height, ...rest);
};
`,
  );
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function run(args: string[], guardAllocations = false) {
  return spawnSync(
    process.execPath,
    [...(guardAllocations ? ["--require", allocationGuard] : []), CLI, ...args],
    {
      cwd: workdir,
      encoding: "utf8",
      timeout: 20_000,
    },
  );
}

test("all real export targets and measure report the crashing art by cut, without a signal", async () => {
  const root = join(workdir, "corrupt-art");
  const project = buildInitialProject("corrupt-art", "romance");
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.image = { clean: "episodes/ep-001/assets/clean/broken.png", final: null };
  await writeProject(root, project);
  await writeFile(join(root, cut.image.clean as string), MALFORMED_PNG);
  for (const command of [
    ["export", "platform"],
    ["export", "stitched"],
    ["export", "plotlink"],
    ["measure"],
  ]) {
    const result = run([...command, root, "--episode", "ep-001"]);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stderr.includes(`cut "${cut.id}"`), result.stderr);
    assert.match(result.stderr, /could not be decoded safely/);
  }
});

test("a huge cut and a large aggregate page fail before creating any exported files", async () => {
  for (const aggregate of [false, true]) {
    const root = join(workdir, aggregate ? "aggregate" : "huge-cut");
    const project = buildInitialProject("allocation-fixture");
    const bundle = project.episodes[0];
    assert.ok(bundle);
    if (aggregate) {
      bundle.cuts = Array.from({ length: 20 }, (_, index) => ({
        id: `cut-${index}`,
        image: null,
        imagePrompt: "",
        negativePrompt: "",
        panelAspect: 10,
      }));
      bundle.transitions = [];
      bundle.episode.sequence = bundle.cuts.map((cut) => ({ type: "cut", id: cut.id }));
    }
    await writeProject(root, project);
    for (const command of [["export", "stitched"], ["measure"]]) {
      const result = run(
        [...command, root, "--episode", "ep-001", "--width", aggregate ? "1000" : "100000"],
        true,
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 2, result.stderr);
      assert.doesNotMatch(result.stderr, /fixture allocation attempted/);
      assert.match(
        result.stderr,
        aggregate ? /20 rasters, 1000 x 200000.*2048 MiB/ : /cut "cut-001".*100000 x 140000/,
      );
    }
    for (const target of ["platform", "stitched", "plotlink"]) {
      assert.deepEqual(await readdir(join(root, "episodes", "ep-001", "exports", target)), []);
    }
  }
});

test("a 60-cut episode still exports and measures at a small test width", async () => {
  const root = join(workdir, "sixty-cuts");
  const project = buildInitialProject("sixty-cuts");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.cuts = Array.from({ length: 60 }, (_, index) => ({
    id: `cut-${index}`,
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    panelAspect: 1.2,
  }));
  bundle.transitions = [];
  bundle.episode.sequence = bundle.cuts.map((cut) => ({ type: "cut", id: cut.id }));
  await writeProject(root, project);
  for (const command of [["export", "stitched"], ["measure"]]) {
    const result = run([...command, root, "--episode", "ep-001", "--width", "16"]);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
  }
});

test("real CLI exports valid JPEG marker fill from an external cwd without pixel drift", async () => {
  const root = join(workdir, "filled-jpeg");
  const project = buildInitialProject("filled-jpeg");
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.image = { clean: "episodes/ep-001/assets/clean/filled.jpg", final: null };
  await writeProject(root, project);
  const canvas = createCanvas(3, 5);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#376b91";
  ctx.fillRect(0, 0, 3, 5);
  const jpeg = canvas.toBuffer("image/jpeg");
  const filled = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff]), jpeg.subarray(2)]);
  let original: Buffer | undefined;
  for (const bytes of [jpeg, filled]) {
    await writeFile(join(root, cut.image.clean as string), bytes);
    const result = run(["export", "platform", root, "--episode", "ep-001", "--width", "12"]);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(join(root, "episodes/ep-001/exports/platform/001.png"));
    if (original) assert.deepEqual(output, original);
    else original = output;
  }
});
