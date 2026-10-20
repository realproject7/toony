// Encode composed canvases to PNG, JPEG or WebP.

import type { Canvas } from "@napi-rs/canvas";
import { DEFAULT_JPEG_QUALITY } from "./defaults.js";

export type RasterFormat = "png" | "jpeg" | "webp";

/** Clamp a lossy quality into the valid 0..100 range. */
export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return DEFAULT_JPEG_QUALITY;
  return Math.min(100, Math.max(0, Math.round(quality)));
}

/** Encode a canvas to the given format. `quality` (0..100) applies to lossy formats. */
export function encodeCanvas(canvas: Canvas, format: RasterFormat, quality?: number): Uint8Array {
  if (format === "png") return new Uint8Array(canvas.toBuffer("image/png"));
  const q = clampQuality(quality ?? DEFAULT_JPEG_QUALITY);
  if (format === "jpeg") return new Uint8Array(canvas.toBuffer("image/jpeg", q));
  return new Uint8Array(canvas.toBuffer("image/webp", q));
}
