import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBubble } from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";
import {
  BUBBLE_PRESETS,
  balloonShapePatch,
  bubbleKindPatch,
  presetOverlay,
  presetPreviewPlan,
} from "../new-overlay.js";

const options = {
  width: 832,
  height: 1496,
  referenceWidth: 800,
  dialogueLanguage: "ko",
  gutterBandWidth: 0.17,
  theme: {
    themeFormat: 1,
    kinds: {
      speech: { fill: "#ffeedd", cornerRadius: 22, border: { width: 3, color: "#123456" } },
    },
  },
};

test("every palette thumbnail uses the created preset's actual themed outline, tail and colors", () => {
  for (const height of [248, 1496])
    for (const { kind } of BUBBLE_PRESETS) {
      const config = { ...options, height };
      const actual = layoutBubble(
        presetOverlay("sample", 0, kind, { x: 0.5, y: 0.4 }, config),
        config.width,
        height,
        { dialogueLanguage: config.dialogueLanguage, gutterBandWidth: config.gutterBandWidth },
      );
      const preview = presetPreviewPlan(kind, config);
      assert.equal(preview.pathD, actual.pathD, kind);
      assert.deepEqual(preview.tail, actual.tail, kind);
      assert.deepEqual(preview.box, actual.box, kind);
      assert.equal(preview.stroke, actual.stroke, kind);
      assert.equal(preview.fill, actual.fill, kind);
      assert.equal(preview.hasBubble, actual.hasBubble, kind);
      assert.equal(preview.fontFamily, actual.fontFamily, kind);
    }
});

test("type changes preserve literal dialogue, styled ranges, position and authored appearance", () => {
  const source: LetteringOverlay = {
    ...presetOverlay("sample", 0, "speech", { x: 0.5, y: 0.4 }, options),
    speaker: "SPEAKER",
    text: "Hello 안녕",
    fontSize: 31,
    textRanges: [{ start: 0, end: 5, style: { fontWeight: 700 } }],
    fillGradient: {
      angle: 90,
      stops: [
        { offset: 0, color: "#ffffff" },
        { offset: 1, color: "#ccddff" },
      ],
    },
    zIndex: 4,
    locked: true,
  };
  for (const { kind } of BUBBLE_PRESETS) {
    const result = { ...source, ...bubbleKindPatch(source, kind) };
    for (const key of [
      "id",
      "text",
      "textRanges",
      "speaker",
      "geometry",
      "fontSize",
      "fill",
      "border",
      "fillGradient",
      "locked",
      "zIndex",
    ] as const)
      assert.deepEqual(result[key], source[key], `${kind}:${key}`);
  }
});

test("an explicit new kind clears incompatible silhouette and off-panel tail overrides", () => {
  const source = {
    ...presetOverlay("sample", 0, "shout", { x: 0.5, y: 0.4 }, options),
    cornerRadius: 0,
    tailTarget: { x: -1, y: 0.5 },
  };
  const thought = { ...source, ...bubbleKindPatch(source, "thought") };
  assert.equal(thought.tone, "neutral");
  assert.equal(thought.cornerRadius, undefined);
  assert.ok(thought.tail);
  assert.equal(thought.tailTarget, null);
  assert.ok(layoutBubble(thought, 832, 1496).tail);
  assert.equal(thought.balloonShape, "oval");
  const speech = { ...thought, ...bubbleKindPatch(thought, "speech") };
  assert.ok(layoutBubble(speech, 832, 1496).tail);
  assert.notEqual(layoutBubble(speech, 832, 1496).pathD, layoutBubble(thought, 832, 1496).pathD);
  const caption = { ...speech, ...bubbleKindPatch(speech, "narration") };
  assert.equal(caption.cornerRadius, 0);
  assert.equal(caption.tail, null);
  const free = { ...caption, ...bubbleKindPatch(caption, "sfx") };
  assert.equal(layoutBubble(free, 832, 1496).hasBubble, false);
});

test("new and explicitly switched shout presets use the same sharp outline; same-kind click is inert", () => {
  const shout = presetOverlay("sample", 0, "shout", { x: 0.5, y: 0.4 }, options);
  assert.equal(shout.tone, "aggressive");
  assert.deepEqual(bubbleKindPatch(shout, "shout"), {});
  const speech = { ...shout, kind: "speech" as const, tone: "neutral" as const };
  const converted = { ...speech, ...bubbleKindPatch(speech, "shout") };
  assert.equal(layoutBubble(converted, 832, 1496).pathD, layoutBubble(shout, 832, 1496).pathD);
});

test("the shape gallery switches free text without losing styled content or a hidden tail target", () => {
  const source: LetteringOverlay = {
    ...presetOverlay("sample", 0, "thought", { x: 0.5, y: 0.4 }, options),
    text: "Hello 안녕",
    textRanges: [{ start: 0, end: 5, style: { fontWeight: 700 } }],
    tailStyle: "beads",
    tailTarget: { x: -0.2, y: 0.6 },
    fontSize: 32,
    fillGradient: {
      angle: 90,
      stops: [
        { offset: 0, color: "#ffffff" },
        { offset: 1, color: "#ddeeff" },
      ],
    },
  };
  const free = { ...source, ...balloonShapePatch(source, null) };
  assert.equal(layoutBubble(free, 832, 1496).hasBubble, false);
  const cloud = { ...free, ...balloonShapePatch(free, "cloud") };
  const plan = layoutBubble(cloud, 832, 1496);
  assert.equal(plan.hasBubble, true);
  assert.ok(plan.tail);
  assert.equal(cloud.balloonShape, "cloud");
  for (const key of [
    "text",
    "textRanges",
    "geometry",
    "tail",
    "tailTarget",
    "tailStyle",
    "fontSize",
    "fill",
    "border",
    "fillGradient",
  ] as const)
    assert.deepEqual(cloud[key], source[key], key);
  const newFree = {
    ...free,
    fill: "transparent",
    fillGradient: null,
    border: { width: 0, color: "#123456" },
  };
  const visible = { ...newFree, ...balloonShapePatch(newFree, "oval") };
  const visiblePlan = layoutBubble(visible, 832, 1496);
  assert.notEqual(visiblePlan.fill, "transparent");
  assert.equal(visible.border?.width, 2.2);
  assert.equal(visible.border?.color, "#123456");
});
