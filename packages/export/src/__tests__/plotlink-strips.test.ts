import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Canvas, createCanvas, loadImage } from "@napi-rs/canvas";
import { writeCuts, writeProject } from "@toony/project-io";
import { layoutTransition, resolveBandHeight } from "@toony/render";
import { resolveReferenceWidth } from "@toony/schema";
import {
  buildExportProject,
  buildManyCutsProject,
  writeCutImages,
} from "../__fixtures__/project.js";
import { ExportError } from "../errors.js";
import { sha256Hex } from "../manifest.js";
import { encodePlotlinkStrips, WEBP_DIMENSION_MAX } from "../plotlink-strips.js";
import { exportPlotlink, stitchEpisode } from "../targets.js";

/** Compare actual decoded strip pixels with independently cropped stitched pixels. */
async function assertStripPixels(
  bytes: Uint8Array,
  page: Canvas,
  y: number,
  height: number,
  quality: number,
) {
  const expected = createCanvas(page.width, height);
  expected.getContext("2d").drawImage(page, 0, y, page.width, height, 0, 0, page.width, height);
  const decodedExpected = await loadImage(expected.toBuffer("image/webp", quality));
  const decodedActual = await loadImage(Buffer.from(bytes));
  assert.equal(decodedActual.width, page.width);
  assert.equal(decodedActual.height, height);
  const actual = createCanvas(page.width, height);
  actual.getContext("2d").drawImage(decodedActual, 0, 0);
  expected.getContext("2d").drawImage(decodedExpected, 0, 0);
  assert.deepEqual(
    actual.getContext("2d").getImageData(0, 0, page.width, height).data,
    expected.getContext("2d").getImageData(0, 0, page.width, height).data,
  );
}

test("mixed cut art, lettering and transitions survive ordered packing at 800px", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "toony-strip-sequence-")), "project");
  const project = buildManyCutsProject(21);
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const rich = buildExportProject().episodes[0];
  assert.ok(rich);
  const transition = rich.transitions[0];
  const lettering = rich.lettering[0];
  assert.ok(transition && lettering);
  bundle.episode.sequence = [];
  for (const [i, cut] of bundle.cuts.entries()) {
    // Two known art assets with different colors; declared fallback heights
    // alternate on the other cuts to exercise variable-height packing.
    if (i < 2) cut.image = rich.cuts[i]?.image ?? null;
    cut.panelAspect = [0.6, 1.4, 2][i % 3];
    bundle.lettering.push({
      ...lettering,
      id: `letter-${i}`,
      cutId: cut.id,
      text: `Reading-order cut ${i + 1}: the lantern is still lit.`,
    });
    bundle.episode.sequence.push({ type: "cut", id: cut.id });
    if (i === bundle.cuts.length - 1) continue;
    const band = {
      ...transition,
      id: `band-${i}`,
      gutterHeight: 120 + i,
      text: `Transition ${i + 1}`,
    };
    bundle.transitions.push(band);
    bundle.episode.sequence.push({ type: "transition", id: band.id });
  }
  // Physical record order must not determine reading order.
  bundle.cuts.reverse();
  bundle.transitions.reverse();
  await writeProject(root, project);
  await writeCutImages(root);
  const canonicalPaths = [
    "webtoon.json",
    ...["episode.yaml", "cuts.yaml", "transitions.yaml", "lettering.json"].map(
      (name) => `episodes/ep-001/${name}`,
    ),
  ];
  const before = await Promise.all(canonicalPaths.map((path) => readFile(join(root, path))));
  const stitched = await stitchEpisode(root, "ep-001", 800);
  const out = await exportPlotlink(root, "ep-001", { width: 800, quality: 82 });
  assert.equal(out.manifest.episodeId, "ep-001");
  assert.ok(out.manifest.files.length > 1 && out.manifest.files.length <= 20);
  const boundaries = new Set<number>();
  let boundary = 0;
  for (const item of bundle.episode.sequence) {
    if (item.type === "cut") {
      const cut = bundle.cuts.find((cut) => cut.id === item.id);
      assert.ok(cut);
      boundary += cut.image ? 1120 : Math.round(800 * (cut.panelAspect ?? 1.4));
    } else {
      const transition = bundle.transitions.find((transition) => transition.id === item.id);
      assert.ok(transition);
      boundary += resolveBandHeight(
        layoutTransition(transition),
        800,
        resolveReferenceWidth(project.webtoon.referenceWidth),
      );
    }
    boundaries.add(boundary);
  }
  let y = 0;
  for (const file of out.manifest.files) {
    assert.equal(file.width, 800);
    assert.equal(file.quality, 82);
    assert.ok(file.height <= WEBP_DIMENSION_MAX);
    const bytes = await readFile(join(root, file.path));
    assert.ok(bytes.length <= 1_000_000);
    assert.equal(file.byteSize, bytes.length);
    assert.equal(file.sha256, sha256Hex(bytes));
    await assertStripPixels(bytes, stitched.canvas, y, file.height, 82);
    y += file.height;
    assert.ok(boundaries.has(y), "normal bands must remain whole at strip boundaries");
  }
  assert.equal(y, stitched.height);
  const cutHeight = bundle.cuts.reduce(
    (sum, cut) => sum + (cut.image ? 1120 : Math.round(800 * (cut.panelAspect ?? 1.4))),
    0,
  );
  const transitionHeight = bundle.transitions.reduce(
    (sum, transition) =>
      sum +
      resolveBandHeight(
        layoutTransition(transition),
        800,
        resolveReferenceWidth(project.webtoon.referenceWidth),
      ),
    0,
  );
  assert.ok(transitionHeight > 0);
  assert.equal(y, cutHeight + transitionHeight);
  assert.deepEqual(
    await Promise.all(canonicalPaths.map((path) => readFile(join(root, path)))),
    before,
  );
});

