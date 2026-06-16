// Encode composed canvases to PNG/JPEG/WebP, with active resize/recompress-to-fit
// for the PlotLink per-image byte budget.

import { type Canvas, createCanvas } from "@napi-rs/canvas";

export type RasterFormat = "png" | "jpeg" | "webp";

export const DEFAULT_JPEG_QUALITY = 82;
export const DEFAULT_WEBP_QUALITY = 82;

/** Clamp a lossy quality into the valid 0..100 range. */
export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return DEFAULT_JPEG_QUALITY;
  return Math.min(100, Math.max(0, Math.round(quality)));
}

/** Encode a canvas to the given format. `quality` (0..100) applies to lossy formats. */
export function encodeCanvas(canvas: Canvas, format: RasterFormat, quality?: number): Uint8Array {
  if (format === "png") return new Uint8Array(canvas.toBuffer("image/png"));
  const q = clampQuality(
    quality ?? (format === "jpeg" ? DEFAULT_JPEG_QUALITY : DEFAULT_WEBP_QUALITY),
  );
  if (format === "jpeg") return new Uint8Array(canvas.toBuffer("image/jpeg", q));
  return new Uint8Array(canvas.toBuffer("image/webp", q));
}

export interface FitResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number;
  /** True when the result is within the byte budget. */
  withinBudget: boolean;
}

function scaledCopy(canvas: Canvas, scale: number): Canvas {
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = createCanvas(w, h);
  out.getContext("2d").drawImage(canvas, 0, 0, w, h);
  return out;
}

/**
 * Encode a canvas to WebP within `maxBytes` by first lowering quality, then
 * downscaling in steps if quality alone is not enough. Deterministic (fixed
 * quality/scale ladders). `withinBudget` reports whether the budget was met.
 */
export function encodeWebpToFit(
  canvas: Canvas,
  maxBytes: number,
  startQuality = DEFAULT_WEBP_QUALITY,
  minQuality = 40,
): FitResult {
  const start = clampQuality(startQuality);
  const encodeAtQuality = (c: Canvas): { bytes: Uint8Array; quality: number } => {
    let q = start;
    let bytes = new Uint8Array(c.toBuffer("image/webp", q));
    while (bytes.length > maxBytes && q > minQuality) {
      q -= 8;
      bytes = new Uint8Array(c.toBuffer("image/webp", q));
    }
    return { bytes, quality: q };
  };

  let current = canvas;
  let { bytes, quality } = encodeAtQuality(current);
  let scale = 1;
  while (bytes.length > maxBytes && scale > 0.3) {
    scale -= 0.15;
    current = scaledCopy(canvas, scale);
    ({ bytes, quality } = encodeAtQuality(current));
  }

  return {
    bytes,
    width: current.width,
    height: current.height,
    quality,
    withinBudget: bytes.length <= maxBytes,
  };
}
