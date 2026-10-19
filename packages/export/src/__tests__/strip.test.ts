// The episode strip: one image equal to the stitched page, or parts that restack
// to exactly the same pixels, breaking between whole bands where they fit.

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { LEGACY_EXPORT_DIRS, writeCuts, writeLettering, writeProject } from "@toony/project-io";
import {
  buildManyCutsProject,
  buildSequenceProject,
  writeSequenceImages,
} from "../__fixtures__/project.js";
import { encodeCanvas } from "../encode.js";
import { ExportError } from "../errors.js";
import { readImageDimensions } from "../image-dimensions.js";
import { episodeInputsHash, loadEpisode, loadedBands } from "../load.js";
import { sha256Hex, validateManifest } from "../manifest.js";
import { exportStrip, exportWithPreset } from "../outputs.js";
import { resolveExportPreset } from "../presets.js";
import { stitchEpisode } from "../targets.js";
import { assertSamePixels, decodePixels, regionPixels } from "./pixels.js";

async function sequenceProject(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "toony-strip-")), "project");
  await writeProject(root, buildSequenceProject());
  await writeSequenceImages(root);
  return root;
}

/** Row offsets where one band ends and the next begins, at `width`. */
async function bandBoundaries(root: string, width: number): Promise<Set<number>> {
  const bands = loadedBands(await loadEpisode(root, "ep-001"));
  const boundaries = new Set<number>([0]);
  let y = 0;
  for (const band of bands) {
    y += band.heightAt(width);
    boundaries.add(y);
  }
  return boundaries;
}

test("a whole strip is the stitched page, pixel for pixel", async () => {
  const root = await sequenceProject();
  const out = await exportStrip(root, "ep-001", { width: 800 });
  assert.deepEqual(validateManifest(out.manifest), []);
  const page = await stitchEpisode(root, "ep-001", 800);
  assert.equal(out.manifest.files.length, 1);
  const file = out.manifest.files[0];
  assert.ok(file);
  assert.equal(file.role, "strip");
  assert.equal(file.path, "episodes/ep-001/exports/strip/episode.png");
  assert.equal(file.height, page.height);
  const bytes = await readFile(join(root, file.path));
  assert.equal(file.sha256, sha256Hex(bytes));
  // Same encoder input, so the same bytes as encoding the stitched page.
  assert.equal(file.sha256, sha256Hex(encodeCanvas(page.canvas, "png")));
  // Every item of the sequence, in reading order, with its sequence position.
  assert.deepEqual(
    file.items.map((item) => `${item.index}:${item.id}`),
    [
      "0:cut-001",
      "1:tr-001",
      "2:cut-002",
      "3:tr-002",
      "4:cut-003",
      "5:tr-003",
      "6:cut-004",
      "7:tr-004",
      "8:cut-005",
    ],
  );
});

test("strip parts restack to the full strip exactly and break between whole bands", async () => {
  const root = await sequenceProject();
  const page = await stitchEpisode(root, "ep-001", 800);
  const out = await exportStrip(root, "ep-001", { width: 800, sliceHeight: 1000 });
  assert.deepEqual(validateManifest(out.manifest), []);
  assert.ok(out.manifest.files.length > 3);
  const boundaries = await bandBoundaries(root, 800);
  let y = 0;
  for (const [i, file] of out.manifest.files.entries()) {
    assert.equal(file.role, "slice");
    assert.equal(file.path, `episodes/ep-001/exports/strip/${String(i + 1).padStart(3, "0")}.png`);
    assert.equal(file.width, 800);
    assert.ok(file.height <= 1000);
    const decoded = await decodePixels(await readFile(join(root, file.path)));
    assert.equal(decoded.height, file.height);
    assertSamePixels(decoded.data, regionPixels(page.canvas, 0, y, 800, file.height), file.path);
    y += file.height;
    // A part ends between bands unless the band it ends in is taller than a part.
    const partial = file.items.at(-1);
    if (!boundaries.has(y)) assert.ok(partial?.height !== undefined && partial.top !== undefined);
  }
  assert.equal(y, page.height);
  // cut-004 (aspect 3, 2400 rows) is the one band split across parts, at exact rows.
  const rows = out.manifest.files
    .flatMap((file) => file.items)
    .filter((item) => item.id === "cut-004")
    .map((item) => [item.top, item.height]);
  assert.deepEqual(rows, [
    [0, 1000],
    [1000, 1000],
    [2000, 400],
  ]);
});

