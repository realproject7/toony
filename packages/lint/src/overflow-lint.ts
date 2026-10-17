// Bubble-text overflow lint.
//
// Reuses `@toony/render`'s `layoutCut` — the single source of truth for lettering
// geometry — to detect overlays whose text overflows their box even at the
// minimum font size. The render layout already exposes this as `overflow`, so
// this module does not re-measure or re-lay-out text; it only attributes the
// flag to a finding. Cut pixel dimensions come from the Phase-1 image header
// reader when an image is present; otherwise the cut is staged at the shape it
// declares, and only a cut declaring nothing falls all the way to the documented
// fallback size.

import { cutHeightAt, layoutCut, resolveCutAspect } from "@toony/render";
import type { EpisodeBundle } from "@toony/schema";
import { type ResolveCutImage, readCutDimensions } from "./cut-image.js";
import { type Finding, finding } from "./findings.js";
import { REFERENCE_RENDER } from "./reference.js";

/**
 * Fallback cut render size used when a cut has no image, or its image header is
 * unreadable, AND declares no shape of its own. Overflow depends on the
 * box-to-font ratio, and the minimum font is derived from the render height, so
 * a stable fallback keeps the lint deterministic. The default approximates a
 * typical portrait webtoon cut.
 *
 * Its WIDTH is the column every art-less cut is staged at, declared or not — a
 * cut's width belongs to the column it is read at, never to the cut (#217). Only
 * the height moves, and only for a cut that declares a shape (#260).
 */
export const DEFAULT_OVERFLOW_FALLBACK = REFERENCE_RENDER;

export interface OverflowLintOptions {
  /** Render size assumed for cuts without a readable image. */
  fallback?: { width: number; height: number };
  /**
   * The project's declared gutter band width (`webtoon.json` →
   * `gutterBandWidth`), a fraction of the cut width (#215). A gutter bubble is
   * laid out inside that strip, so whether its text fits depends on it: without
   * the project's value this lint would measure every gutter bubble against the
   * DEFAULT strip and report overflow on text that renders and exports fine.
   * Absent → the default strip, which is what a project that declares nothing
   * renders on anyway.
   */
  gutterBandWidth?: number;
}

/**
 * Lint every cut's overlays for text overflow. For each cut, overlays are laid
 * out at the cut's real pixel size (from its image header), else at the shape
 * the cut declares, else at the documented fallback, and any overlay whose text
 * overflows its box at the minimum font is reported. Returns one warning finding
 * per overflowing overlay.
 *
 * Sizing an art-less cut at its DECLARED shape is the point of #260: every cut
 * in a pack's genre scaffold is art-less, so a scaffold declaring a 0.3-of-a-
 * width strip used to be measured on a tall portrait canvas and a bubble that
 * cannot fit the panel the pack asks for passed.
 */
export function lintBubbleOverflow(
  bundle: EpisodeBundle,
  resolveImage: ResolveCutImage,
  options: OverflowLintOptions = {},
): Finding[] {
  const fallback = options.fallback ?? DEFAULT_OVERFLOW_FALLBACK;
  const findings: Finding[] = [];

  for (const cut of bundle.cuts) {
    const overlays = bundle.lettering.filter((overlay) => overlay.cutId === cut.id);
    if (overlays.length === 0) continue;

    const dims = readCutDimensions(resolveImage(cut.id));
    let width: number;
    let height: number;
    if (dims) {
      width = dims.width;
      height = dims.height;
    } else {
      width = fallback.width;
      // No image is offered to the resolver because there is none in this
      // branch: the answer is the declaration, else the fallback shape — which
      // reproduces `fallback.height` exactly for a cut that declares nothing.
      const shape = resolveCutAspect(cut.panelAspect, null, fallback.height / fallback.width);
      height = cutHeightAt(width, shape.aspect);
    }

    for (const render of layoutCut(overlays, width, height, {
      gutterBandWidth: options.gutterBandWidth,
    })) {
      if (render.overflow) {
        findings.push(
          finding(
            "warning",
            "lettering/overflow",
            render.id,
            `bubble text overflows its box on cut "${cut.id}" even at the minimum font size; shorten the text or enlarge the bubble.`,
          ),
        );
      }
    }
  }

  return findings;
}
