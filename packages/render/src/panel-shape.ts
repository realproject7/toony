// A cut's panel shape, read back (#260).
//
// `Cut.panelAspect` (#237) is a cut's height as a multiple of its OWN width. Its
// write path resolves that into the generation latent, and the composed page
// then takes each panel's height from the art that came back — so for art made
// UNDER the declaration, the declared height and the rendered one are one
// number and nobody has to read anything back.
//
// Everything else does. A cut with no art yet has only the declaration; a cut
// whose art predates the declaration has both, and they can disagree. Three
// places needed that answer and none of them had it: the export raster staging
// an art-less cut, the studio reader showing the same stage (#211 says those two
// must agree), and the lint sizing a cut before it measures bubbles against it.
// All three read "the fallback" and stopped there, so a pack could declare a
// 0.3-of-a-width strip and be linted on a tall portrait canvas.
//
// This module is the one answer, so the three cannot drift.

import { PANEL_ASPECT_MAX, PANEL_ASPECT_MIN } from "@toony/schema";
import { FALLBACK_CUT_ASPECT } from "./layout.js";

/** Which of the three sources a resolved shape came from. */
export type CutAspectSource = "declared" | "image" | "fallback";

/** A resolved panel shape and the source it came from. */
export interface ResolvedCutAspect {
  /** The cut's height as a multiple of its own width. */
  aspect: number;
  source: CutAspectSource;
}

/** A cut image's pixel size, as a header read reports it. */
export interface CutImageSize {
  width: number;
  height: number;
}

/**
 * A cut's panel shape: **its declaration, else its image's, else the fallback.**
 *
 * The declaration wins because this answers what shape the cut IS MEANT to be,
 * which is what a consumer with no art in hand needs and what a mismatch is
 * measured against. A consumer that is staging a cut which already HAS art does
 * not ask this question — the page takes that panel's height from the art,
 * whatever the cut declares, because nothing re-cuts an image to match a
 * declaration made after it — so it reaches here only on its art-less branch and
 * passes `null`. Offering the image anyway is how the other side of a mismatch
 * is obtained: `resolveCutAspect(undefined, image)` is the shape the page
 * actually has, and it divides height by width in this one place so the two
 * sides of the comparison cannot be computed differently.
 *
 * A declaration outside `PANEL_ASPECT_MIN`..`PANEL_ASPECT_MAX`, or not a number
 * at all, is passed over. Saying so is not this function's job — the schema
 * validator owns that message, and duplicating it would send an author looking
 * for two problems — but STAGING it is, and it must not: `toony validate`,
 * `toony lint` and `toony export` all gate on validity, while the studio's
 * episode and reader pages render whatever is on disk. A declared 500 would give
 * that reader a 500-column stage and `1e308` an `Infinity`-tall one, where
 * before this field was read back they were the fallback.
 *
 * `fallbackAspect` lets a caller that stages art-less cuts on its own documented
 * canvas keep that canvas; absent, it is the render core's `FALLBACK_CUT_ASPECT`.
 */
export function resolveCutAspect(
  panelAspect: number | undefined,
  image: CutImageSize | null,
  fallbackAspect: number = FALLBACK_CUT_ASPECT,
): ResolvedCutAspect {
  // The bounds reject NaN and both infinities on their own, since every
  // comparison with NaN is false. `typeof` is still checked because a project is
  // parsed off disk and the studio renders it before anything validates it, and
  // a string "5" would otherwise coerce its way through both comparisons.
  if (
    typeof panelAspect === "number" &&
    panelAspect >= PANEL_ASPECT_MIN &&
    panelAspect <= PANEL_ASPECT_MAX
  ) {
    return { aspect: panelAspect, source: "declared" };
  }
  if (image !== null && image.width > 0 && image.height > 0) {
    return { aspect: image.height / image.width, source: "image" };
  }
  return { aspect: fallbackAspect, source: "fallback" };
}

/**
 * The pixel height a cut of `aspect` takes at `width`. Integral (a canvas is
 * whole pixels) and never below one, because a zero-height canvas is not a
 * stage — it is a crash in whatever draws onto it.
 */
export function cutHeightAt(width: number, aspect: number): number {
  return Math.max(1, Math.round(width * aspect));
}