test("a 60-cut 800px episode exports at unchanged width and quality", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "toony-sixty-strips-")), "project");
  const project = buildManyCutsProject(60);
  await writeProject(root, project);
  const out = await exportPlotlink(root, "ep-001");
  assert.ok(out.manifest.files.length <= 20);
  assert.equal(
    out.manifest.files.reduce((sum, file) => sum + file.height, 0),
    60 * 1120,
  );
  for (const file of out.manifest.files) {
    const image = await loadImage(await readFile(join(root, file.path)));
    assert.equal(image.width, 800);
    assert.equal(image.height, file.height);
    assert.ok(image.height <= WEBP_DIMENSION_MAX);
    assert.ok(file.byteSize <= 1_000_000);
    assert.equal(file.quality, 82);
  }
});

test("an oversized single band is sliced into exact non-overlapping integer rows", async () => {
  const page = createCanvas(24, WEBP_DIMENSION_MAX * 2 + 9);
  const ctx = page.getContext("2d");
  for (let y = 0; y < page.height; y++) {
    ctx.fillStyle = `rgb(${y % 251}, ${(y * 7) % 251}, ${(y * 13) % 251})`;
    ctx.fillRect(0, y, page.width, 1);
  }
  const strips = encodePlotlinkStrips([{ canvas: page, height: page.height }], page.width, 91);
  assert.deepEqual(
    strips.map((strip) => strip.height),
    [WEBP_DIMENSION_MAX, WEBP_DIMENSION_MAX, 9],
  );
  let y = 0;
  for (const strip of strips) {
    await assertStripPixels(strip.bytes, page, y, strip.height, 91);
    y += strip.height;
  }
  assert.equal(y, page.height);
});

