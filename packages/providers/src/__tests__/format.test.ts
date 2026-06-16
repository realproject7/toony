import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jpegWithExif,
  notAnImage,
  pngWithMetadata,
  webpVp8xWithExif,
} from "../__fixtures__/containers.js";
import { contentTypeFor, detectImageFormat, extensionFor } from "../format.js";

test("detects supported formats from magic bytes", () => {
  assert.equal(detectImageFormat(pngWithMetadata()), "png");
  assert.equal(detectImageFormat(jpegWithExif()), "jpeg");
  assert.equal(detectImageFormat(webpVp8xWithExif()), "webp");
  assert.equal(detectImageFormat(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), "gif");
});

test("returns null for non-images", () => {
  assert.equal(detectImageFormat(notAnImage()), null);
  assert.equal(detectImageFormat(Uint8Array.from([0])), null);
});

test("maps formats to content types and extensions", () => {
  assert.equal(contentTypeFor("png"), "image/png");
  assert.equal(contentTypeFor("jpeg"), "image/jpeg");
  assert.equal(extensionFor("jpeg"), "jpg");
  assert.equal(extensionFor("webp"), "webp");
});
