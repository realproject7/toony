// Read image pixel dimensions from file headers without fully decoding.
// Supports PNG, JPEG, GIF, and WebP — enough to run dimension/aspect checks
// across the formats Toony cut/transition assets are likely to use.

export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

export interface ImageDimensions {
  format: ImageFormat;
  width: number;
  height: number;
}

function readPng(buffer: Uint8Array, view: DataView): ImageDimensions | null {
  // Signature (8) + IHDR length (4) + "IHDR" (4) then width/height.
  if (buffer.length < 24) return null;
  return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
}

function readGif(buffer: Uint8Array, view: DataView): ImageDimensions | null {
  if (buffer.length < 10) return null;
  return { format: "gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readJpeg(buffer: Uint8Array, view: DataView): ImageDimensions | null {
  // Walk segment markers until a Start-Of-Frame carrying dimensions.
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1] ?? 0;
    // SOF0..SOF15, excluding DHT(c4), JPG(c8), DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return { format: "jpeg", width, height };
    }
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebp(buffer: Uint8Array, view: DataView): ImageDimensions | null {
  if (buffer.length < 30) return null;
  const fourcc = String.fromCharCode(
    buffer[12] ?? 0,
    buffer[13] ?? 0,
    buffer[14] ?? 0,
    buffer[15] ?? 0,
  );
  if (fourcc === "VP8 ") {
    // Lossy: dimensions in the frame header after the start code.
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return { format: "webp", width, height };
  }
  if (fourcc === "VP8L") {
    const b0 = buffer[21] ?? 0;
    const b1 = buffer[22] ?? 0;
    const b2 = buffer[23] ?? 0;
    const b3 = buffer[24] ?? 0;
    const bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { format: "webp", width, height };
  }
  if (fourcc === "VP8X") {
    const width = 1 + ((buffer[24] ?? 0) | ((buffer[25] ?? 0) << 8) | ((buffer[26] ?? 0) << 16));
    const height = 1 + ((buffer[27] ?? 0) | ((buffer[28] ?? 0) << 8) | ((buffer[29] ?? 0) << 16));
    return { format: "webp", width, height };
  }
  return null;
}

function startsWith(buffer: Uint8Array, ascii: string): boolean {
  if (buffer.length < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (buffer[i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/** Read dimensions from a supported image header, or null if unrecognized. */
export function readImageDimensions(buffer: Uint8Array): ImageDimensions | null {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return readPng(buffer, view);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return readJpeg(buffer, view);
  if (startsWith(buffer, "GIF8")) return readGif(buffer, view);
  if (startsWith(buffer, "RIFF") && buffer.length >= 12 && startsWith(buffer.subarray(8), "WEBP")) {
    return readWebp(buffer, view);
  }
  return null;
}
