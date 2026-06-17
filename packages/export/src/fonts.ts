// Register the bundled, self-hosted curated fonts with @napi-rs/canvas so the
// export raster draws text with the SAME faces the studio SVG preview uses.
//
// @napi-rs/canvas selects a face purely by the family NAME passed to
// `GlobalFonts.registerFromPath(file, name)` — it does not pick a weight variant
// from a `font-weight` in `ctx.font`. So each weight file is registered under its
// OWN canvas family name: the family's display name for 400, and a distinct
// "<name> 700" name for 700. `canvasFontFamily(familyId, weight)` returns the
// name to put in `ctx.font`, mirroring what `@toony/render` resolved, so the
// canvas and the SVG land on the identical underlying woff2.

import { GlobalFonts } from "@napi-rs/canvas";
import {
  FONT_FAMILIES,
  type FontFaceWeight,
  type FontFamily,
  type FontFamilyId,
  fontFileForWeight,
  getFontFamily,
  resolveFontFamily,
} from "@toony/fonts";
import { fontAssetPath } from "@toony/fonts/node";
import type { BubbleKind } from "@toony/schema";

// Canvas family name for a face FILE's weight. 400 files register under the
// family's display name; 700 files under "<name> 700". Keying off the file weight
// that actually exists means a 400-only family always resolves to its display
// name even when a bold weight is requested (matching `fontFileForWeight`).
function nameForFaceWeight(family: FontFamily, faceWeight: FontFaceWeight): string {
  return faceWeight === 700 ? `${family.name} 700` : family.name;
}

/**
 * Map a resolved body weight (400-700) to the face weight actually used,
 * following CSS font-weight matching for the {400,700} set each family ships:
 * 600-700 pick the bold (700) face, 400-500 pick regular. This mirrors how the
 * browser matches the studio SVG's `font-weight`, so e.g. weight 600 draws bold
 * in BOTH the export raster and the SVG preview (#85). `@toony/render` applies
 * the same threshold for its measurement weight.
 */
export function cssFaceWeight(weight: number): FontFaceWeight {
  return weight >= 600 ? 700 : 400;
}

/**
 * Canvas family name for an ALREADY-RESOLVED family + weight (CSS-matched face).
 * Used by the measurer, which receives the render plan's resolved family.
 */
export function canvasFamilyName(family: FontFamily, weight: number): string {
  return nameForFaceWeight(family, fontFileForWeight(family, cssFaceWeight(weight)).weight);
}

let registered = false;

/**
 * Register every curated face (all weights) with @napi-rs/canvas exactly once per
 * process. Idempotent: repeated calls (e.g. one per exported cut) are cheap and
 * do not re-read the files. Safe to call before any drawing.
 */
export function registerToonyFonts(): void {
  if (registered) return;
  for (const family of FONT_FAMILIES) {
    for (const face of family.files) {
      // registerFromPath(path, family-name): self-hosted woff2 from the fonts
      // package assets, never a CDN. @napi-rs/canvas decodes woff2 directly.
      GlobalFonts.registerFromPath(
        fontAssetPath(face.file),
        nameForFaceWeight(family, face.weight),
      );
    }
  }
  registered = true;
}

/**
 * The canvas family name for an overlay's resolved family + weight. `familyId`
 * is the render plan's resolved `fontFamily`; `weight` is its resolved
 * `fontWeight`. Falls back through the per-kind default exactly like render, so
 * an absent/unknown family draws the same face the preview shows.
 */
export function canvasFontFamily(
  familyId: FontFamilyId | string | undefined,
  weight: number,
  kind: BubbleKind,
): string {
  const family =
    (typeof familyId === "string" ? getFontFamily(familyId) : undefined) ??
    resolveFontFamily(familyId, kind);
  // CSS-matched face (600-700 → bold), then the registered name for the file that
  // actually exists — so a 400-only family at a bold weight still resolves to a
  // registered name instead of an unregistered "<name> 700" that would fall back.
  return canvasFamilyName(family, weight);
}
