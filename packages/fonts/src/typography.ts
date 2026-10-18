import type { FontFamilyId } from "@toony/schema";

/** OS/2 sTypoAscender / -sTypoDescender, normalized by head.unitsPerEm.
 * Read from the bundled regular faces. Shared line metrics avoid platform ink
 * rounding and keep punctuation-only/empty lines on the same baseline grid.
 * Legacy render paths retain their previous metrics.
 */
const TYPOGRAPHY: Record<FontFamilyId, { ascent: number; descent: number }> = {
  nunito: { ascent: 1.011, descent: 0.353 },
  "noto-sans-kr": { ascent: 0.88, descent: 0.12 },
  "noto-sans-jp": { ascent: 0.88, descent: 0.12 },
  bangers: { ascent: 0.883, descent: 0.181 },
  anton: { ascent: 1.17626953125, descent: 0.3291015625 },
  "patrick-hand": { ascent: 1.024, descent: 0.312 },
  gaegu: { ascent: 0.76, descent: 0.24 },
  "nanum-pen": { ascent: 0.8, descent: 0.2 },
};

export function fontTypography(id: FontFamilyId): Readonly<{ ascent: number; descent: number }> {
  return TYPOGRAPHY[id];
}
