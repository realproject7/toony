// Pure, deterministic image analysis. No cloud, no third-party codecs.
//
// Operates on decoded rasters (see png.ts) and reports actionable findings:
// readability/decode, dimension + aspect, blank, darkness, low contrast, and a
// deterministic compression-feasibility estimate. All thresholds are
// configurable; the defaults below catch degenerate/unreadable assets without
// hard-coding a platform target (platform width belongs to #10, Phase 2).

import { deflateSync } from "node:zlib";
import { type Finding, finding } from "../findings.js";
import { readImageDimensions } from "./dimensions.js";
import { decodePng, ImageDecodeError, isPng } from "./png.js";
import { isRasterWellFormed, lumaSamples, type Raster } from "./raster.js";

export interface ImageAnalysisOptions {
  /** Minimum acceptable pixel width/height. */
  minWidth: number;
  minHeight: number;
  /** Acceptable height/width aspect range; outside → advisory warning. */
  minAspectRatio: number;
  maxAspectRatio: number;
  /** Mean luma (0..255) below this → "dark" warning. */
  darkLumaThreshold: number;
  /** Luma p2..p98 span (0..255) below this → "low-contrast" warning. */
  lowContrastRange: number;
  /** Optional compression-feasibility budget. */
  compression?: { targetBytes: number; targetWidth?: number };
}

export const DEFAULT_IMAGE_ANALYSIS_OPTIONS: ImageAnalysisOptions = {
  minWidth: 1,
  minHeight: 1,
  minAspectRatio: 1 / 20,
  maxAspectRatio: 20,
  darkLumaThreshold: 16,
  lowContrastRange: 12,
};

function resolveOptions(options?: Partial<ImageAnalysisOptions>): ImageAnalysisOptions {
  return { ...DEFAULT_IMAGE_ANALYSIS_OPTIONS, ...options };
}

function percentile(sortedAscending: Float64Array, fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.round(fraction * (sortedAscending.length - 1))),
  );
  return sortedAscending[index] ?? 0;
}

function isUniform(raster: Raster): boolean {
  const { data, channels } = raster;
  for (let c = 0; c < channels; c++) {
    const first = data[c] ?? 0;
    for (let i = c; i < data.length; i += channels) {
      if (data[i] !== first) return false;
    }
  }
  return true;
}

/** Analyze a decoded raster, attributing findings to `imageId`. */
export function analyzeRaster(
  raster: Raster,
  imageId: string,
  options?: Partial<ImageAnalysisOptions>,
): Finding[] {
  const opts = resolveOptions(options);
  const findings: Finding[] = [];

  if (!isRasterWellFormed(raster)) {
    findings.push(
      finding(
        "error",
        "image/corrupt-raster",
        imageId,
        "raster dimensions and data length disagree.",
      ),
    );
    return findings;
  }

  const { width, height } = raster;
  if (width < opts.minWidth || height < opts.minHeight) {
    findings.push(
      finding(
        "warning",
        "image/too-small",
        imageId,
        `image is ${width}x${height}; minimum is ${opts.minWidth}x${opts.minHeight}.`,
      ),
    );
  }

  const aspect = height / width;
  if (aspect < opts.minAspectRatio || aspect > opts.maxAspectRatio) {
    findings.push(
      finding(
        "warning",
        "image/aspect-extreme",
        imageId,
        `aspect ratio ${aspect.toFixed(3)} (height/width) is outside ${opts.minAspectRatio.toFixed(3)}..${opts.maxAspectRatio.toFixed(3)}.`,
      ),
    );
  }

  if (isUniform(raster)) {
    findings.push(
      finding("warning", "image/blank", imageId, "image is a single uniform color (likely blank)."),
    );
    // A uniform image is also trivially dark/low-contrast; reporting blank once
    // is the actionable signal, so skip the luma-derived checks below.
    return appendCompression(findings, raster, imageId, opts);
  }

  const luma = lumaSamples(raster);
  let sum = 0;
  for (const value of luma) sum += value;
  const mean = sum / luma.length;
  if (mean < opts.darkLumaThreshold) {
    findings.push(
      finding(
        "warning",
        "image/dark",
        imageId,
        `mean luma ${mean.toFixed(1)} is below the dark threshold ${opts.darkLumaThreshold}.`,
      ),
    );
  }

  const sorted = Float64Array.from(luma).sort();
  const range = percentile(sorted, 0.98) - percentile(sorted, 0.02);
  if (range < opts.lowContrastRange) {
    findings.push(
      finding(
        "warning",
        "image/low-contrast",
        imageId,
        `luma p2..p98 span ${range.toFixed(1)} is below the contrast threshold ${opts.lowContrastRange}.`,
      ),
    );
  }

  return appendCompression(findings, raster, imageId, opts);
}

