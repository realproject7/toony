// The face an overlay `<text>` carries (#229), in the #157 node:test harness.
//
// The defect was never in what the component computed: the presentation attribute
// already named the resolved face. It was that a stylesheet rule outranked the
// attribute, so the browser drew Inter. A test asserting the attribute would have
// passed for as long as the bug existed. The cascade itself is a browser fact and
// cannot run in this harness, so it is verified by hand in a live page (see the
// PR body); what runs here is the part that is pure — the style carries the face
// the PLAN resolved, and that face is the one the export canvas draws.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FONT_FAMILIES } from "@toony/fonts";
import { layoutCut, matchFaceWeight } from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";
import { resolveCanvasFont } from "../canvas-font.js";
import { bubbleTextStyle } from "../overlay-text-style.js";

const W = 800;
const H = 1200;

function bubble(id: string, over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id,
    cutId: "cut-002",
    speaker: "Sora",
    kind: "speech",
    text: "Morning.",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.08, y: 0.07, width: 0.84, height: 0.16 },
    overflow: false,
    reviewStatus: "draft",
    ...over,
  };
}

/** The family name out of a CSS stack or a `ctx.font` shorthand. */
function quotedName(value: string): string | null {
  return /"([^"]+)"/.exec(value)?.[1] ?? null;
}

test("each bubble's style carries the face its own plan resolved (#229)", () => {
  const [speech, narration] = layoutCut(
    [
      bubble("ov-001"),
      bubble("ov-002", { kind: "narration", text: "Ordinary days, quietly kept." }),
    ],
    W,
    H,
    { dialogueLanguage: "en" },
  );
  assert.ok(speech && narration);
  assert.equal(bubbleTextStyle(speech).fontFamily, speech.fontStack);
  assert.equal(bubbleTextStyle(narration).fontFamily, narration.fontStack);
  // The control that makes the two lines above mean something: these two kinds
  // resolve to DIFFERENT faces, so a style that handed every bubble one family
  // (which is exactly what the overriding CSS rule did) fails here.
  assert.notEqual(speech.fontStack, narration.fontStack);
  assert.notEqual(bubbleTextStyle(speech).fontFamily, bubbleTextStyle(narration).fontFamily);
});

test("the style names the same face the export canvas draws (#229 read equals export)", () => {
  for (const family of FONT_FAMILIES) {
    const [plan] = layoutCut([bubble("ov-001", { fontFamily: family.id })], W, H, {
      dialogueLanguage: "en",
    });
    assert.ok(plan, `${family.id}: no plan`);
    const styled = String(bubbleTextStyle(plan).fontFamily);
    // `matchFaceWeight` is the mapping `layoutCut` itself applies before feeding
    // the measurer, so this reads the face the browser measurer really keyed off.
    const canvas = resolveCanvasFont(
      plan.fontFamily,
      matchFaceWeight(plan.fontWeight),
      plan.text.fontSize,
    );
    assert.equal(quotedName(styled), family.name, `${family.id}: studio style is ${styled}`);
    assert.equal(quotedName(canvas), family.name, `${family.id}: export font is ${canvas}`);
  }
});
