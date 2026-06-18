import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFontFamilyForKind, getFontFamily } from "@toony/fonts";
import { cutPlacementFrame, GUTTER_BAND_FRAC, layoutBubble, layoutCut } from "../layout.js";
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

test("narration is a borderless caption: tailless, no balloon, text only (#93)", () => {
  const r = layoutBubble(narrationOverlay, W, H);
  // Borderless caption: no balloon outline drawn, but it is a text-bearing kind
  // (plain text, not sfx-style outlined), so it keeps hasBubble + renders lines.
  assert.ok(r.hasBubble);
  assert.equal(r.tail, null);
  assert.equal(r.pathD, "");
  assert.equal(r.outline.length, 0);
  assert.ok(r.lines.length >= 1);
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

// --- WYSIWYG parity foundations (#77/#83/#85) -------------------------------

test("SFX exposes a single-source text-outline width; bubbles expose 0", () => {
  const sfx = layoutBubble(sfxOverlay, W, H);
  assert.equal(sfx.hasBubble, false);
  assert.equal(sfx.textOutlineWidth, Math.max(1, sfx.text.fontSize * 0.12));
  // A bubbled kind has no bare-text outline.
  assert.equal(layoutBubble(speechOverlay, W, H).textOutlineWidth, 0);
});

test("the injected measurer receives the resolved font family (#77)", () => {
  const seen: Array<{ weight: number | undefined; family: string | undefined }> = [];
  const spy = (text: string, size: number, weight?: 400 | 700, family?: string) => {
    seen.push({ weight, family });
    return text.length * size * 0.5;
  };
  const r = layoutBubble(overlay({ id: "fam", text: "hello world" }), W, H, { measure: spy });
  assert.ok(seen.length > 0, "measurer should be called");
  // Render forwards its resolved family id (never undefined) to the measurer.
  assert.equal(r.fontFamily, seen[0]?.family);
  assert.notEqual(seen[0]?.family, undefined);
});

test("measure weight follows CSS face matching: 600→bold, 500→regular (#85)", () => {
  let captured: number[] = [];
  const spy = (text: string, size: number, weight: 400 | 700 = 400): number => {
    captured.push(weight);
    return text.length * size * 0.5;
  };
  layoutBubble(overlay({ id: "w6", fontWeight: 600, text: "x" }), W, H, { measure: spy });
  // Distinct weights actually measured. 600 must resolve to the bold (700) face.
  assert.deepEqual([...new Set(captured)], [700], `600 → bold; saw ${captured}`);
  captured = [];
  layoutBubble(overlay({ id: "w5", fontWeight: 500, text: "x" }), W, H, { measure: spy });
  assert.deepEqual([...new Set(captured)], [400], `500 → regular; saw ${captured}`);
});

// --- Bubble grammar: kinds, tone→shape, tailTarget (#93) -------------------

test("tone refines the outline shape; neutral keeps the rounded silhouette", () => {
  const rounded = layoutBubble(overlay({ id: "r", kind: "speech" }), W, H);
  const scalloped = layoutBubble(overlay({ id: "s", kind: "speech", tone: "shout" }), W, H);
  const jagged = layoutBubble(overlay({ id: "j", kind: "speech", tone: "aggressive" }), W, H);
  // Decorated silhouettes add lobes/spikes → strictly more outline commands.
  assert.ok(scalloped.outline.length > rounded.outline.length, "scalloped should add lobes");
  assert.ok(jagged.outline.length > rounded.outline.length, "jagged should add spikes");
  // All shapes stay M/L/A so SVG path and canvas trace are identical (parity).
  for (const cmd of [...scalloped.outline, ...jagged.outline]) {
    assert.ok(cmd.k === "M" || cmd.k === "L" || cmd.k === "A");
  }
  assert.ok(scalloped.pathD.startsWith("M ") && scalloped.pathD.endsWith("Z"));
});

test("shout kind defaults to a scalloped silhouette; thought is bumpy", () => {
  const rounded = layoutBubble(overlay({ id: "r2", kind: "speech" }), W, H);
  const shout = layoutBubble(overlay({ id: "sh", kind: "shout", speaker: "X" }), W, H);
  const thought = layoutBubble(overlay({ id: "th", kind: "thought" }), W, H);
  assert.ok(shout.outline.length > rounded.outline.length);
  assert.ok(thought.outline.length > rounded.outline.length);
});

test("beat renders an ellipsis when it has no authored text", () => {
  const beat = layoutBubble(overlay({ id: "b", kind: "beat", text: "" }), W, H);
  assert.ok(beat.hasBubble);
  assert.equal(beat.lines.map((l) => l.text).join(""), "...");
  assert.ok(beat.outline.length > 0); // rounded minimal bubble
});

test("ambient reads at a smaller font than speech in the same box", () => {
  const geometry = { x: 0.1, y: 0.1, width: 0.6, height: 0.4 };
  const speech = layoutBubble(overlay({ id: "sp", kind: "speech", text: "hi", geometry }), W, H);
  const ambient = layoutBubble(overlay({ id: "am", kind: "ambient", text: "hi", geometry }), W, H);
  assert.ok(
    ambient.text.fontSize < speech.text.fontSize,
    `${ambient.text.fontSize} < ${speech.text.fontSize}`,
  );
});

test("an off-panel tailTarget clamps the drawn tail tip to the art edge", () => {
  const r = layoutBubble(
    overlay({
      id: "tt",
      kind: "speech",
      tail: null,
      tailTarget: { x: 1.5, y: 0.5 }, // off-panel to the right
      geometry: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    }),
    W,
    H,
  );
  assert.ok(r.tail, "tailTarget should produce a tail");
  // 1.5*W is off-panel; the drawn tip is clamped to the art edge (x === W).
  assert.equal(r.tail.tip.x, W);
});

test("tailTarget takes precedence over tail", () => {
  const r = layoutBubble(
    overlay({
      id: "tp",
      kind: "speech",
      tail: { x: 0.0, y: 0.5 }, // would point left
      tailTarget: { x: 1.0, y: 0.5 }, // points right — wins
      geometry: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    }),
    W,
    H,
  );
  assert.ok(r.tail);
  assert.equal(r.tail.tip.x, W); // used tailTarget (right), not tail (left)
});

// --- Gutter placement: in-bounds reserved strip (#98) ----------------------

test("in_panel placement is back-compat: band null, frame == art == full canvas", () => {
  const r = layoutBubble(speechOverlay, W, H);
  assert.equal(r.band, null);
  assert.deepEqual(r.frame, { x: 0, y: 0, width: W, height: H });
  assert.deepEqual(r.art, { x: 0, y: 0, width: W, height: H });
  // Box maps geometry over the whole canvas (unchanged).
  assert.equal(r.box.x, speechOverlay.geometry.x * W);
  assert.equal(r.box.width, speechOverlay.geometry.width * W);
});

test("gutter placement lays the bubble inside the reserved strip (right side)", () => {
  const r = layoutBubble(
    overlay({
      id: "g",
      placement: "gutter",
      geometry: { x: 0.1, y: 0.1, width: 0.6, height: 0.3 },
    }),
    W,
    H,
  );
  const bandW = W * GUTTER_BAND_FRAC;
  assert.ok(r.band);
  assert.deepEqual(r.band, { x: W - bandW, y: 0, width: bandW, height: H });
  assert.deepEqual(r.art, { x: 0, y: 0, width: W - bandW, height: H });
  // Box is mapped WITHIN the band, never over the art.
  assert.equal(r.box.x, W - bandW + 0.1 * bandW);
  assert.equal(r.box.width, 0.6 * bandW);
  assert.ok(r.box.x >= r.band.x);
});

test("gutter placement on the left reserves the strip on the left", () => {
  const r = layoutBubble(overlay({ id: "gl", placement: "gutter", placementSide: "left" }), W, H);
  const bandW = W * GUTTER_BAND_FRAC;
  assert.deepEqual(r.band, { x: 0, y: 0, width: bandW, height: H });
  assert.deepEqual(r.art, { x: bandW, y: 0, width: W - bandW, height: H });
});

test("a gutter bubble's tailTarget is normalized in ART space and clamped to the art edge", () => {
  const r = layoutBubble(
    overlay({
      id: "gt",
      placement: "gutter",
      placementSide: "right",
      tail: null,
      tailTarget: { x: 0.5, y: 0.5 }, // mid-art
      geometry: { x: 0.2, y: 0.1, width: 0.6, height: 0.3 },
    }),
    W,
    H,
  );
  const bandW = W * GUTTER_BAND_FRAC;
  assert.ok(r.tail);
  // tip x = art.x + 0.5*art.width = 0 + 0.5*(W-bandW) → inside the art, left of the band.
  assert.equal(r.tail.tip.x, 0.5 * (W - bandW));
  assert.ok(r.tail.tip.x < (r.band?.x ?? W));
});

test("cutPlacementFrame reserves bands and yields the remaining art rect (#98)", () => {
  const none = cutPlacementFrame([speechOverlay], W, H);
  assert.deepEqual(none.bands, []);
  assert.deepEqual(none.art, { x: 0, y: 0, width: W, height: H });
  const bandW = W * GUTTER_BAND_FRAC;
  const right = cutPlacementFrame([overlay({ id: "g", placement: "gutter" })], W, H);
  assert.equal(right.bands.length, 1);
  assert.deepEqual(right.art, { x: 0, y: 0, width: W - bandW, height: H });
  const left = cutPlacementFrame(
    [overlay({ id: "g", placement: "gutter", placementSide: "left" })],
    W,
    H,
  );
  assert.deepEqual(left.art, { x: bandW, y: 0, width: W - bandW, height: H });
});

// --- SFX render modes (#99) -------------------------------------------------

test("typeset is the default SFX mode and leaves the plan unchanged (back-compat)", () => {
  const plain = layoutBubble(sfxOverlay, W, H);
  const typeset = layoutBubble({ ...sfxOverlay, sfxMode: "typeset" }, W, H);
  // An absent sfxMode renders identically to an explicit typeset, and neither
  // produces an impact decoration (the legacy SFX path is untouched).
  assert.equal(plain.impact, null);
  assert.equal(typeset.impact, null);
  assert.deepEqual(typeset, plain);
  // typeset keeps the per-kind default SFX face.
  assert.equal(plain.fontFamily, defaultFontFamilyForKind("sfx"));
});

test("hand_lettered swaps to a loose hand face without mutating the text", () => {
  const r = layoutBubble({ ...sfxOverlay, sfxMode: "hand_lettered" }, W, H);
  assert.equal(r.fontFamily, "patrick-hand");
  // The stored text is preserved verbatim — only the face changed.
  assert.equal(r.text.lines.join(" ").replace(/\s+/g, ""), sfxOverlay.text.replace(/\s+/g, ""));
  assert.equal(r.impact, null);
  // An explicit fontFamily still wins over the hand-lettered swap.
  const explicit = layoutBubble(
    { ...sfxOverlay, sfxMode: "hand_lettered", fontFamily: "anton" },
    W,
    H,
  );
  assert.equal(explicit.fontFamily, "anton");
});

test("hand_lettered only swaps the face for SFX, not other kinds", () => {
  // sfxMode is meaningless on non-sfx kinds: the speech face is unchanged.
  const speech = layoutBubble({ ...speechOverlay, sfxMode: "hand_lettered" }, W, H);
  assert.equal(speech.fontFamily, defaultFontFamilyForKind("speech"));
});

test("impact_band makes the SFX box full-width over the art and adds a pure-segment burst", () => {
  const r = layoutBubble({ ...sfxOverlay, sfxMode: "impact_band" }, W, H);
  // Full-width band: the box spans the whole art width regardless of the authored
  // geometry x/width.
  assert.equal(r.box.x, 0);
  assert.equal(r.box.width, W);
  assert.ok(r.impact, "expected an impact decoration");
  // Speed-lines and burst are PURE straight segments — only finite numeric coords,
  // no arcs/curves (parity with the canvas trace).
  assert.ok(r.impact.rays.length > 0);
  for (const ray of r.impact.rays) {
    for (const v of [ray.x1, ray.y1, ray.x2, ray.y2]) assert.ok(Number.isFinite(v));
  }
  assert.ok(r.impact.burst.length >= 6);
  for (const p of r.impact.burst) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  assert.ok(r.impact.rayWidth > 0 && r.impact.burstStrokeWidth > 0);
});

test("impact_band stays within the art rect when a gutter strip is reserved", () => {
  const r = layoutBubble({ ...sfxOverlay, sfxMode: "impact_band" }, W, H);
  // With no gutter overlay present, the art is the whole frame, so the band fills
  // the full width; the burst points all sit inside the box bounds.
  for (const p of r.impact?.burst ?? []) {
    assert.ok(p.x >= r.box.x - 1 && p.x <= r.box.x + r.box.width + 1);
    assert.ok(p.y >= r.box.y - 1 && p.y <= r.box.y + r.box.height + 1);
  }
});
