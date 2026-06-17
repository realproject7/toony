// Map a render plan's resolved text alignment to the SVG `text-anchor` value and
// the matching per-line x, so the SVG preview (cut-canvas, #7), the focused
// editor (cut-editor, #8/#55), and the export all draw alignment identically.
//
// The `@toony/render` `BubbleRender` already resolves `textAlign` and computes a
// per-line `anchorX` (the column's left edge / center / right edge). This helper
// only translates that to the SVG `text-anchor` keyword and picks the right x —
// it derives no geometry of its own, so the rendered alignment cannot drift from
// the layout core.

import type { TextAlign } from "@toony/schema";

/** SVG `text-anchor` keyword for a resolved horizontal alignment. */
export function svgTextAnchor(align: TextAlign): "start" | "middle" | "end" {
  if (align === "left") return "start";
  if (align === "right") return "end";
  return "middle";
}

/**
 * SVG `letter-spacing` attribute value (in user-space px) for a render plan's
 * letter-spacing (expressed in em) at a given font size, or undefined when zero
 * so the attribute is omitted for the common case.
 */
export function svgLetterSpacing(letterSpacingEm: number, fontSize: number): number | undefined {
  if (!letterSpacingEm) return undefined;
  return letterSpacingEm * fontSize;
}
