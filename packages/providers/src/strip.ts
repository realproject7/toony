// Strip privacy-bearing metadata from image bytes at ingest, so project assets
// are public-safe by construction (before the repo's #3 scanner enforces it).
//
// The approach is container surgery, not re-encoding: pixel data is preserved
// byte-for-byte; only metadata chunks/segments are removed. This is
// deterministic and lossless for the image itself.
//
//   - PNG : drop tEXt/iTXt/zTXt/eXIf/tIME chunks.
//   - JPEG: drop APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), and COM segments.
//   - WebP: drop EXIF/XMP chunks and clear their VP8X flag bits.
//   - GIF : returned unchanged (no GPS/EXIF carrier; not flagged by the scanner).

import type { ImageFormat } from "./types.js";

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

const PNG_SIGNATURE_LEN = 8;
const PNG_DROP = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE_LEN)];
  let offset = PNG_SIGNATURE_LEN;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const end = offset + 12 + length; // length + type(4) + data + crc(4)
    if (end > bytes.length) break;
    if (!PNG_DROP.has(type)) {
      kept.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") break;
  }
  return concat(kept);
}

const JPEG_DROP_MARKERS = new Set([0xe1, 0xed, 0xfe]); // APP1 (EXIF/XMP), APP13 (IPTC), COM
const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    let markerPos = i;
    // Skip any fill 0xFF bytes between segments.
    while (markerPos + 1 < bytes.length && bytes[markerPos + 1] === 0xff) markerPos++;
    const marker = bytes[markerPos + 1] ?? 0;
    if (marker === 0xd9) {
      out.push(Uint8Array.from([0xff, 0xd9])); // EOI
      break;
    }
    if (marker === 0xda) {
      // Start of scan: entropy data runs to the end; copy verbatim.
      out.push(bytes.subarray(markerPos));
      break;
    }
    if (JPEG_STANDALONE.has(marker)) {
      out.push(bytes.subarray(markerPos, markerPos + 2));
      i = markerPos + 2;
      continue;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (markerPos + 4 > bytes.length) break;
    const length = view.getUint16(markerPos + 2);
    const end = markerPos + 2 + length;
    if (length < 2 || end > bytes.length) break;
    if (!JPEG_DROP_MARKERS.has(marker)) {
      out.push(bytes.subarray(markerPos, end));
    }
    i = end;
  }
  return concat(out);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body: Uint8Array[] = [];
  let offset = 12; // after "RIFF" + size + "WEBP"
  let changed = false;

  while (offset + 8 <= bytes.length) {
    const tag = fourcc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const padded = size + (size % 2); // chunks are padded to even length
    const end = offset + 8 + padded;
    if (end > bytes.length) break;

    if (tag === "EXIF" || tag === "XMP ") {
      changed = true; // drop metadata chunk
    } else {
      const chunk = bytes.subarray(offset, end).slice();
      if (tag === "VP8X" && chunk.length >= 9) {
        // Clear the EXIF (0x08) and XMP (0x04) flag bits in the VP8X header.
        const flags = chunk[8] ?? 0;
        const cleared = flags & ~0x0c;
        if (cleared !== flags) {
          chunk[8] = cleared;
          changed = true;
        }
      }
      body.push(chunk);
    }
    offset = end;
  }

  if (!changed) return bytes;

  let bodyLen = 0;
  for (const part of body) bodyLen += part.length;
  const out = new Uint8Array(12 + bodyLen);
  out.set(bytes.subarray(0, 12), 0); // "RIFF" + size + "WEBP"
  let at = 12;
  for (const part of body) {
    out.set(part, at);
    at += part.length;
  }
  // Rewrite the RIFF chunk size (file size minus the 8-byte RIFF header).
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** Remove metadata from image bytes for the given format. Pixel data is kept. */
export function stripImageMetadata(bytes: Uint8Array, format: ImageFormat): Uint8Array {
  switch (format) {
    case "png":
      return stripPng(bytes);
    case "jpeg":
      return stripJpeg(bytes);
    case "webp":
      return stripWebp(bytes);
    case "gif":
      return bytes;
  }
}
