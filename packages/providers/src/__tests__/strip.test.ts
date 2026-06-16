import assert from "node:assert/strict";
import { test } from "node:test";

import { jpegWithExif, pngWithMetadata, webpVp8xWithExif } from "../__fixtures__/containers.js";
import { stripImageMetadata } from "../strip.js";

function asLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

test("PNG strip removes tEXt/eXIf but keeps image chunks", () => {
  const stripped = stripImageMetadata(pngWithMetadata(), "png");
  const text = asLatin1(stripped);
  assert.ok(!text.includes("tEXt"));
  assert.ok(!text.includes("eXIf"));
  assert.ok(!text.includes("Exif"));
  assert.ok(text.includes("IHDR"));
  assert.ok(text.includes("IDAT"));
  assert.ok(text.includes("IEND"));
  assert.ok(stripped.length < pngWithMetadata().length);
});

test("JPEG strip removes APP1/EXIF but keeps APP0 and scan", () => {
  const stripped = stripImageMetadata(jpegWithExif(), "jpeg");
  const text = asLatin1(stripped);
  assert.ok(!text.includes("Exif"));
  assert.ok(text.includes("JFIF"));
  assert.equal(stripped[0], 0xff);
  assert.equal(stripped[1], 0xd8); // still SOI
  assert.equal(stripped[stripped.length - 2], 0xff);
  assert.equal(stripped[stripped.length - 1], 0xd9); // still EOI
});

test("WebP strip drops the EXIF chunk and clears VP8X flag bits", () => {
  const stripped = stripImageMetadata(webpVp8xWithExif(), "webp");
  const text = asLatin1(stripped);
  assert.ok(!text.includes("EXIF"));
  assert.ok(text.includes("VP8X"));
  assert.ok(text.includes("VP8 "));
  // Locate the VP8X flags byte (8 bytes after the "VP8X" fourcc) and confirm
  // the EXIF (0x08) and XMP (0x04) bits are cleared.
  const vp8xIndex = text.indexOf("VP8X");
  const flags = stripped[vp8xIndex + 8] ?? 0;
  assert.equal(flags & 0x0c, 0);
});

test("stripping is idempotent", () => {
  for (const [bytes, format] of [
    [pngWithMetadata(), "png"],
    [jpegWithExif(), "jpeg"],
    [webpVp8xWithExif(), "webp"],
  ] as const) {
    const once = stripImageMetadata(bytes, format);
    const twice = stripImageMetadata(once, format);
    assert.deepEqual(twice, once);
  }
});

test("GIF bytes pass through unchanged", () => {
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
  assert.deepEqual(stripImageMetadata(gif, "gif"), gif);
});
