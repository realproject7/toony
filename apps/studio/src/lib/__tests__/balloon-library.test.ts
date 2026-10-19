import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBubble } from "@toony/render";
import {
  BALLOON_LIBRARY,
  bubbleKindPatch,
  libraryOverlay,
  libraryPreview,
  resolvedTailStyle,
  tailStylePatch,
} from "../new-overlay.js";

const options = {
  width: 800,
  height: 1200,
  referenceWidth: 800,
  dialogueLanguage: "ko",
  gutterBandWidth: 0.18,
};

test("all library previews use exactly the placed preset, including radial marks, tails and colors", () => {
  assert.equal(new Set(BALLOON_LIBRARY.map((p) => p.id)).size, 16);
  for (const preset of BALLOON_LIBRARY) {
    const b = libraryOverlay("sample", 0, preset.id, { x: 0.5, y: 0.4 }, options);
    const a = layoutBubble(b, options.width, options.height, options),
      preview = libraryPreview(preset.id, options);
    for (const key of [
      "pathD",
      "accentPathD",
      "fill",
      "stroke",
      "strokeWidth",
      "textColor",
    ] as const)
      assert.deepEqual(a[key], preview[key], `${preset.id}:${key}`);
    assert.equal(resolvedTailStyle(b), preset.tail);
    if (preset.tail === "none") assert.equal(a.tail, null);
    else assert.ok(a.tail);
  }
});

test("no-tail keeps a precisely aimed normal or off-panel target across save and restore", () => {
  for (const target of [{ tail: { x: 0.1, y: 0.9 } }, { tailTarget: { x: -0.2, y: 0.8 } }]) {
    const source = {
      ...libraryOverlay("sample", 0, "dialogue", { x: 0.5, y: 0.4 }, options),
      ...target,
      text: "말풍선을 지켜요",
      textRanges: [{ start: 0, end: 4, style: { fontWeight: 700 as const } }],
    };
    const off = JSON.parse(JSON.stringify({ ...source, ...tailStylePatch(source, "none") }));
    assert.equal(layoutBubble(off, 800, 1200).tail, null);
    assert.deepEqual(off.tail, source.tail);
    assert.deepEqual(off.tailTarget, source.tailTarget);
    const restored = { ...off, ...tailStylePatch(off, "straight") };
    assert.equal(layoutBubble(restored, 800, 1200).pathD, layoutBubble(source, 800, 1200).pathD);
    assert.equal(restored.text, source.text);
    assert.deepEqual(restored.textRanges, source.textRanges);
  }
});

test("a semantic type change respects an explicitly tailless choice", () => {
  const source = libraryOverlay("sample", 0, "floating", { x: 0.5, y: 0.4 }, options);
  for (const kind of ["thought", "shout", "whisper", "narration"] as const) {
    const b = { ...source, ...bubbleKindPatch(source, kind) };
    assert.equal(b.tailStyle, "none");
    assert.equal(layoutBubble(b, 800, 1200).tail, null);
  }
});

test("explicit presets own body colors while retaining project typography", () => {
  const b = libraryOverlay(
    "sample",
    0,
    "dark-voice",
    { x: 0.5, y: 0.4 },
    {
      ...options,
      theme: {
        themeFormat: 1,
        kinds: { thought: { fill: "#ff0000", textColor: "#000000", fontFamily: "gaegu" } },
      },
    },
  );
  assert.equal(b.fill, "#171717");
  assert.equal(b.textColor, "#ffffff");
  assert.equal(b.fontFamily, "gaegu");
  assert.throws(() => libraryOverlay("sample", 0, "invalid", { x: 0.5, y: 0.4 }, options));
});

test("manual tail aiming uses art coordinates and removes an obsolete off-panel target", async () => {
  const { tailDragPatch } = await import("../new-overlay.js");
  assert.deepEqual(
    tailDragPatch({ x: 0.6, y: 0.75 }, { x: 160, y: 0, width: 640, height: 1200 }, 800, 1200),
    { tailTarget: null, tail: { x: 0.5, y: 0.75 } },
  );
  assert.deepEqual(
    tailDragPatch({ x: 0, y: 1 }, { x: 160, y: 0, width: 640, height: 1200 }, 800, 1200),
    { tailTarget: null, tail: { x: 0, y: 1 } },
  );
});
