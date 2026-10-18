import assert from "node:assert/strict";
import { test } from "node:test";
import { letteringClipboard, parseLetteringClipboard } from "../lettering-clipboard.js";
import { newOverlay } from "../new-overlay.js";

test("clipboard preserves literal Unicode, style ranges and draft attribution without HTML", () => {
  const b = {
    ...newOverlay("cut-001", 0),
    text: "안녕 <b>Hi</b>",
    speaker: "",
    textRanges: [
      { start: 0, end: 2, style: { fontStyle: "italic" as const, textColor: "#335577" } },
    ],
  };
  assert.deepEqual(parseLetteringClipboard(letteringClipboard([b])), [b]);
});
test("clipboard rejects foreign versions, invalid ranges and unsafe geometry before insertion", () => {
  const b = { ...newOverlay("cut-001", 0), speaker: "Speaker" };
  for (const text of [
    "<p>text</p>",
    "{}",
    JSON.stringify({ format: "another-editor", overlays: [b] }),
    letteringClipboard([{ ...b, geometry: { ...b.geometry, x: 2 } }]),
    letteringClipboard([
      { ...b, textRanges: [{ start: 0, end: 500, style: { fontWeight: 700 } }] },
    ]),
    letteringClipboard([]),
  ])
    assert.throws(() => parseLetteringClipboard(text));
});
