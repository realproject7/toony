// Minimal, dependency-free PNG decoder for pure image analysis.
//
// Supports 8-bit, non-interlaced PNGs in grayscale (1ch), truecolor RGB (3ch),
// and truecolor RGBA (4ch) — enough to inspect produced cut/transition assets
// without a cloud service or third-party codec. Decompression uses Node's
// built-in zlib. Unsupported or malformed inputs raise ImageDecodeError, which
// the analysis layer turns into a readability finding.

import { inflateSync } from "node:zlib";
import type { ChannelCount, Raster } from "./raster.js";

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A decode failure with a stable code (`signature`, `unsupported`, `corrupt`). */
export class ImageDecodeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageDecodeError";
    this.code = code;
  }
}

/** True when the buffer begins with the PNG signature. */
export function isPng(buffer: Uint8Array): boolean {
  if (buffer.length < SIGNATURE.length) return false;
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buffer[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

function channelsForColorType(colorType: number): ChannelCount {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 6:
      return 4;
    default:
      throw new ImageDecodeError(
        "unsupported",
        `unsupported PNG color type ${colorType}; supported: 0 (gray), 2 (RGB), 6 (RGBA).`,
      );
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(
  inflated: Uint8Array,
  width: number,
  height: number,
  channels: ChannelCount,
): Uint8Array {
  const stride = width * channels;
  const expected = height * (stride + 1);
  if (inflated.length !== expected) {
    throw new ImageDecodeError(
      "corrupt",
      `decompressed PNG data length ${inflated.length} does not match expected ${expected}.`,
    );
  }
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outRow = y * stride;
    const prevRow = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[rowStart + x] ?? 0;
      const left = x >= channels ? (out[outRow + x - channels] ?? 0) : 0;
      const up = y > 0 ? (out[prevRow + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (out[prevRow + x - channels] ?? 0) : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          throw new ImageDecodeError("corrupt", `unknown PNG filter type ${filterType}.`);
      }
      out[outRow + x] = value & 0xff;
    }
  }
  return out;
}

/** Decode a PNG buffer into a raster. Throws ImageDecodeError on failure. */
export function decodePng(buffer: Uint8Array): Raster {
  if (!isPng(buffer)) {
    throw new ImageDecodeError("signature", "buffer is not a PNG (bad signature).");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let channels: ChannelCount = 3;
  let sawIhdr = false;
  const idatParts: Uint8Array[] = [];

  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      buffer[offset + 4] ?? 0,
      buffer[offset + 5] ?? 0,
      buffer[offset + 6] ?? 0,
      buffer[offset + 7] ?? 0,
    );
    const dataStart = offset + 8;
    if (dataStart + length + 4 > buffer.length) {
      throw new ImageDecodeError("corrupt", `PNG chunk "${type}" runs past end of buffer.`);
    }

    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9] ?? -1;
      const interlace = buffer[dataStart + 12];
      if (bitDepth !== 8) {
        throw new ImageDecodeError(
          "unsupported",
          `unsupported PNG bit depth ${bitDepth}; only 8 is supported.`,
        );
      }
      if (interlace !== 0) {
        throw new ImageDecodeError("unsupported", "interlaced PNGs are not supported.");
      }
      if (width <= 0 || height <= 0) {
        throw new ImageDecodeError("corrupt", "PNG dimensions must be positive.");
      }
      channels = channelsForColorType(colorType);
      sawIhdr = true;
    } else if (type === "IDAT") {
      idatParts.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4;
  }

  if (!sawIhdr) {
    throw new ImageDecodeError("corrupt", "PNG is missing its IHDR header chunk.");
  }
  if (idatParts.length === 0) {
    throw new ImageDecodeError("corrupt", "PNG has no image data (IDAT).");
  }

  let inflated: Uint8Array;
  try {
    inflated = inflateSync(concat(idatParts));
  } catch {
    throw new ImageDecodeError("corrupt", "PNG image data could not be decompressed.");
  }

  const data = unfilter(inflated, width, height, channels);
  return { width, height, channels, data };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
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
