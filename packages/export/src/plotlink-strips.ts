// Pack rendered reading-order bands into upload files, never narrative episodes.
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { clampQuality, encodeCanvas } from "./encode.js";
import { ExportError } from "./errors.js";
import { PLOTLINK_MAX_BYTES, PLOTLINK_MAX_IMAGES } from "./manifest.js";

/** WebP's codec limit, independent of our larger generic raster safety limit. */
export const WEBP_DIMENSION_MAX = 16_383;

export interface EpisodeBand {
  canvas: Canvas;
  height: number;
}

interface Piece extends EpisodeBand {
  top: number;
}

export interface PlotlinkStrip {
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number;
}

function encodePieces(pieces: Piece[], width: number, height: number, quality: number): Uint8Array {
  const canvas = createCanvas(width, height);
  try {
    const ctx = canvas.getContext("2d");
    // Match the stitched page, including transparent source pixels.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    let y = 0;
    for (const piece of pieces) {
      ctx.drawImage(piece.canvas, 0, piece.top, width, piece.height, 0, y, width, piece.height);
      y += piece.height;
    }
    return encodeCanvas(canvas, "webp", quality);
  } finally {
    // Retries must not rely on native canvas garbage-collection timing.
    canvas.width = 1;
    canvas.height = 1;
  }
}

function cannotFit(): ExportError {
  return new ExportError(
    "plotlink.cannot-fit",
    `The complete episode cannot fit in ${PLOTLINK_MAX_IMAGES} WebP strips of at most ${PLOTLINK_MAX_BYTES} bytes at this width and quality. Choose a smaller export width or lower quality explicitly, then check lettering readability. The previous export is unchanged.`,
  );
}

/**
 * Greedily take the longest fitting prefix of whole bands. Keep the requested
 * width and quality throughout; never silently shrink lettering. Only a band
 * that cannot fit by itself is split, at exact integer rows without overlap.
 * The caller preflights the retained bands and codec working set before render.
 */
export function encodePlotlinkStrips(
  bands: EpisodeBand[],
  width: number,
  requestedQuality: number,
): PlotlinkStrip[] {
  const quality = clampQuality(requestedQuality);
  const pieces: Piece[] = [];
  for (const band of bands) {
    for (let top = 0; top < band.height; top += WEBP_DIMENSION_MAX) {
      pieces.push({ ...band, top, height: Math.min(WEBP_DIMENSION_MAX, band.height - top) });
    }
  }
  const strips: PlotlinkStrip[] = [];
  while (pieces.length > 0) {
    if (strips.length === PLOTLINK_MAX_IMAGES) throw cannotFit();
    let count = 0;
    let height = 0;
    while (count < pieces.length && height + (pieces[count]?.height ?? 0) <= WEBP_DIMENSION_MAX) {
      height += (pieces[count] as Piece).height;
      count++;
    }
    let bytes = encodePieces(pieces.slice(0, count), width, height, quality);
    while (bytes.length > PLOTLINK_MAX_BYTES && count > 1) {
      count--;
      height -= (pieces[count] as Piece).height;
      bytes = encodePieces(pieces.slice(0, count), width, height, quality);
    }
    if (bytes.length > PLOTLINK_MAX_BYTES) {
      // This band alone exceeds the byte budget. Find a fitting row prefix;
      // each trial is actually encoded, so no compressed-size estimate can
      // admit an oversized file. Non-monotone codec sizes only affect packing
      // efficiency, never coverage or validity.
      const first = pieces[0] as Piece;
      let low = 1;
      let high = height - 1;
      let fit: { height: number; bytes: Uint8Array } | undefined;
      while (low <= high) {
        const rows = Math.floor((low + high) / 2);
        const trial = encodePieces([{ ...first, height: rows }], width, rows, quality);
        if (trial.length <= PLOTLINK_MAX_BYTES) {
          fit = { height: rows, bytes: trial };
          low = rows + 1;
        } else {
          high = rows - 1;
        }
      }
      if (!fit) throw cannotFit();
      height = fit.height;
      bytes = fit.bytes;
      pieces[0] = { ...first, top: first.top + height, height: first.height - height };
    } else {
      pieces.splice(0, count);
    }
    strips.push({ bytes, width, height, quality });
  }
  return strips;
}