test("a byte cap is met by real encodes without lowering width or quality", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "toony-strip-cap-")), "project");
  const project = buildManyCutsProject(2);
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.image = { clean: "episodes/ep-001/assets/clean/noise.png", final: null };
  await writeProject(root, project);
  // Noise does not compress, so one band is far over the cap on its own.
  const noise = createCanvas(400, 1200);
  const ctx = noise.getContext("2d");
  const pixels = ctx.createImageData(400, 1200);
  let state = 299;
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels.data[i + c] = state >>> 24;
    }
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  await writeFile(
    join(root, "episodes/ep-001/assets/clean/noise.png"),
    noise.toBuffer("image/png"),
  );
  const page = await stitchEpisode(root, "ep-001", 400);
  const out = await exportStrip(root, "ep-001", {
    width: 400,
    sliceHeight: 2000,
    maxBytes: 300_000,
  });
  assert.ok(out.manifest.files.length > 3);
  let y = 0;
  for (const file of out.manifest.files) {
    assert.equal(file.width, 400);
    assert.ok(file.byteSize <= 300_000, `${file.path} is ${file.byteSize} bytes`);
    const decoded = await decodePixels(await readFile(join(root, file.path)));
    assertSamePixels(decoded.data, regionPixels(page.canvas, 0, y, 400, file.height), file.path);
    y += file.height;
  }
  assert.equal(y, page.height);
  assert.equal(out.manifest.options.maxBytes, 300_000);
});

test("the webtoon preset writes 800 px JPEG parts of at most 1280 px at quality 90", async () => {
  const root = await sequenceProject();
  const preset = await resolveExportPreset("webtoon");
  assert.ok(preset);
  const out = await exportWithPreset(root, "ep-001", preset);
  assert.deepEqual(validateManifest(out.manifest), []);
  assert.equal(out.manifest.kind, "strip");
  assert.equal(out.manifest.output, "webtoon");
  const page = await stitchEpisode(root, "ep-001", 800);
  let total = 0;
  for (const [i, file] of out.manifest.files.entries()) {
    assert.equal(
      file.path,
      `episodes/ep-001/exports/webtoon/${String(i + 1).padStart(3, "0")}.jpg`,
    );
    assert.equal(file.format, "jpeg");
    assert.equal(file.quality, 90);
    assert.ok(file.height <= 1280);
    const bytes = new Uint8Array(await readFile(join(root, file.path)));
    assert.deepEqual(readImageDimensions(bytes), {
      format: "jpeg",
      width: 800,
      height: file.height,
    });
    total += file.height;
  }
  assert.equal(total, page.height);
  // An explicit option overrides what the preset pins.
  const wider = await exportWithPreset(root, "ep-001", preset, { width: 1000 });
  assert.equal(wider.manifest.width, 1000);
  assert.ok(wider.manifest.files.every((file) => file.height <= 1280 && file.quality === 90));
});

test("a strip too large for one page still exports in parts", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "toony-strip-tall-")), "project");
  const project = buildManyCutsProject(20);
  for (const cut of project.episodes[0]?.cuts ?? []) cut.panelAspect = 10;
  await writeProject(root, project);
  // One 1000 x 200,000 page is over the working-set budget...
  await assert.rejects(
    () => exportStrip(root, "ep-001", { width: 1000 }),
    (error: unknown) => error instanceof ExportError && error.code === "raster-too-large",
  );
  // ...but parts never hold the page, only one part and the bands it draws.
  const out = await exportStrip(root, "ep-001", { width: 1000, sliceHeight: 5000 });
  assert.equal(out.manifest.files.length, 40);
  assert.ok(out.manifest.files.every((file) => file.width === 1000 && file.height === 5000));
});

