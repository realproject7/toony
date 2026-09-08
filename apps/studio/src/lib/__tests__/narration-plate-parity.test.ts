// Studio-side narration caption parity (#186), in the #157 node:test harness.
//
// The studio Read view (`CutOverlay`) and the focused editor (`CutEditor`) draw a
// bubble as `plan.hasBubble && <path d={plan.pathD} fill={plan.fill}
// fillOpacity={plan.fillOpacity} stroke={plan.stroke} strokeWidth={plan.strokeWidth}/>`
// — every value read straight off the `@toony/render` plan, which is exactly what
// `@toony/export`'s `drawBubble` traces onto the canvas. So the caption plate can
// only be one decision, made once in the render core (#112/#135/#147).
//
// Those components are React (not node-testable here), so this asserts the shared
// surface they consume: the studio's OWN `layoutCut` call resolves the identical
// plate as the export's, and the SVG compositing that call feeds clears WCAG AA
// over light and dark artwork alike.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTION_MIN_CONTRAST, layoutCut, resolveCaptionPlate } from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";

const WIDTH = 900;
const HEIGHT = 1350;

function caption(over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id: "cap",
    cutId: "cut-001",
    speaker: "",
    kind: "narration",
    text: "Nobody calls this late. That's the point.",
    font: "sans-serif",
    fill: "#f5efe2",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.08, y: 0.8, width: 0.84, height: 0.13 },
    overflow: false,
    reviewStatus: "human-edited",
    ...over,
  };
}

/** The fields both consumers bind onto their bubble body. */
function bodyStyle(plan: {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  pathD: string;
  textColor: string;
}) {
  return {
    fill: plan.fill,
    fillOpacity: plan.fillOpacity,
    stroke: plan.stroke,
    strokeWidth: plan.strokeWidth,
    pathD: plan.pathD,
    textColor: plan.textColor,
  };
}

/** An independent WCAG 2.x ratio, written from the spec (not render's own math). */
function contrast(fg: readonly number[], bg: readonly number[]): number {
  const lum = (px: readonly number[]): number => {
    const lin = (v: number): number => {
      const c = (v ?? 0) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(px[0] ?? 0) + 0.7152 * lin(px[1] ?? 0) + 0.0722 * lin(px[2] ?? 0);
  };
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hex(color: string): number[] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  assert.ok(m, `expected an opaque hex color, got "${color}"`);
  return [1, 2, 3].map((i) => Number.parseInt(m[i] as string, 16));
}

/** What an SVG `fill` + `fill-opacity` paints over the artwork (source-over). */
function svgComposite(fill: string, fillOpacity: number, art: string): number[] {
  const f = hex(fill);
  const b = hex(art);
  return [0, 1, 2].map(
    (i) => (f[i] as number) * fillOpacity + (b[i] as number) * (1 - fillOpacity),
  );
}

test("the studio and the export resolve the identical caption plate (#186 parity)", () => {
  // The studio's call (`CutOverlay`) passes a browser measurer once fonts are
  // ready and none before; the export's (`composeCut`) passes a canvas measurer.
  // The plate must not depend on which — otherwise the Read view and the raster
  // would disagree the moment fonts load.
  const overlays = [caption()];
  const studioBeforeFonts = layoutCut(overlays, WIDTH, HEIGHT, undefined);
  const studioAfterFonts = layoutCut(overlays, WIDTH, HEIGHT, {
    measure: (text, size) => text.length * size * 0.54,
  });
  const exported = layoutCut(overlays, WIDTH, HEIGHT, {
    measure: (text, size) => text.length * size * 0.61,
  });

  const first = studioBeforeFonts[0];
  const second = studioAfterFonts[0];
  const third = exported[0];
  assert.ok(first && second && third);
  assert.deepEqual(bodyStyle(first), bodyStyle(second));
  assert.deepEqual(bodyStyle(first), bodyStyle(third));
});

test("the studio's plate comes from the shared resolver, not a studio constant (#186)", () => {
  const plan = layoutCut([caption({ opacity: 0.2 })], WIDTH, HEIGHT)[0];
  assert.ok(plan);
  const shared = resolveCaptionPlate("narration", {
    fill: "#f5efe2",
    opacity: 0.2,
    ink: plan.textColor,
  });
  assert.ok(shared);
  assert.equal(plan.fill, shared.color);
  assert.equal(plan.fillOpacity, shared.alpha);
});

test("the studio SVG's composite clears WCAG AA over light and dark art (#186)", () => {
  // #101319 and #423a38 are the means the ticket measured under the dead-air
  // captions, where the unplated caption read 1.12:1 and 1.50:1.
  const plan = layoutCut([caption()], WIDTH, HEIGHT)[0];
  assert.ok(plan);
  // The studio only renders the `<path>` when `hasBubble` and only paints when
  // `pathD` is a real path. Without this the composite below would be arithmetic
  // about a surface the studio never draws — and would pass with the plate off.
  assert.ok(plan.hasBubble && plan.pathD.length > 0, "the plate must actually be drawn");
  for (const art of ["#ffffff", "#e9e4da", "#423a38", "#101319", "#000000"]) {
    const painted = svgComposite(plan.fill, plan.fillOpacity, art);
    const got = contrast(hex(plan.textColor), painted);
    assert.ok(
      got >= CAPTION_MIN_CONTRAST,
      `studio caption over ${art} resolved ${got.toFixed(2)}:1`,
    );
  }
});

test("the studio draws the caption plate at all: hasBubble + a closed path (#186)", () => {
  // Both studio surfaces gate the body on `plan.hasBubble` and bind `plan.pathD`.
  // An empty `pathD` is what made the caption invisible before this change.
  const plan = layoutCut([caption()], WIDTH, HEIGHT)[0];
  assert.ok(plan);
  assert.equal(plan.hasBubble, true);
  assert.ok(plan.pathD.startsWith("M ") && plan.pathD.endsWith("Z"));
  assert.ok(plan.fillOpacity > 0);
});
