// The cut stage: where the artwork goes once a gutter strip is reserved (#98/#215).
//
// A `placement: gutter` bubble sits in a strip beside the artwork, and the strip
// has to be ACTUALLY reserved — the art layer inset out of it — or the artwork
// is drawn over the margin the lettering reads in. The read-only preview and the
// focused editor both draw that art layer, and both derived the inset from
// `cutPlacementFrame` with their own copy of the same arithmetic.
//
// It lives here, out of the components, for one reason: the components are
// React and the studio's test build cannot run them (its sources are written for
// a bundler — extensionless relative imports, `@/` aliases, Next subpath
// imports — none of which plain Node ESM resolves). This module has none of
// that, so the geometry the stage is built from is testable directly, against a
// declared strip width rather than only against the default.

import { cutPlacementFrame, type Rect } from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";
import type { CSSProperties } from "react";

export interface CutStage {
  /** The artwork rect and the reserved strip(s), in the cut's pixel space. */
  frame: { art: Rect; bands: Rect[] };
  /** True when any overlay on this cut reserved a strip. */
  reserved: boolean;
  /**
   * The style that insets the art layer out of the reserved strip, as
   * percentages of the cut so it scales with the displayed stage. `undefined`
   * when nothing is reserved, which leaves the artwork full-bleed exactly as it
   * was before gutter placement existed.
   */
  artStyle: CSSProperties | undefined;
}

/**
 * Resolve the stage for one cut. `gutterBandWidth` is the project's declared
 * strip width (`webtoon.json` → `gutterBandWidth`), already resolved; it must be
 * the SAME value the caller hands `layoutCut`, or the art layer is inset out of
 * one strip while the bubbles are laid into another.
 */
export function resolveCutStage(
  bubbles: LetteringOverlay[],
  width: number,
  height: number,
  gutterBandWidth: number,
): CutStage {
  const frame = cutPlacementFrame(bubbles, width, height, gutterBandWidth);
  const reserved = frame.bands.length > 0;
  const artStyle: CSSProperties | undefined = reserved
    ? {
        position: "absolute",
        left: `${(frame.art.x / width) * 100}%`,
        top: 0,
        width: `${(frame.art.width / width) * 100}%`,
        height: "100%",
      }
    : undefined;
  return { frame, reserved, artStyle };
}
