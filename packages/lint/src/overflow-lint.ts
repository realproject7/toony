// Bubble-text overflow lint.
//
// Reuses `@toony/render`'s `layoutCut` — the single source of truth for lettering
// geometry — to detect overlays whose text overflows their box even at the
// minimum font size. The render layout already exposes this as `overflow`, so
// this module does not re-measure or re-lay-out text; it only attributes the
// flag to a finding. Cut pixel dimensions come from the Phase-1 image header
// reader when an image is present; a documented fallback size is used otherwise.

import { layoutCut } from "@toony/render";
import type { EpisodeBundle } from "@toony/schema";
import { type Finding, finding } from "./findings.js";
import { readImageDimensions } from "./image/dimensions.js";

/**
 * Fallback cut render size used when a cut has no image, or its image header is
 * unreadable. Overflow depends on the box-to-font ratio, and the minimum font
 * is derived from the render height, so a stable fallback keeps the lint
 * deterministic. The default approximates a typical portrait webtoon cut.
 */
export const DEFAULT_OVERFLOW_FALLBACK = { width: 1200, height: 1600 } as const;

export interface OverflowLintOptions {
  /** Render size assumed for cuts without a readable image. */
  fallback?: { width: number; height: number };
}

/** Resolve a cut's encoded image bytes, or null when no image is associated. */
export type ResolveCutImage = (cutId: string) => Uint8Array | null;

/**
 * Lint every cut's overlays for text overflow. For each cut, overlays are laid
 * out at the cut's real pixel size (from its image header) or the documented
 * fallback, and any overlay whose text overflows its box at the minimum font is
 * reported. Returns one warning finding per overflowing overlay.
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

    let width = fallback.width;
    let height = fallback.height;
    const bytes = resolveImage(cut.id);
    if (bytes) {
      const dims = readImageDimensions(bytes);
      if (dims && dims.width > 0 && dims.height > 0) {
        width = dims.width;
        height = dims.height;
      }
    }

    for (const render of layoutCut(overlays, width, height)) {
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
