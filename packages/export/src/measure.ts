// A canvas-backed text measurer for @toony/render's layout.
//
// Passing this into layoutCut/layoutBubble makes export wrap and auto-fit bubble
// text with the same pixel-accurate metrics it will be drawn at — so export
// matches what the renderer lays out for the preview.

import { createCanvas } from "@napi-rs/canvas";
import type { MeasureWidth } from "@toony/render";

/** The font family used for all measuring and drawing, kept in one place. */
export const FONT_FAMILY = "sans-serif";

/** Build a deterministic, canvas-backed width measurer. */
export function createCanvasMeasure(): MeasureWidth {
  const scratch = createCanvas(8, 8).getContext("2d");
  return (text: string, fontSize: number, fontWeight: 400 | 700 = 400) => {
    scratch.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
    return scratch.measureText(text).width;
  };
}
