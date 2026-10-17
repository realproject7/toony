// A decoded 8-bit raster and small pixel helpers used by image analysis.

/** Number of 8-bit channels per pixel. */
export type ChannelCount = 1 | 3 | 4;

/**
 * A decoded raster image. `data` holds row-major 8-bit samples with `channels`
 * samples per pixel and length exactly `width * height * channels`.
 */
export interface Raster {
  width: number;
  height: number;
  channels: ChannelCount;
  data: Uint8Array;
}

/** Expected byte length for a raster of the given shape. */
export function expectedByteLength(width: number, height: number, channels: ChannelCount): number {
  return width * height * channels;
}

/** True when the raster's dimensions and data length are mutually consistent. */
export function isRasterWellFormed(raster: Raster): boolean {
  return (
    Number.isInteger(raster.width) &&
    Number.isInteger(raster.height) &&
    raster.width > 0 &&
    raster.height > 0 &&
    raster.data.length === expectedByteLength(raster.width, raster.height, raster.channels)
  );
}

/** Rec. 601 luma for an RGB triple, returned in the 0..255 range. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Per-pixel luminance samples (0..255) for a raster, ignoring any alpha. */
export function lumaSamples(raster: Raster): Float64Array {
  const { width, height, channels, data } = raster;
  const count = width * height;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const base = i * channels;
    if (channels === 1) {
      out[i] = data[base] ?? 0;
    } else {
      out[i] = luma(data[base] ?? 0, data[base + 1] ?? 0, data[base + 2] ?? 0);
    }
  }
  return out;
}
