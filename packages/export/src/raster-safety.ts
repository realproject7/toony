// Native image decoding runs outside the caller: malformed input can SIGSEGV
// @napi-rs/canvas, which no JavaScript catch can handle (#277). Only a PNG our
// own encoder produced comes back into the export process.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { ExportError } from "./errors.js";
import { readImageDimensions } from "./image-dimensions.js";

const MIB = 1024 * 1024;
export const IMAGE_FILE_BYTES_MAX = 32 * MIB;
export const IMAGE_PIXELS_MAX = 16 * MIB;
export const CANVAS_PIXELS_MAX = 256 * MIB;
export const RASTER_DIMENSION_MAX = 1_000_000;
export const EPISODE_RASTER_BYTES_MAX = 2048 * MIB;

// This is a raw working-set budget, not a promise about total process RSS.
// Stitching reserves bands + final canvas + one raw-equivalent output buffer
// (12 bytes per page pixel). Source pixels and encoded inputs/cache count too.
// This fixed 2 GiB budget admits realistic 60–100-cut episodes: an 800 x 102,334
// page, 100 sources at 832 x 1216, and 100 MiB of encoded inputs need ~1.4 GiB.
// Codec scratch space, native allocator, fonts and JS/runtime overhead remain
// additional; this estimate is deliberately independent of the host's RAM.
export function assertRasterSize(width: number, height: number, label: string): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > RASTER_DIMENSION_MAX ||
    height > RASTER_DIMENSION_MAX ||
    width * height > CANVAS_PIXELS_MAX
  ) {
    throw new ExportError(
      "raster-too-large",
      `${label} requires ${width} x ${height} pixels; the limit is ${CANVAS_PIXELS_MAX} pixels and ${RASTER_DIMENSION_MAX} per dimension. Reduce the export width or panel height.`,
    );
  }
}

export function assertRasterBudget(bytes: number, label: string): void {
  if (!Number.isSafeInteger(bytes) || bytes > EPISODE_RASTER_BYTES_MAX) {
    throw new ExportError(
      "raster-too-large",
      `${label} requires about ${Math.ceil(bytes / MIB)} MiB of image/canvas/output data; the limit is ${EPISODE_RASTER_BYTES_MAX / MIB} MiB. Reduce the export width or split the episode.`,
    );
  }
}

export interface PreparedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

// A weak identity cache avoids decoding twice between target preflight and
// composeCut. Each successful decode is retained under both the untrusted
// source identity and its encoder-produced normalized bytes: targets prepare
// the former, then composition receives the latter.
const prepared = new WeakMap<Uint8Array, PreparedImage>();
const canvasModule = createRequire(import.meta.url).resolve("@napi-rs/canvas");

// Kept inline so the packaged CLI needs no extra worker file. The child receives
// bytes, never a filename/URL, and uses the same pinned decoder and encoder as
// export. The parent checks file headers before even assigning Image.src (which
// can itself allocate). The onload check also rejects a decoder/header mismatch.
const DECODE = `
const { Image, createCanvas } = require(process.argv[1]);
const limit = Number(process.argv[2]);
const dimensionLimit = Number(process.argv[3]);
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => {
  const image = new Image();
  image.onerror = () => process.exit(2);
  image.onload = async () => {
    const { width, height } = image;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > dimensionLimit ||
        height > dimensionLimit || width * height > limit) {
      process.stdout.end(JSON.stringify({ width, height }));
      process.exitCode = 3;
      return;
    }
    try {
      await image.decode();
      const canvas = createCanvas(width, height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      process.stdout.end(canvas.toBuffer('image/png'));
    } catch { process.exit(2); }
  };
  try { image.src = Buffer.concat(chunks); } catch { process.exit(2); }
});
`;

/** Decode untrusted bytes only in a bounded child; return a lossless local PNG. */
export async function prepareImage(bytes: Uint8Array, label: string): Promise<PreparedImage> {
  const existing = prepared.get(bytes);
  if (existing) return existing;
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_FILE_BYTES_MAX) {
    throw new ExportError(
      "invalid-image",
      `${label} has ${bytes.byteLength} encoded bytes; expected a nonempty image no larger than ${IMAGE_FILE_BYTES_MAX / MIB} MiB.`,
    );
  }
  const dimensions = readImageDimensions(bytes);
  if (dimensions === null) {
    throw new ExportError(
      "invalid-image",
      `${label} has no readable PNG, JPEG, GIF or WebP header.`,
    );
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > RASTER_DIMENSION_MAX ||
    dimensions.height > RASTER_DIMENSION_MAX ||
    dimensions.width * dimensions.height > IMAGE_PIXELS_MAX
  ) {
    throw new ExportError(
      "raster-too-large",
      `${label} is ${dimensions.width} x ${dimensions.height} pixels; source images are limited to ${IMAGE_PIXELS_MAX} pixels and ${RASTER_DIMENSION_MAX} per dimension. Resize the source image.`,
    );
  }
  const png = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [
        "--input-type=commonjs",
        "-e",
        DECODE,
        canvasModule,
        String(IMAGE_PIXELS_MAX),
        String(RASTER_DIMENSION_MAX),
      ],
      { encoding: "buffer", maxBuffer: IMAGE_PIXELS_MAX * 4 + MIB, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          if (error.code === 3) {
            let shape: { width?: number; height?: number } = {};
            try {
              shape = JSON.parse(stdout.toString()) as typeof shape;
            } catch {
              // A truncated worker diagnostic must still become an ExportError.
            }
            reject(
              new ExportError(
                "raster-too-large",
                `${label} is ${shape.width} x ${shape.height} pixels; source images are limited to ${IMAGE_PIXELS_MAX} pixels and ${RASTER_DIMENSION_MAX} per dimension. Resize the source image.`,
              ),
            );
          } else {
            reject(
              new ExportError(
                "invalid-image",
                `${label} could not be decoded safely. Replace the damaged image or import it again.`,
              ),
            );
          }
          return;
        }
        resolve(stdout);
      },
    );
    // The decoder can reject a header before its input pipe finishes writing.
    child.stdin?.on("error", () => {});
    child.stdin?.end(bytes);
  });
  // A successful child emits our encoder's PNG, whose leading IHDR carries the
  // exact raster dimensions. Never apply this trust to an input file's header.
  if (png.length < 24 || png.subarray(1, 4).toString() !== "PNG") {
    throw new ExportError("invalid-image", `${label} did not produce a decoded image.`);
  }
  const result = {
    bytes: new Uint8Array(png),
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
  prepared.set(bytes, result);
  prepared.set(result.bytes, result);
  return result;
}
