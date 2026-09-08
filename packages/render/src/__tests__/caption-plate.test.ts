// Narration caption legibility (#186).
//
// `narration` painted a fixed near-black ink (#2a1b14) straight onto the artwork
// with no backing plate. Over the dark art most dramatic webtoons use, the
// caption vanished: the issue measured 1.50:1 and 1.12:1 against real cuts of
// examples/dead-air, where WCAG AA for body text is 4.5:1.
//
// These tests assert the RESOLVED CONTRAST of what the renderer actually returns,
// not that some color was picked. The WCAG arithmetic below is deliberately a
// SECOND, independent implementation written from the spec: asserting with
// `@toony/render`'s own contrast module would only prove that module is
// self-consistent with itself.

import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBubble } from "../layout.js";
import { bubbleKindStyle, CAPTION_MIN_CONTRAST, resolveCaptionPlate } from "../style.js";
import { narrationOverlay, overlay } from "./fixtures.js";

const W = 800;
const H = 1200;

// --- An independent WCAG 2.x implementation, written from the spec -----------

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  assert.ok(m, `test helper only handles #rrggbb, got "${hex}"`);
  return [
    Number.parseInt(m[1] as string, 16),
    Number.parseInt(m[2] as string, 16),
    Number.parseInt(m[3] as string, 16),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over: what an SVG fill+fill-opacity and a canvas fill+globalAlpha draw. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

/**
 * The contrast a reader actually gets: the caption's ink against the plate the
 * render plan resolved, composited over the artwork behind it.
 *
 * A resolved plate color that no consumer paints is worth nothing, so this first
 * asserts the plan actually carries a drawable body. Without that check every
 * contrast assertion below would still pass with the plate switched back off —
 * `fill` is resolved either way, it is `pathD` that decides whether it is drawn.
 */
function resolvedContrast(
  plan: { fill: string; fillOpacity: number; textColor: string; hasBubble: boolean; pathD: string },
  bg: string,
) {
  assert.ok(plan.hasBubble, "the caption must draw a body for its plate to exist");
  assert.ok(plan.pathD.length > 0, "the caption plate must be a real path, not an empty one");
  return ratio(rgb(plan.textColor), over(rgb(plan.fill), plan.fillOpacity, rgb(bg)));
}

// The artwork the issue measured against, plus the two extremes. Pure black and
// pure white bound every possible cut, so clearing both clears any artwork.
const DARK_ART = "#101319"; // dead-air cut-007, mean under the caption box
const DIM_ART = "#423a38"; // dead-air cut-001, mean under the caption box
const BLACK = "#000000";
const LIGHT_ART = "#e9e4da";
const WHITE = "#ffffff";

// --- The defect ---------------------------------------------------------------

test("the pre-#186 borderless caption really was unreadable over dark art", () => {
  // The unplated caption is the ink straight on the artwork. This is the bug the
  // ticket measured; it is asserted here so the fix below is measured against a
  // reproduced failure rather than an assumed one.
  const ink = rgb(bubbleKindStyle("narration").text);
  assert.ok(ratio(ink, rgb(DARK_ART)) < 1.5, "ink on cut-007 art should be ~1.1:1");
  assert.ok(ratio(ink, rgb(DIM_ART)) < 2, "ink on cut-001 art should be ~1.5:1");
});

// --- The fix ------------------------------------------------------------------

test("a narration caption clears WCAG AA over light AND dark backgrounds (#186)", () => {
  const plan = layoutBubble(narrationOverlay, W, H);
  for (const bg of [WHITE, LIGHT_ART, DIM_ART, DARK_ART, BLACK]) {
    const got = resolvedContrast(plan, bg);
    assert.ok(
      got >= CAPTION_MIN_CONTRAST,
      `caption over ${bg} resolved ${got.toFixed(2)}:1, need ${CAPTION_MIN_CONTRAST}:1`,
    );
  }
});

test("the authored caption fill of the shipped examples clears AA over dark art", () => {
  // examples/dead-air and examples/last-train both author `fill: "#f5efe2"` on
  // their narration overlays — data the borderless caption silently dropped.
  const plan = layoutBubble({ ...narrationOverlay, fill: "#f5efe2", opacity: 1 }, W, H);
  assert.equal(plan.fill, "#f5efe2", "the authored plate color is honored, not replaced");
  assert.ok(resolvedContrast(plan, DARK_ART) >= CAPTION_MIN_CONTRAST);
  assert.ok(resolvedContrast(plan, BLACK) >= CAPTION_MIN_CONTRAST);
});

test("a legal but too-faint authored opacity is raised to the AA floor (#186)", () => {
  // 0.2 is a legal `opacity` (schema: 0..1). Drawn as authored it would leave a
  // ghost plate that fails over dark art — so the resolver floors it. This is the
  // mutation that a test asserting only the DEFAULT plate would never catch.
  const faint = { ...narrationOverlay, fill: "#f5efe2", opacity: 0.2 };
  const asAuthored = ratio(
    rgb(bubbleKindStyle("narration").text),
    over(rgb("#f5efe2"), 0.2, rgb(BLACK)),
  );
  assert.ok(
    asAuthored < CAPTION_MIN_CONTRAST,
    "0.2 alpha must genuinely fail, or this proves nothing",
  );

  const plan = layoutBubble(faint, W, H);
  assert.ok(plan.fillOpacity > 0.2, "the floor must actually raise the authored alpha");
  for (const bg of [WHITE, DARK_ART, BLACK]) {
    assert.ok(resolvedContrast(plan, bg) >= CAPTION_MIN_CONTRAST, `raised plate failed over ${bg}`);
  }
});

test("the floor is the MINIMUM alpha that works, not a blanket opaque plate", () => {
  // A caption plate should stay as translucent as the author asked for while
  // still being legible; flooring to 1 would be a heavier change than needed.
  const plan = layoutBubble({ ...narrationOverlay, fill: "#f5efe2", opacity: 0.2 }, W, H);
  assert.ok(plan.fillOpacity < 1, `expected a partly translucent plate, got ${plan.fillOpacity}`);
  // Below the resolved alpha (past the quantization headroom) it must fail — the
  // resolver sits just above the edge, it does not slam the plate opaque.
  const below = ratio(
    rgb(plan.textColor),
    over(rgb(plan.fill), plan.fillOpacity - 0.05, rgb(BLACK)),
  );
  assert.ok(below < CAPTION_MIN_CONTRAST, "resolved alpha is not near-minimal");
});

test("an authored opacity above the floor is left exactly as authored", () => {
  const plan = layoutBubble({ ...narrationOverlay, fill: "#f5efe2", opacity: 0.9 }, W, H);
  assert.equal(plan.fillOpacity, 0.9);
});

test("opacity 0 is an explicit opt-out: the caption stays fully borderless", () => {
  // The pre-#186 look is still reachable with no schema change — an author who
  // reserved a light area in the art can ask for no plate at all.
  const plan = layoutBubble({ ...narrationOverlay, fill: "#f5efe2", opacity: 0 }, W, H);
  assert.equal(plan.fillOpacity, 0, "an explicit transparent plate must not be forced open");
  assert.equal(plan.strokeWidth, 0, "and nothing may be stroked in its place");
});

test("an authored textColor keeps its ink AND gets the same contrast floor", () => {
  // The ink and the plate color are the author's; the alpha between them is the
  // renderer's. A lighter authored ink needs MORE plate to clear AA, so the floor
  // is computed against the resolved ink rather than the per-kind one.
  const ink = "#4a3b2f";
  const plan = layoutBubble(
    { ...narrationOverlay, fill: "#f5efe2", opacity: 0.35, textColor: ink },
    W,
    H,
  );
  assert.equal(plan.textColor, ink, "the authored ink is never repainted");
  assert.equal(plan.fill, "#f5efe2", "the authored plate color is never repainted");
  assert.ok(plan.fillOpacity > 0.35, "a lighter ink must pull the plate alpha up");
  for (const bg of [WHITE, DARK_ART, BLACK]) {
    assert.ok(resolvedContrast(plan, bg) >= CAPTION_MIN_CONTRAST, `authored ink failed over ${bg}`);
  }
  // And the floor tracks the ink: this lighter ink needs a heavier plate than the
  // per-kind dark one does, so it is not one constant reused for every caption.
  const dflt = layoutBubble({ ...narrationOverlay, fill: "#f5efe2", opacity: 0.35 }, W, H);
  assert.ok(
    plan.fillOpacity > dflt.fillOpacity,
    `lighter ink resolved ${plan.fillOpacity} vs default ink ${dflt.fillOpacity}`,
  );
});

test("a plate and ink no alpha can separate are left exactly as authored", () => {
  // A dark caption plate under the dark per-kind ink cannot be rescued by
  // opacity, and repainting a color the author chose is not the renderer's call.
  const plan = layoutBubble({ ...narrationOverlay, fill: "#101010", opacity: 0.6 }, W, H);
  assert.equal(plan.fill, "#101010");
  assert.equal(plan.fillOpacity, 0.6);
});

test("a color the core cannot measure is left exactly as authored", () => {
  // A named CSS color is legal in the schema (`fill` is any non-empty string) but
  // is not something the core can run luminance on, so it makes no promise.
  const plan = layoutBubble({ ...narrationOverlay, fill: "papayawhip", opacity: 0.5 }, W, H);
  assert.equal(plan.fill, "papayawhip");
  assert.equal(plan.fillOpacity, 0.5);
});

// --- The plate is one resolved decision, not a constant ----------------------

test("resolveCaptionPlate is the single narration decision; other kinds get none", () => {
  for (const kind of ["speech", "thought", "shout", "whisper", "sfx", "beat", "ambient"] as const) {
    assert.equal(
      resolveCaptionPlate(kind, { fill: "#f5efe2", opacity: 0.2, ink: "#2a1b14" }),
      null,
      `${kind} must not resolve a caption plate`,
    );
  }
  const plate = resolveCaptionPlate("narration", {
    fill: "#f5efe2",
    opacity: 0.2,
    ink: "#2a1b14",
  });
  assert.ok(plate);
  // The plan a consumer draws carries exactly what the shared resolver decided.
  const plan = layoutBubble({ ...narrationOverlay, fill: "#f5efe2", opacity: 0.2 }, W, H);
  assert.equal(plan.fill, plate.color);
  assert.equal(plan.fillOpacity, plate.alpha);
});

test("the plate alpha is the whole alpha: the resolved fill is opaque", () => {
  // The per-kind default carries its own alpha (`rgba(…, 0.95)`). If that reached
  // a consumer it would multiply with fillOpacity and the composite would no
  // longer be the one the contrast floor was proven against.
  const plan = layoutBubble({ ...narrationOverlay, fill: "" }, W, H);
  assert.match(
    plan.fill,
    /^#[0-9a-f]{6}$/i,
    `resolved plate fill must be opaque, got ${plan.fill}`,
  );
});

// --- Non-narration kinds are untouched ---------------------------------------

test("non-narration kinds keep their authored fill and opacity exactly (#186)", () => {
  for (const kind of ["speech", "thought", "shout", "whisper", "beat", "ambient"] as const) {
    // 0.2 is exactly the value the narration floor would have raised.
    const plan = layoutBubble(
      overlay({ id: `ov-${kind}`, kind, speaker: "Mina", fill: "#101010", opacity: 0.2 }),
      W,
      H,
    );
    assert.equal(plan.fill, "#101010", `${kind} fill must pass through untouched`);
    assert.equal(plan.fillOpacity, 0.2, `${kind} opacity must pass through untouched`);
  }
});

test("non-narration kinds keep their per-kind default fill and border (#186)", () => {
  for (const kind of ["speech", "thought", "shout", "whisper", "beat", "ambient"] as const) {
    const plan = layoutBubble(overlay({ id: `d-${kind}`, kind, speaker: "Mina", fill: "" }), W, H);
    assert.equal(plan.fill, bubbleKindStyle(kind).fill, `${kind} must keep its per-kind fill`);
    assert.ok(plan.strokeWidth > 0, `${kind} must keep its default border`);
  }
});

test("SFX is still bare outlined text with no plate (#186)", () => {
  const plan = layoutBubble(overlay({ id: "s", kind: "sfx", speaker: "", text: "BOOM" }), W, H);
  assert.equal(plan.hasBubble, false);
  assert.equal(plan.pathD, "");
  assert.ok(plan.textOutlineWidth > 0);
});
