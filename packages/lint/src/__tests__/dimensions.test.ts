import assert from "node:assert/strict";
import { test } from "node:test";

import { encodePng, makeSolidRaster } from "../__fixtures__/images.js";
import { readImageDimensions } from "../image/dimensions.js";

test("reads PNG dimensions from a real encoded buffer", () => {
  const png = encodePng(makeSolidRaster(12, 7, 3, 0));
  assert.deepEqual(readImageDimensions(png), { format: "png", width: 12, height: 7 });
});

test("reads GIF dimensions from the header", () => {
  // GIF89a, width=10 (LE), height=20 (LE).
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0, 0, 0]);
  assert.deepEqual(readImageDimensions(gif), { format: "gif", width: 10, height: 20 });
});

test("reads JPEG dimensions from a SOF0 segment", () => {
  // FFD8 SOI, FFC0 SOF0, len=0x0011, precision=8, height=30 (BE), width=40 (BE).
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 30, 0x00, 40, 0x03, 0x01, 0x22, 0x00, 0x00,
  ]);
  assert.deepEqual(readImageDimensions(jpeg), { format: "jpeg", width: 40, height: 30 });
});

test("reads WebP (VP8X) dimensions from the header", () => {
  const webp = new Uint8Array(30);
  webp.set(
    [..."RIFF"].map((c) => c.charCodeAt(0)),
    0,
  );
  webp.set(
    [..."WEBP"].map((c) => c.charCodeAt(0)),
    8,
  );
  webp.set(
    [..."VP8X"].map((c) => c.charCodeAt(0)),
    12,
  );
  // canvas width-1 = 99 (LE 24-bit), height-1 = 199.
  webp[24] = 99;
  webp[27] = 199;
  assert.deepEqual(readImageDimensions(webp), { format: "webp", width: 100, height: 200 });
});

test("returns null for an unrecognized buffer", () => {
  assert.equal(readImageDimensions(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])), null);
});

test("rejects a buffer that only starts like a PNG", () => {
  // First two signature bytes but not the full signature / IHDR.
  const fake = new Uint8Array(24);
  fake[0] = 0x89;
  fake[1] = 0x50;
  assert.equal(readImageDimensions(fake), null);
});
