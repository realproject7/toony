// Carry a bubble's resolved face where the studio stylesheet cannot outrank it (#229).
//
// `layoutCut` resolves one curated face per bubble (#56) and the export raster
// draws that face. The studio drew Inter for every bubble instead. An SVG
// `font-family` written as an XML presentation attribute sits below every author
// stylesheet rule in the cascade, so `.cut-overlays text { font-family:
// var(--font-display) }` took the resolved face away. The damage is not cosmetic:
// `useBrowserMeasure` measures with the resolved family (#149), so wrap points,
// auto-fit size and the per-line insets from #210 were all chosen for Nunito and
// then drawn in a face 5-7% wider.
//
// A style property is a declaration on the element itself, so no author rule can
// outrank it. `transition-block.tsx` already sets its band face the same way. The
// render plan stays the single source of the face: this derives nothing.

import type { BubbleRender } from "@toony/render";
import type { CSSProperties } from "react";

/**
 * The style an overlay `<text>` carries so the plan's face reaches the glyphs.
 * Takes the whole plan, not a family string, so a caller cannot hand it a face
 * the plan did not resolve.
 */
export function bubbleTextStyle(plan: BubbleRender): CSSProperties {
  return { fontFamily: plan.fontStack };
}
