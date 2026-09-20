import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildInitialProject } from "@toony/project-io";
import { composeCut } from "../compose.js";
import { ExportError } from "../errors.js";
import { assertRasterBudget, assertRasterSize, prepareImage } from "../raster-safety.js";

// The exact old pack-server fixture. It is intentionally malformed. Never
// decode it in the test runner: the native decoder can kill the whole process.
const MALFORMED_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080200000090773dfa0000000c4944415408d763f8cfc0000003010100b7b8b7bf0000000049454e44ae426082",
  "hex",
);

test("the crash fixture fails native decoding, but composition returns a named error", async () => {
  assert.equal(MALFORMED_PNG.length, 69);
  const unsafe = spawnSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      "require(process.argv[1]).loadImage(Buffer.from(process.argv[2], 'hex')).then(() => process.exit(0), () => process.exit(2));",
      createRequire(import.meta.url).resolve("@napi-rs/canvas"),
      MALFORMED_PNG.toString("hex"),
    ],
    { timeout: 10_000 },
  );
  assert.equal(unsafe.error, undefined);
  // SIGSEGV on the pinned macOS build; a platform that throws instead is also
  // a valid negative control. A future decoder accepting it requires revisiting
  // the fixture rather than silently losing the malformed-input coverage.
  assert.notEqual(unsafe.status, 0);
  await assert.rejects(
    () => composeCut([], MALFORMED_PNG, 100, { imageLabel: 'cut "broken-cut"' }),
    (error: unknown) =>
      error instanceof ExportError &&
      error.code === "invalid-image" &&
      error.message.includes('cut "broken-cut"'),
  );
});

test("safe decoding preserves the direct decoder's scaled pixels, including alpha", async () => {
  const canvas = createCanvas(31, 47);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 31, 47);
  gradient.addColorStop(0, "rgba(31,72,121,0.17)");
  gradient.addColorStop(1, "rgba(193,108,73,0.91)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 31, 47);
  const fixtures = [
    canvas.toBuffer("image/png"),
    canvas.toBuffer("image/jpeg"),
    await canvas.encode("webp"),
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  ];
  for (const bytes of fixtures) {
    // Only valid encoder-produced / known-valid GIF fixtures reach this direct
    // decoder, which reproduces the old composition path independently.
    const image = await loadImage(bytes);
    const width = 127;
    const height = Math.round((image.height * width) / image.width);
    const expected = createCanvas(width, height);
    expected.getContext("2d").drawImage(image, 0, 0, width, height);
    const actual = await composeCut([], bytes, width);
    assert.equal(actual.height, height);
    assert.deepEqual(actual.canvas.toBuffer("image/png"), expected.toBuffer("image/png"));
  }
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("an oversized image header is rejected before native pixel decoding", async () => {
  const bytes = createCanvas(1, 1).toBuffer("image/png");
  bytes.writeUInt32BE(100_000, 16);
  bytes.writeUInt32BE(100_000, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  // The payload still represents one pixel. A decoder reaching it would fail
  // as corrupt; the dimensional error proves the check runs before decode.
  await assert.rejects(
    () => prepareImage(bytes, 'cut "oversized-source"'),
    (error: unknown) =>
      error instanceof ExportError &&
      error.code === "raster-too-large" &&
      error.message.includes("100000 x 100000"),
  );
});

test("direct cut and transition composition refuse unsafe dimensions before allocation", () => {
  const transition = buildInitialProject("fixture").episodes[0]?.transitions[0];
  assert.ok(transition);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      `
const assert = require('node:assert/strict');
const canvas = require(process.argv[1]);
canvas.createCanvas = () => { throw new Error('fixture allocation attempted'); };
(async () => {
  const { composeCut, composeTransitionBand } = await import(process.argv[2]);
  await assert.rejects(() => composeCut([], null, 100000), error => error.code === 'raster-too-large');
  assert.throws(() => composeTransitionBand(JSON.parse(process.argv[3]), 100000, 1), error => error.code === 'raster-too-large');
})().catch(error => { console.error(error); process.exitCode = 1; });
`,
      createRequire(import.meta.url).resolve("@napi-rs/canvas"),
      new URL("../compose.js", import.meta.url).href,
      JSON.stringify(transition),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  // Intercept even a regressed allocator, so this control cannot allocate a
  // giant canvas in either the test runner or its child.
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

test("the working-set budget admits 60–100 cuts and counts bands, final canvas and output", () => {
  for (const cuts of [60, 100]) {
    const height = Math.ceil((61_400 * cuts) / 60);
    assertRasterSize(800, height, `${cuts}-cut page`);
    const pageCopies = 800 * height * 4 * 3;
    const sourcePixels = cuts * 832 * 1216 * 4;
    const encodedInputs = cuts * 1024 * 1024;
    assertRasterBudget(pageCopies + sourcePixels + encodedInputs, `${cuts}-cut page`);
  }
  // One 1000x200000 canvas fits; bands + final + output exceed the total budget.
  assertRasterSize(1000, 200_000, "single page");
  assert.throws(() => assertRasterBudget(1000 * 200_000 * 4 * 3, "page and output"), ExportError);
});
