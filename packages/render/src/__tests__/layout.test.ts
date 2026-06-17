import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFontFamilyForKind, getFontFamily } from "@toony/fonts";
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

// --- Pro-lettering style fields (#54) --------------------------------------

test("absent style fields reproduce current per-kind behavior (back-compat)", () => {
  const speech = layoutBubble(speechOverlay, W, H);
  // Per-kind defaults: speech is weight 400, text color #1a1a1a, center-anchored.
  assert.equal(speech.fontWeight, 400);
  assert.equal(speech.textColor, "#1a1a1a");
  assert.equal(speech.textAlign, "center");
  assert.equal(speech.letterSpacing, 0);
  assert.equal(speech.zIndex, 0);
  for (const line of speech.lines) assert.equal(line.anchorX, line.centerX);
  // shout/sfx default to weight 700.
  assert.equal(
    layoutBubble(overlay({ id: "s", kind: "shout", text: "HEY" }), W, H).fontWeight,
    700,
  );
});

test("a fixed fontSize overrides auto-fit", () => {
  const r = layoutBubble(overlay({ id: "fs", fontSize: 30 }), W, H);
  assert.equal(r.text.fontSize, 30);
  // null is auto-fit (a number is chosen by the fitter).
  const auto = layoutBubble(overlay({ id: "fa", fontSize: null }), W, H);
  assert.ok(auto.text.fontSize > 0 && auto.text.fontSize !== 30);
});

test("fontWeight, textColor, lineHeight overrides are honored", () => {
  const r = layoutBubble(
    overlay({ id: "w", fontWeight: 600, textColor: "#2244ff", lineHeight: 2, fontSize: 20 }),
    W,
    H,
  );
  assert.equal(r.fontWeight, 600);
  assert.equal(r.textColor, "#2244ff");
  assert.equal(r.text.lineHeight, r.text.fontSize * 2);
});

test("fontFamily resolves to the curated family stack, with a per-kind default", () => {
  // An explicit curated id resolves to that family's id + CSS stack.
  const explicit = layoutBubble(overlay({ id: "ff", fontFamily: "bangers" }), W, H);
  assert.equal(explicit.fontFamily, "bangers");
  assert.equal(explicit.fontStack, getFontFamily("bangers")?.stack);
  // An absent fontFamily falls back to the per-kind default (back-compatible).
  const fallback = layoutBubble(overlay({ id: "ffd", kind: "shout", text: "HEY" }), W, H);
  assert.equal(fallback.fontFamily, defaultFontFamilyForKind("shout"));
  assert.equal(fallback.fontStack, getFontFamily(defaultFontFamilyForKind("shout"))?.stack);
});

test("textAlign controls each line's anchor x", () => {
  const left = layoutBubble(overlay({ id: "l", textAlign: "left" }), W, H);
  for (const line of left.lines) assert.equal(line.anchorX, left.textOrigin.x);
  const right = layoutBubble(overlay({ id: "r", textAlign: "right" }), W, H);
  const padX = Math.max(2, right.box.width * 0.06);
  for (const line of right.lines) {
    assert.equal(line.anchorX, right.box.x + right.box.width - padX);
  }
});

test("letterSpacing widens measurement so wrapping reflects it", () => {
  const base = overlay({
    id: "ls",
    text: "the tide remembers every single name tonight",
    fontSize: 28,
    geometry: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  });
  const tight = layoutBubble(base, W, H);
  const spaced = layoutBubble({ ...base, letterSpacing: 0.5 }, W, H);
  assert.equal(spaced.letterSpacing, 0.5);
  // Wider per-glyph advance can only keep or increase the wrapped line count.
  assert.ok(spaced.text.lines.length >= tight.text.lines.length);
});

test("cornerRadius override is honored and clamped to half the shorter side", () => {
  const r = layoutBubble(overlay({ id: "cr", cornerRadius: 12 }), W, H);
  assert.equal(r.cornerRadius, 12);
  const clamped = layoutBubble(overlay({ id: "cr2", cornerRadius: 999 }), W, H);
  assert.equal(clamped.cornerRadius, Math.min(clamped.box.width, clamped.box.height) / 2);
});

test("layoutCut orders plans by zIndex, ties by input order", () => {
  const a = overlay({ id: "a", zIndex: 2, geometry: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 } });
  const b = overlay({ id: "b", zIndex: 0, geometry: { x: 0.1, y: 0.4, width: 0.3, height: 0.2 } });
  const c = overlay({ id: "c", zIndex: 2, geometry: { x: 0.5, y: 0.1, width: 0.3, height: 0.2 } });
  const d = overlay({ id: "d", zIndex: 1, geometry: { x: 0.5, y: 0.4, width: 0.3, height: 0.2 } });
  const plans = layoutCut([a, b, c, d], W, H);
  // Ascending z: b(0), d(1), then a & c (both 2) keep their input order.
  assert.deepEqual(
    plans.map((p) => p.id),
    ["b", "d", "a", "c"],
  );
});
