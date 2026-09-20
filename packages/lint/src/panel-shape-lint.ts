// Declared-vs-rendered panel shape lint (#260).
//
// `Cut.panelAspect` (#237) binds when the art is made: generation resolves the
// declaration into the latent height, and the composed page takes the panel's
// height from the image that came back. A cut that ALREADY carried art when the
// declaration was written — or whose declaration was edited afterwards — keeps
// composing at its art's shape, because nothing re-cuts an image to match a
// declaration made after it. The declaration is then describing a page that is
// not the page, and before this lint the only way to find that out was to
// measure the export.
//
// Both sides of the comparison come from `@toony/render`'s `resolveCutAspect`,
// so the shape a consumer stages the cut at and the shape this reports on are
// the same arithmetic.

import { resolveCutAspect } from "@toony/render";
import type { EpisodeBundle } from "@toony/schema";
import { type ResolveCutImage, readCutDimensions } from "./cut-image.js";
import { type Finding, finding } from "./findings.js";

/**
 * How far a cut's art may sit from its declared `panelAspect` before the
 * mismatch is reported, in width-multiples — the unit the declaration itself is
 * in, so no conversion can disagree with it.
 *
 * The number is the generator's own rounding, not a taste call. A declared shape
 * is resolved into a latent height snapped to ComfyUI's 8px grid, so even art
 * made UNDER the declaration comes back up to half a block — 4px — off it. Four
 * pixels is `4 / column` of a width, which is 0.0048 at an 832px column and
 * grows as the column narrows; 0.02 covers the snap at any column of 256px or
 * wider, a third the column the recorded render pass generated at and narrower
 * than any latent worth sampling. (`panel-shape.test.ts` in the CLI asserts that
 * against the conversion itself, over a sweep of columns, so this cannot quietly
 * stop covering it.)
 *
 * The other bound is that it must still catch a re-cut panel, and 0.02 is an
 * order of magnitude under the gaps a pacing pack actually declares between
 * shapes — the two closest in the worked nine-cut example are 0.30 and 0.44.
 * Between those two bounds the exact value is not delicate, so it is the round
 * number inside them.
 */
export const PANEL_ASPECT_TOLERANCE = 0.02;

/** Trim a resolved aspect for a message: enough digits to act on, no float dust. */
function showAspect(aspect: number): string {
  return aspect.toFixed(3);
}

/**
 * Report every cut whose art's shape differs from the `panelAspect` it declares
 * by more than `PANEL_ASPECT_TOLERANCE`. One `warning` per cut, targeting the
 * cut.
 *
 * A cut that declares nothing is never reported, whatever shape its art is:
 * absent means untouched, here as everywhere else. Neither is a cut with no
 * readable art — there is no second number to disagree with, and the declaration
 * will bind the next time the cut is generated.
 */
export function lintPanelShape(bundle: EpisodeBundle, resolveImage: ResolveCutImage): Finding[] {
  const findings: Finding[] = [];

  for (const cut of bundle.cuts) {
    const dims = readCutDimensions(resolveImage(cut.id));
    if (dims === null) continue;

    // Two questions to one resolver. The first is asked WITHOUT the art, the
    // way every consumer staging an art-less cut asks it, so what comes back is
    // the cut's own claim about its shape — or, for a cut that claims nothing,
    // the fallback, which is not a claim and must not be compared against
    // anything. The second is asked with only the art, so the height/width
    // division that produces the page's real shape happens in one place.
    const declared = resolveCutAspect(cut.panelAspect, null);
    if (declared.source !== "declared") continue;
    const rendered = resolveCutAspect(undefined, dims);
    if (Math.abs(declared.aspect - rendered.aspect) <= PANEL_ASPECT_TOLERANCE) continue;

    findings.push(
      finding(
        "warning",
        "cut/panel-aspect-mismatch",
        cut.id,
        `cut "${cut.id}" declares panelAspect ${declared.aspect} but its art is ${dims.width}x${dims.height}, ${showAspect(rendered.aspect)} of its width; the page composes at the art's shape, so re-generate the cut to bind the declaration or drop it.`,
      ),
    );
  }

  return findings;
}
