// Pixel helpers for export tests: decode an output file and compare it with a
// region of a reference canvas, exactly.

import assert from "node:assert/strict";
import { type Canvas, createCanvas, loadImage } from "@napi-rs/canvas";

/** Decode encoded image bytes into RGBA pixels. */
export async function decodePixels(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return {
    width: image.width,
    height: image.height,
    data: canvas.getContext("2d").getImageData(0, 0, image.width, image.height).data,
  };
}

/** RGBA pixels of a region of `source`, drawn over an opaque white ground. */
export function regionPixels(
  source: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/** Assert that a decoded region of an output equals the reference pixels exactly. */
export function assertSamePixels(
  actual: Uint8ClampedArray,
  expected: Uint8ClampedArray,
  what: string,
) {
  assert.equal(actual.length, expected.length, `${what}: pixel count`);
  const same = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength).equals(
    Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
  );
  if (same) return;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      const pixel = Math.floor(i / 4);
      assert.fail(`${what}: first differing byte at pixel ${pixel} (channel ${i % 4})`);
    }
  }
}

/** Crop decoded RGBA pixels to a rectangle. */
export function crop(
  image: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    out.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return out;
}

/** True when every pixel of the rectangle is opaque white. */
export function isWhite(
  image: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const pixels = crop(image, x, y, width, height);
  return pixels.every((value) => value === 255);
}
