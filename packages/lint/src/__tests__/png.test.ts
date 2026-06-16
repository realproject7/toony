import assert from "node:assert/strict";
import { test } from "node:test";

import { encodePng, makeGradientRaster, makeSolidRaster } from "../__fixtures__/images.js";
import { decodePng, ImageDecodeError, isPng } from "../image/png.js";

test("isPng recognizes the signature", () => {
  const png = encodePng(makeSolidRaster(2, 2, 3, 100));
  assert.equal(isPng(png), true);
  assert.equal(isPng(Uint8Array.from([0, 1, 2, 3])), false);
});

test("round-trips an RGBA raster through encode/decode", () => {
  const raster = makeGradientRaster(5, 3, 4, 0, 255);
  const decoded = decodePng(encodePng(raster));
  assert.equal(decoded.width, 5);
  assert.equal(decoded.height, 3);
  assert.equal(decoded.channels, 4);
  assert.deepEqual(decoded.data, raster.data);
});

test("round-trips RGB and grayscale rasters", () => {
  for (const channels of [1, 3] as const) {
    const raster = makeGradientRaster(4, 4, channels, 10, 200);
    const decoded = decodePng(encodePng(raster));
    assert.equal(decoded.channels, channels);
    assert.deepEqual(decoded.data, raster.data);
  }
});

test("rejects a non-PNG buffer", () => {
  assert.throws(() => decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), ImageDecodeError);
});

test("rejects a truncated PNG", () => {
  const png = encodePng(makeSolidRaster(32, 32, 3, 50));
  // Keep only the signature + IHDR; the image data (IDAT) is gone.
  const truncated = png.subarray(0, 33);
  assert.throws(() => decodePng(truncated), ImageDecodeError);
});
