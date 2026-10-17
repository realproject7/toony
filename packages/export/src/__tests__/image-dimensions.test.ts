import assert from "node:assert/strict";
import { test } from "node:test";
import { readImageDimensions } from "../image-dimensions.js";

// Header-only controls: never passed to a native decoder.
const SOF = [0xff, 0xc0, 0, 11, 8, 0, 5, 0, 3, 1, 1, 0x11, 0];
const shape = { format: "jpeg", width: 3, height: 5 };

function jpeg(...header: number[]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...header]);
}

test("JPEG fill and standalone markers do not consume a segment length", () => {
  for (const prefix of [
    [0xff],
    [0xff, 0xff, 0xff],
    [0xff, 1],
    [0xff, 0xd0, 0xff, 0xd7],
    [0xff, 0xff, 1, 0xff, 0xff, 0xd3, 0xff],
    [0xff, 0, 0x12],
  ]) {
    assert.deepEqual(readImageDimensions(jpeg(...prefix, ...SOF)), shape);
  }
});

test("JPEG variable payloads are skipped and cannot forge frame dimensions", () => {
  const decoy = [...SOF];
  decoy[8] = 99;
  const segment = [0xff, 0xe1, 0, decoy.length + 2, ...decoy];
  assert.deepEqual(readImageDimensions(jpeg(0xff, ...segment, 0xff, ...SOF)), shape);
});

test("JPEG truncated markers, lengths and frames are bounded reads", () => {
  for (const suffix of [
    [],
    [0xff],
    [0xff, 0xff, 0xff],
    [0xff, 0xe1],
    [0xff, 0xe1, 0],
    [0xff, 0xe1, 0, 0, ...SOF],
    [0xff, 0xe1, 0, 1, ...SOF],
    [0xff, 0xe1, 0xff, 0xff, ...SOF],
    [0xff, 0xc0, 0, 2, ...SOF],
    [0xff, 0xd9, ...SOF],
    [0xff, 0xda, ...SOF],
  ]) {
    assert.equal(readImageDimensions(jpeg(...suffix)), null);
  }
  for (let end = 0; end < 10; end++) {
    assert.equal(readImageDimensions(jpeg(...SOF.slice(0, end))), null);
  }
  assert.equal(readImageDimensions(jpeg(...new Array<number>(4096).fill(0xff))), null);
});

test("JPEG fill retains oversized dimensions for the allocation guard", () => {
  const oversized = [...SOF];
  oversized[5] = oversized[6] = oversized[7] = oversized[8] = 0xff;
  assert.deepEqual(readImageDimensions(jpeg(0xff, ...oversized)), {
    format: "jpeg",
    width: 65_535,
    height: 65_535,
  });
});
