// Resolve a canvas `ctx.font` string for a bubble's resolved font family (#149).
//
// Mirrors the export canvas measurer (packages/export/src/measure.ts): the studio
// browser measurer keys `ctx.font` off the SAME curated family the export raster
// draws, so a line never wraps under one face and renders under another. Pure (no
// DOM), so it is unit-testable in the node:test harness (#157).

import { getFontFamily } from "@toony/fonts";

/** Generic fallback family when the overlay's family is absent/unknown. */
export const CANVAS_FONT_FALLBACK = "sans-serif";

/**
 * Build the `ctx.font` shorthand for a resolved family id at a weight/size. Uses
 * the curated family's display NAME — the same name the studio `@font-face`
 * registers and the export canvas measures — with a generic fallback. Absent or
 * unknown family resolves to the bare generic keyword.
 */
export function resolveCanvasFont(
  fontFamily: string | undefined,
  fontWeight: 400 | 700,
  fontSize: number,
): string {
  const name = fontFamily ? getFontFamily(fontFamily)?.name : undefined;
  const stack = name ? `"${name}", ${CANVAS_FONT_FALLBACK}` : CANVAS_FONT_FALLBACK;
  return `${fontWeight} ${fontSize}px ${stack}`;
}