function appendCompression(
  findings: Finding[],
  raster: Raster,
  imageId: string,
  opts: ImageAnalysisOptions,
): Finding[] {
  if (!opts.compression) return findings;
  const { targetBytes, targetWidth } = opts.compression;
  const estimate = estimateCompressibleBytes(raster, targetWidth);
  if (estimate <= targetBytes) {
    findings.push(
      finding(
        "info",
        "image/compression-ok",
        imageId,
        `deflate proxy ${estimate} bytes is within the ${targetBytes}-byte budget; a lossy re-encode will also fit.`,
      ),
    );
  } else {
    findings.push(
      finding(
        "warning",
        "image/compression-uncertain",
        imageId,
        `deflate proxy ${estimate} bytes exceeds the ${targetBytes}-byte budget; a lossy re-encode may still fit but is not guaranteed by this deterministic check.`,
      ),
    );
  }
  return findings;
}

/**
 * Deterministic compressibility proxy: optionally downscale, drop alpha, and
 * deflate the RGB bytes. Deflate is lossless and generally larger than a lossy
 * WebP at the same size, so a proxy within budget implies a lossy encode fits.
 */
export function estimateCompressibleBytes(raster: Raster, targetWidth?: number): number {
  const scaled =
    targetWidth && targetWidth > 0 && targetWidth < raster.width
      ? downscaleNearest(raster, targetWidth)
      : raster;
  const rgb = toRgb(scaled);
  return deflateSync(rgb, { level: 9 }).length;
}

function downscaleNearest(raster: Raster, targetWidth: number): Raster {
  const { width, height, channels, data } = raster;
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
  const out = new Uint8Array(targetWidth * targetHeight * channels);
  for (let ty = 0; ty < targetHeight; ty++) {
    const sy = Math.min(height - 1, Math.floor((ty * height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx = Math.min(width - 1, Math.floor((tx * width) / targetWidth));
      const src = (sy * width + sx) * channels;
      const dst = (ty * targetWidth + tx) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = data[src + c] ?? 0;
    }
  }
  return { width: targetWidth, height: targetHeight, channels, data: out };
}

function toRgb(raster: Raster): Uint8Array {
  const { width, height, channels, data } = raster;
  if (channels === 3) return data;
  const count = width * height;
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const src = i * channels;
    if (channels === 1) {
      const g = data[src] ?? 0;
      out[i * 3] = g;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = g;
    } else {
      out[i * 3] = data[src] ?? 0;
      out[i * 3 + 1] = data[src + 1] ?? 0;
      out[i * 3 + 2] = data[src + 2] ?? 0;
    }
  }
  return out;
}

/**
 * Analyze an encoded image buffer. PNGs are decoded for full pixel analysis;
 * other recognized formats get dimension/aspect checks from their header with
 * an explicit note that pixel analysis was skipped. Unreadable buffers produce
 * an error finding.
 */
export function analyzeImageBuffer(
  buffer: Uint8Array,
  imageId: string,
  options?: Partial<ImageAnalysisOptions>,
): Finding[] {
  if (isPng(buffer)) {
    let raster: Raster;
    try {
      raster = decodePng(buffer);
    } catch (error) {
      const code = error instanceof ImageDecodeError ? error.code : "corrupt";
      const message = error instanceof Error ? error.message : "failed to decode image.";
      return [finding("error", `image/${code}`, imageId, message)];
    }
    return analyzeRaster(raster, imageId, options);
  }

  const dimensions = readImageDimensions(buffer);
  if (!dimensions) {
    return [
      finding(
        "error",
        "image/undecodable",
        imageId,
        "image format not recognized or header is truncated.",
      ),
    ];
  }
  const opts = resolveOptions(options);
  const findings: Finding[] = [];
  if (dimensions.width < opts.minWidth || dimensions.height < opts.minHeight) {
    findings.push(
      finding(
        "warning",
        "image/too-small",
        imageId,
        `image is ${dimensions.width}x${dimensions.height}; minimum is ${opts.minWidth}x${opts.minHeight}.`,
      ),
    );
  }
  if (dimensions.width > 0) {
    const aspect = dimensions.height / dimensions.width;
    if (aspect < opts.minAspectRatio || aspect > opts.maxAspectRatio) {
      findings.push(
        finding(
          "warning",
          "image/aspect-extreme",
          imageId,
          `aspect ratio ${aspect.toFixed(3)} (height/width) is outside ${opts.minAspectRatio.toFixed(3)}..${opts.maxAspectRatio.toFixed(3)}.`,
        ),
      );
    }
  }
  findings.push(
    finding(
      "info",
      "image/pixel-analysis-skipped",
      imageId,
      `${dimensions.format} pixel analysis is not available in this phase; checked header dimensions only.`,
    ),
  );
  return findings;
}
