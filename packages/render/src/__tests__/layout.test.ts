import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBubble, layoutCut } from "../layout.js";
import { narrationOverlay, overlay, sfxOverlay, speechOverlay } from "./fixtures.js";

const W = 800;
const H = 1200;

test("layoutBubble is deterministic for the same inputs", () => {
  const a = layoutBubble(speechOverlay, W, H);
  const b = layoutBubble(speechOverlay, W, H);
  assert.deepEqual(a, b);
});

test("speech bubble converts normalized geometry to pixel space", () => {
  const r = layoutBubble(speechOverlay, W, H);
  assert.equal(r.box.x, speechOverlay.geometry.x * W);
  assert.equal(r.box.y, speechOverlay.geometry.y * H);
  assert.equal(r.box.width, speechOverlay.geometry.width * W);
  assert.equal(r.box.height, speechOverlay.geometry.height * H);
});

test("speech bubble produces a visible tail and a closed SVG path", () => {
  const r = layoutBubble(speechOverlay, W, H);
  assert.ok(r.hasBubble);
  assert.ok(r.tail, "expected a tail");
  assert.ok(r.pathD.startsWith("M "));
  assert.ok(r.pathD.endsWith("Z"));
  // The tail tip is the image-space point converted to pixels.
  assert.equal(r.tail.tip.x, (speechOverlay.tail?.x ?? 0) * W);
  assert.equal(r.tail.tip.y, (speechOverlay.tail?.y ?? 0) * H);
});

test("narration is tailless and renders a body", () => {
  const r = layoutBubble(narrationOverlay, W, H);
  assert.ok(r.hasBubble);
  assert.equal(r.tail, null);
  assert.ok(r.pathD.length > 0);
});

test("SFX renders bare text with no bubble body or path", () => {
  const r = layoutBubble(sfxOverlay, W, H);
  assert.equal(r.hasBubble, false);
  assert.equal(r.tail, null);
  assert.equal(r.pathD, "");
  assert.ok(r.lines.length >= 1);
});

test("render plan carries no speaker label (it is metadata, never drawn)", () => {
  const r = layoutBubble(speechOverlay, W, H);
  // The render plan must not expose a speaker label or any speaker layout, so
  // consumers (canvas + SVG) cannot draw it on the artwork.
  assert.ok(!("speaker" in r));
  assert.ok(!("speakerColor" in r));
  assert.ok(!("speakerFontSize" in r.text));
});

test("text origin is independent of the overlay's speaker", () => {
  const withSpeaker = layoutBubble(speechOverlay, W, H);
  const noSpeaker = layoutBubble(overlay({ ...speechOverlay, id: "x", speaker: "" }), W, H);
  // No speaker strip is reserved either way, so the body text origin is identical.
  assert.equal(withSpeaker.textOrigin.y, noSpeaker.textOrigin.y);
});

test("stored fill and opacity override per-kind defaults", () => {
  const styled = layoutBubble(
    overlay({
      id: "styled",
      kind: "speech",
      fill: "#ffeeaa",
      opacity: 0.5,
      tail: { x: 0.3, y: 0.5 },
    }),
    W,
    H,
  );
  assert.equal(styled.fill, "#ffeeaa");
  assert.equal(styled.fillOpacity, 0.5);
});

test("stored border color and width are honored", () => {
  const bordered = layoutBubble(overlay({ id: "b", border: { width: 6, color: "#ff0000" } }), W, H);
  assert.equal(bordered.stroke, "#ff0000");
  assert.equal(bordered.strokeWidth, 6);
});

test("text lines are center-anchored within the body box", () => {
  const r = layoutBubble(speechOverlay, W, H);
  for (const line of r.lines) {
    assert.equal(line.centerX, r.box.x + r.box.width / 2);
  }
});

test("layoutCut lays out every overlay in input order", () => {
  const plans = layoutCut([speechOverlay, narrationOverlay, sfxOverlay], W, H);
  assert.deepEqual(
    plans.map((p) => p.id),
    ["ov-speech", "ov-narration", "ov-sfx"],
  );
});

test("preview-vs-export scale: relative geometry is identical at 2x", () => {
  const preview = layoutBubble(speechOverlay, W, H);
  const exportP = layoutBubble(speechOverlay, W * 2, H * 2);
  // Box positions scale exactly with the render size (WYSIWYG invariant).
  assert.equal(exportP.box.x, preview.box.x * 2);
  assert.equal(exportP.box.width, preview.box.width * 2);
  // Same line breaking at both scales (font range scales with height).
  assert.deepEqual(exportP.text.lines, preview.text.lines);
});
