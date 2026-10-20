// A cut's image view (CMP-01) in pixels: the one place preview, measurement
// and export turn the stored fractions into a source rectangle, so all of
// them crop the same pixels.

import type { ImageView } from "@toony/schema";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The source rectangle a view shows, in whole pixels inside the image. No view,
 * or one that covers the whole image, is the whole image.
 */
export function imageViewPixels(
  view: ImageView | undefined,
  sourceWidth: number,
  sourceHeight: number,
): PixelRect {
  const whole = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (view === undefined) return whole;
  const x = Math.min(sourceWidth - 1, Math.max(0, Math.round(view.x * sourceWidth)));
  const y = Math.min(sourceHeight - 1, Math.max(0, Math.round(view.y * sourceHeight)));
  const width = Math.max(1, Math.min(sourceWidth - x, Math.round(view.width * sourceWidth)));
  const height = Math.max(1, Math.min(sourceHeight - y, Math.round(view.height * sourceHeight)));
  return { x, y, width, height };
}

/** Whether a view shows the whole image. */
export function isWholeImage(rect: PixelRect, sourceWidth: number, sourceHeight: number): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === sourceWidth && rect.height === sourceHeight;
}
