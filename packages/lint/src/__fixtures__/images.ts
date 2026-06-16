// Named test fixtures: build tiny rasters and encode valid PNGs in-memory so
// tests never commit binary image files. Encoding uses Node's zlib, mirroring
// the decoder under test.

import { deflateSync } from "node:zlib";
import type { ChannelCount, Raster } from "../image/raster.js";

/** A solid-color raster. `value` fills every channel (alpha included if 4ch). */
export function makeSolidRaster(
  width: number,
  height: number,
  channels: ChannelCount,
  value: number,
): Raster {
  const data = new Uint8Array(width * height * channels).fill(value);
  return { width, height, channels, data };
}

/**
 * A horizontal gray gradient from `lo` (left) to `hi` (right). Alpha is opaque
 * for 4-channel rasters. Useful for darkness/contrast tests with a known span.
 */
export function makeGradientRaster(
  width: number,
  height: number,
  channels: ChannelCount,
  lo: number,
  hi: number,
): Raster {
  const data = new Uint8Array(width * height * channels);
  for (let x = 0; x < width; x++) {
    const t = width === 1 ? 0 : x / (width - 1);
    const value = Math.round(lo + (hi - lo) * t);
    for (let y = 0; y < height; y++) {
      const base = (y * width + x) * channels;
      if (channels === 1) {
        data[base] = value;
      } else {
        data[base] = value;
        data[base + 1] = value;
        data[base + 2] = value;
        if (channels === 4) data[base + 3] = 255;
      }
    }
  }
  return { width, height, channels, data };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function colorTypeFor(channels: ChannelCount): number {
  if (channels === 1) return 0;
  if (channels === 3) return 2;
  return 6;
}

/** Encode a raster as a valid 8-bit PNG (filter 0, single IDAT). */
export function encodePng(raster: Raster): Uint8Array {
  const { width, height, channels, data } = raster;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorTypeFor(channels);
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);

  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