test("a byte-heavy single band splits without lowering quality or width", async () => {
  const page = createCanvas(800, 2400);
  const ctx = page.getContext("2d");
  const pixels = ctx.createImageData(page.width, page.height);
  let state = 299;
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels.data[i + c] = state >>> 24;
    }
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  assert.ok(page.toBuffer("image/webp", 82).length > 1_000_000);
  const strips = encodePlotlinkStrips([{ canvas: page, height: page.height }], 800, 82);
  assert.ok(strips.length > 1);
  let y = 0;
  for (const strip of strips) {
    assert.equal(strip.width, 800);
    assert.equal(strip.quality, 82);
    assert.ok(strip.bytes.length <= 1_000_000);
    await assertStripPixels(strip.bytes, page, y, strip.height, 82);
    y += strip.height;
  }
  assert.equal(y, page.height);
});

test("packing refuses a 21st strip instead of truncating the remaining sequence", () => {
  const canvas = createCanvas(1, WEBP_DIMENSION_MAX);
  const bands = Array.from({ length: 21 }, () => ({ canvas, height: canvas.height }));
  assert.throws(
    () => encodePlotlinkStrips(bands, 1, 82),
    (error: unknown) => error instanceof ExportError && error.code === "plotlink.cannot-fit",
  );
  assert.equal(canvas.height, WEBP_DIMENSION_MAX);
});

test("failed fit keeps previous artifacts; shorter re-export removes only owned stale files", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "toony-strip-replace-")), "project");
  const project = buildManyCutsProject(42);
  await writeProject(root, project);
  const first = await exportPlotlink(root, "ep-001");
  assert.ok(first.manifest.files.length > 1);
  await writeFile(join(first.outDir, "user-notes.txt"), "Keep this user file.");
  await writeFile(join(first.outDir, "999.webp"), "Unrelated numbered user file.");
  const before = new Map(
    await Promise.all(
      (await readdir(first.outDir)).map(
        async (name) => [name, await readFile(join(first.outDir, name))] as const,
      ),
    ),
  );
  const cuts = project.episodes[0]?.cuts;
  assert.ok(cuts);
  for (const cut of cuts) cut.panelAspect = 10;
  await writeCuts(root, "ep-001", cuts);
  await assert.rejects(
    () => exportPlotlink(root, "ep-001"),
    (error: unknown) => error instanceof ExportError && error.code === "plotlink.cannot-fit",
  );
  assert.deepEqual(await readdir(first.outDir), [...before.keys()]);
  for (const [name, bytes] of before)
    assert.deepEqual(await readFile(join(first.outDir, name)), bytes);
  for (const cut of cuts) cut.panelAspect = 0.1;
  await writeCuts(root, "ep-001", cuts);
  const next = await exportPlotlink(root, "ep-001");
  assert.equal(next.manifest.files.length, 1);
  assert.deepEqual((await readdir(first.outDir)).sort(), [
    "001.webp",
    "999.webp",
    "episode.md",
    "manifest.json",
    "user-notes.txt",
  ]);
  assert.equal(
    await readFile(join(first.outDir, "user-notes.txt"), "utf8"),
    "Keep this user file.",
  );
  assert.equal(
    await readFile(join(first.outDir, "999.webp"), "utf8"),
    "Unrelated numbered user file.",
  );
});

test("an unowned file collision is preserved and WebP width is checked before encoding", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "toony-strip-conflict-")), "project");
  await writeProject(root, buildManyCutsProject(21));
  const outDir = join(root, "episodes/ep-001/exports/plotlink");
  await writeFile(join(outDir, "001.webp"), "User-owned image.");
  await assert.rejects(
    () => exportPlotlink(root, "ep-001"),
    (error: unknown) => error instanceof ExportError && error.code === "plotlink.output-conflict",
  );
  assert.equal(await readFile(join(outDir, "001.webp"), "utf8"), "User-owned image.");
  await assert.rejects(
    () => exportPlotlink(root, "ep-001", { width: WEBP_DIMENSION_MAX + 1 }),
    (error: unknown) => error instanceof ExportError && error.code === "plotlink.invalid-width",
  );
  assert.deepEqual(await readdir(outDir), ["001.webp"]);
});
