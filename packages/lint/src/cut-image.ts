// How this package gets at a cut's art, and what counts as a usable size.
//
// Two lints need a cut's pixel size — the overflow check, which lays bubbles out
// against it, and the panel-shape check, which compares it with what the cut
// declares (#260). Both must agree on when there ISN'T one: an unassociated cut,
// an unrecognized header, and a header claiming a zero axis are all "no art
// here", and a lint that disagreed with the other about that would size a cut
// one way and report on it another.

import { type ImageDimensions, readImageDimensions } from "./image/dimensions.js";

/** Resolve a cut's encoded image bytes, or null when no image is associated. */
export type ResolveCutImage = (cutId: string) => Uint8Array | null;

/**
 * A cut's real pixel size from its image header, or null when the cut has no
 * art, the header is not one this reader recognizes, or it reports an axis of
 * zero — which is not a stage anything can be laid out on.
 */
export function readCutDimensions(bytes: Uint8Array | null): ImageDimensions | null {
  if (!bytes) return null;
  const dims = readImageDimensions(bytes);
  if (!dims || dims.width <= 0 || dims.height <= 0) return null;
  return dims;
}
