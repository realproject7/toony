// A canvas-backed text measurer for @toony/render's layout.
//
// Passing this into layoutCut/layoutBubble makes export wrap and auto-fit bubble
// text with the same pixel-accurate metrics it will be DRAWN at. It measures with
// the SAME registered curated face the raster draws (#56/#77): the render plan's
// resolved `fontFamily` flows in as the 4th arg, and we key `ctx.font` off the
// matching registered canvas family — so a line never wraps under one face and
// renders under another. When no/unknown family is supplied (legacy callers), it
// falls back to the generic family.

import { createCanvas } from "@napi-rs/canvas";
import { getFontFamily } from "@toony/fonts";
import type { MeasureWidth } from "@toony/render";
import { canvasFamilyName, cssFaceWeight, registerToonyFonts } from "./fonts.js";

/** Generic fallback family when the overlay's family is absent/unknown. */
export const FONT_FAMILY = "sans-serif";

/** Build a deterministic, canvas-backed width measurer. */
export function createCanvasMeasure(): MeasureWidth {
  // Ensure the curated faces are registered so measureText uses them, not a
  // system fallback (idempotent, cheap on repeat calls).
  registerToonyFonts();
  const scratch = createCanvas(8, 8).getContext("2d");
  return (text: string, fontSize: number, fontWeight: 400 | 700 = 400, fontFamily?: string) => {
    // `fontFamily` is the render plan's already-resolved family id, so a direct
    // registry lookup is enough — no per-kind fallback needed here.
    const family = fontFamily ? getFontFamily(fontFamily) : undefined;
    const name = family ? canvasFamilyName(family, fontWeight) : FONT_FAMILY;
    scratch.font = `${cssFaceWeight(fontWeight)} ${fontSize}px "${name}"`;
    return scratch.measureText(text).width;
  };
}
