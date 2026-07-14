// Canvas-font resolution tests (#149), in the #157 node:test harness.
//
// `resolveCanvasFont` is the parity-critical mapping the browser measurer keys
// `ctx.font` off — it must name the SAME curated face the export raster draws.
// It is pure (no DOM), so it's unit-testable here; the live `measureText` +
// `document.fonts.ready` re-layout path needs browser verification (see PR body).

import assert from "node:assert/strict";
import { test } from "node:test";
import { CANVAS_FONT_FALLBACK, resolveCanvasFont } from "../canvas-font.js";

test("resolveCanvasFont names the curated family with weight + size (#149)", () => {
  assert.equal(resolveCanvasFont("nunito", 400, 24), '400 24px "Nunito", sans-serif');
  assert.equal(resolveCanvasFont("nunito", 700, 30), '700 30px "Nunito", sans-serif');
});

test("resolveCanvasFont uses the CJK family name so full-width glyphs measure right", () => {
  assert.equal(resolveCanvasFont("noto-sans-kr", 400, 18), '400 18px "Noto Sans KR", sans-serif');
});

test("resolveCanvasFont falls back to the generic family for absent/unknown ids", () => {
  assert.equal(resolveCanvasFont(undefined, 400, 20), `400 20px ${CANVAS_FONT_FALLBACK}`);
  assert.equal(resolveCanvasFont("not-a-real-family", 700, 16), `700 16px ${CANVAS_FONT_FALLBACK}`);
});
