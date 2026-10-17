// The export raster must draw lettering with the SAME curated face the studio
// SVG resolves — not the host's default sans. These tests assert that:
//   1. registering + drawing the curated faces changes the produced pixels vs a
//      bare fallback, and different families produce different rasters (proof the
//      selected face is actually applied, not a single fallback for all);
//   2. the resolved canvas family name follows the render plan's family + weight.
// Verification is environment-neutral (asserts on produced pixels/metrics), so it
// holds on CI/Linux as well as macOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFontFamily } from "@toony/fonts";
import type { LetteringOverlay } from "@toony/schema";
import { type ComposedCut, composeCut } from "../compose.js";
import { canvasFontFamily, registerToonyFonts } from "../fonts.js";

/** Build a Latin SFX overlay (bare text, no bubble) using a given family. */
function sfxOverlay(fontFamily: LetteringOverlay["fontFamily"]): LetteringOverlay {
  return {
    id: `ov-${fontFamily}`,
    cutId: "cut-1",
    speaker: "",
    kind: "sfx",
    text: "BOOM",
    font: "label",
    fill: "#000000",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 },
    overflow: false,
    reviewStatus: "draft",
    fontFamily,
    fontSize: 48,
  };
}

/** Count dark (non-near-white) pixels across the whole raster — i.e. glyph ink. */
function inkPixels(composed: ComposedCut): number {
  const ctx = composed.canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, composed.width, composed.height);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (r < 200 && g < 200 && b < 200) ink++;
  }
  return ink;
}

test("canvasFontFamily maps a family + weight to the registered name (mirrors render)", () => {
  // 400 → the family's display name; 700 → the "<name> 700" variant.
  assert.equal(canvasFontFamily("nunito", 400, "speech"), "Nunito");
  assert.equal(canvasFontFamily("nunito", 700, "speech"), "Nunito 700");
  // Absent/unknown family falls back exactly like render's resolver.
  assert.equal(
    canvasFontFamily(undefined, 400, "shout"),
    resolveFontFamily(undefined, "shout").name,
  );
});

test("registerToonyFonts is idempotent and the curated faces actually draw ink", async () => {
  registerToonyFonts();
  registerToonyFonts(); // second call must be a no-op, not throw
  const composed = await composeCut([sfxOverlay("bangers")], null, 200);
  assert.ok(inkPixels(composed) > 0, "Bangers SFX text must draw visible ink");
});

test("different curated families produce visibly different rasters (selected face is applied)", async () => {
  // Two display faces with very different shapes; same text, size, geometry.
  const bangers = await composeCut([sfxOverlay("bangers")], null, 200);
  const anton = await composeCut([sfxOverlay("anton")], null, 200);

  const ctxA = bangers.canvas.getContext("2d");
  const ctxB = anton.canvas.getContext("2d");
  const a = ctxA.getImageData(0, 0, bangers.width, bangers.height).data;
  const b = ctxB.getImageData(0, 0, anton.width, anton.height).data;
  assert.equal(a.length, b.length);

  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  }
  // If both fell back to the same default sans, the rasters would be identical.
  assert.ok(diff > 50, `expected the two faces to differ; differing pixels = ${diff}`);
});

// --- Dialogue language (#213) ------------------------------------------------
// The raster must draw the default dialogue face the project's declared language
// picks, not a fixed one. These compare produced PIXELS, so they only pass if the
// language actually reaches the face the canvas draws with.

/** A speech bubble with NO pinned family, so it resolves through the default. */
function defaultSpeechOverlay(): LetteringOverlay {
  return {
    id: "ov-speech-default",
    cutId: "cut-1",
    speaker: "",
    kind: "speech",
    text: "Hello there",
    font: "body",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.1, y: 0.3, width: 0.8, height: 0.3 },
    overflow: false,
    reviewStatus: "draft",
    fontSize: 28,
  };
}

/** Every pixel of a composed raster, for exact before/after comparison. */
function pixels(composed: ComposedCut): Uint8ClampedArray {
  const ctx = composed.canvas.getContext("2d");
  return ctx.getImageData(0, 0, composed.width, composed.height).data;
}

function differingPixels(a: ComposedCut, b: ComposedCut): number {
  const pa = pixels(a);
  const pb = pixels(b);
  assert.equal(pa.length, pb.length);
  let diff = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) diff++;
  }
  return diff;
}

test("a declared dialogue language draws the raster its script's face draws", async () => {
  registerToonyFonts();
  const overlay = defaultSpeechOverlay();
  // Pinning the family explicitly is the reference: declaring the language must
  // land on exactly those pixels, which it can only do via the same face.
  const en = await composeCut([overlay], null, 400, { dialogueLanguage: "en" });
  const pinnedLatin = await composeCut([{ ...overlay, fontFamily: "nunito" }], null, 400);
  assert.equal(differingPixels(en, pinnedLatin), 0, "en must draw the Latin sans");

  const ko = await composeCut([overlay], null, 400, { dialogueLanguage: "ko" });
  const pinnedKorean = await composeCut([{ ...overlay, fontFamily: "noto-sans-kr" }], null, 400);
  assert.equal(differingPixels(ko, pinnedKorean), 0, "ko must draw the Korean sans");

  // If the language never reached the canvas, both rasters would be identical.
  assert.ok(differingPixels(en, ko) > 50, "en and ko must not draw the same face");
});

test("declaring no dialogue language draws what the export drew before #213", async () => {
  registerToonyFonts();
  const overlay = defaultSpeechOverlay();
  const none = await composeCut([overlay], null, 400);
  const baseline = await composeCut([{ ...overlay, fontFamily: "noto-sans-kr" }], null, 400);
  assert.equal(differingPixels(none, baseline), 0, "the no-language default must be unchanged");
});

test("a pinned family draws the same raster whatever language is declared", async () => {
  registerToonyFonts();
  const overlay = { ...defaultSpeechOverlay(), fontFamily: "gaegu" as const };
  const en = await composeCut([overlay], null, 400, { dialogueLanguage: "en" });
  const ko = await composeCut([overlay], null, 400, { dialogueLanguage: "ko" });
  const none = await composeCut([overlay], null, 400);
  assert.equal(differingPixels(en, none), 0, "en moved a pinned face");
  assert.equal(differingPixels(ko, none), 0, "ko moved a pinned face");
});

test("the canvas family name follows the language-resolved face (read equals export)", () => {
  // The studio SVG sets `plan.fontStack`; the raster puts `canvasFontFamily` of
  // `plan.fontFamily` in `ctx.font`. Both start from one `resolveFontFamily`, so
  // the name the canvas uses must be the name the resolved family carries.
  for (const language of ["en", "ko", "ja"]) {
    const family = resolveFontFamily(undefined, "speech", language);
    assert.equal(canvasFontFamily(family.id, 400, "speech"), family.name);
    assert.ok(family.stack.includes(`"${family.name}"`), `${language} stack must name the face`);
  }
});

test("a Korean line renders the CJK subset face (non-empty ink, not a blank fallback)", async () => {
  // Korean text outside the Latin-only faces' coverage; the curated KO face must
  // supply the glyphs (otherwise the box would be empty / tofu only).
  const overlay = sfxOverlay("noto-sans-kr");
  overlay.text = "안녕";
  const composed = await composeCut([overlay], null, 200);
  assert.ok(inkPixels(composed) > 0, "Korean text must render glyph ink from the KO face");
});