test("a failed export keeps the previous output; a shorter one removes only owned stale files", async () => {
  const root = await sequenceProject();
  const first = await exportStrip(root, "ep-001", { width: 400, sliceHeight: 300 });
  assert.ok(first.manifest.files.length > 4);
  await writeFile(join(first.outDir, "notes.txt"), "Keep this note.");
  const before = new Map(
    await Promise.all(
      (await readdir(first.outDir)).map(
        async (name) => [name, await readFile(join(first.outDir, name))] as const,
      ),
    ),
  );
  await assert.rejects(
    () => exportStrip(root, "ep-001", { width: 400, sliceHeight: 300, maxBytes: 100 }),
    (error: unknown) => error instanceof ExportError && error.code === "strip.cannot-fit",
  );
  assert.deepEqual((await readdir(first.outDir)).sort(), [...before.keys()].sort());
  for (const [name, bytes] of before) {
    assert.deepEqual(await readFile(join(first.outDir, name)), bytes);
  }
  const next = await exportStrip(root, "ep-001", { width: 400 });
  assert.equal(next.manifest.files.length, 1);
  assert.deepEqual((await readdir(first.outDir)).sort(), [
    "episode.png",
    "manifest.json",
    "notes.txt",
  ]);
  assert.equal(await readFile(join(first.outDir, "notes.txt"), "utf8"), "Keep this note.");
  // No staging or backup folder is left behind.
  assert.deepEqual(await readdir(join(root, "episodes/ep-001/exports")), ["strip"]);
});

test("the manifest records the inputs hash, which changes when the episode changes", async () => {
  const root = await sequenceProject();
  const out = await exportStrip(root, "ep-001", { width: 400 });
  const current = await episodeInputsHash(root, "ep-001");
  assert.equal(out.manifest.inputs.sha256, current);
  const again = await exportStrip(root, "ep-001", { width: 400 });
  assert.equal(again.manifest.files[0]?.sha256, out.manifest.files[0]?.sha256);
  const project = buildSequenceProject();
  // Fields that never reach the pixels do not make the export out of date.
  const cuts = project.episodes[0]?.cuts ?? [];
  for (const cut of cuts) cut.imagePrompt = "A different prompt.";
  await writeCuts(root, "ep-001", cuts);
  assert.equal(await episodeInputsHash(root, "ep-001"), current);
  const lettering = project.episodes[0]?.lettering ?? [];
  const first = lettering[0];
  assert.ok(first);
  first.text = "A changed line.";
  await writeLettering(root, "ep-001", lettering);
  assert.notEqual(await episodeInputsHash(root, "ep-001"), current);
  assert.equal(await episodeInputsHash(root, "ep-404"), null);
});

test("an art-less cut is a warning, not an error", async () => {
  const root = await sequenceProject();
  const out = await exportStrip(root, "ep-001", { width: 400 });
  assert.deepEqual(out.manifest.warnings, [
    {
      code: "artless-cuts",
      message: "2 cuts have no artwork yet: Cut 3 and Cut 4. They export as plain panels.",
      items: ["cut-003", "cut-004"],
    },
  ]);
});

test("a size cap needs a part height, and a legacy folder name is not an output", async () => {
  const root = await sequenceProject();
  await assert.rejects(
    () => exportStrip(root, "ep-001", { maxBytes: 500_000 }),
    (error: unknown) => error instanceof ExportError && error.code === "strip.size-cap-needs-parts",
  );
  for (const output of [...LEGACY_EXPORT_DIRS, "../escape"]) {
    await assert.rejects(
      () => exportStrip(root, "ep-001", {}, { output }),
      (error: unknown) => error instanceof ExportError && error.code === "export.invalid-output",
    );
  }
});
