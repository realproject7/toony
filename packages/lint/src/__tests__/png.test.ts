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

test("rejects a PNG whose IHDR length is not 13 (#156)", () => {
  const png = encodePng(makeSolidRaster(4, 4, 3, 100));
  const bad = Uint8Array.from(png);
  // The IHDR chunk length is the big-endian uint32 right after the 8-byte PNG
  // signature (valid = 13). 12 still fits the buffer, so it exercises the new
  // IHDR-length check (corrupt) rather than the past-end bounds check.
  bad[8] = 0;
  bad[9] = 0;
  bad[10] = 0;
  bad[11] = 12;
  assert.throws(
    () => decodePng(bad),
    (error: unknown) => {
      assert.ok(error instanceof ImageDecodeError);
      assert.equal(error.code, "corrupt");
      assert.match(error.message, /IHDR/);
      return true;
    },
  );
});
