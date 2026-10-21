import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { composeContactSheet } from "../contact-sheet.js";
import { encodeCanvas } from "../encode.js";

function picture(fill: string): Uint8Array {
  const canvas = createCanvas(40, 60);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 40, 60);
  return encodeCanvas(canvas, "png");
}

test("a contact sheet lays the set out in numbered cells, and an unreadable picture stays a grey cell", async () => {
  const sheet = await composeContactSheet(
    [
      { bytes: picture("#ff0000"), label: "01" },
      { bytes: picture("#00ff00"), label: "02" },
      { bytes: Uint8Array.from([1, 2, 3]), label: "03" },
    ],
    { columns: 2, cellWidth: 100 },
  );
  // Two columns of 100 px at the first picture's 2:3 aspect, three pictures in two rows.
  assert.equal(sheet.width, 8 + 2 * (100 + 8));
  assert.equal(sheet.height, 8 + 2 * (26 + 150 + 8));
  const ctx = sheet.getContext("2d");
  const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
  assert.deepEqual(at(58, 8 + 26 + 75), [255, 0, 0], "the first picture fills the first cell");
  assert.deepEqual(at(166, 8 + 26 + 75), [0, 255, 0], "the second sits beside it");
  const third = at(58, 8 + 26 + 150 + 8 + 26 + 75);
  assert.deepEqual(third, [0xc4, 0xc8, 0xd2], "a picture that cannot be read is a grey cell");
});
