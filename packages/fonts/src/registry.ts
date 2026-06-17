// The single source-of-truth font family registry for Toony lettering.
//
// Every consumer that needs to render bubble text — the studio SVG preview/editor
// (@font-face + SVG `font-family`), the canvas export (@napi-rs/canvas
// `GlobalFonts.registerFromPath`), and schema validation (the allowed family ids)
// — imports THIS module so they cannot drift. A `fontFamily` saved on a lettering
// overlay is one of these ids; render maps it to a CSS font stack, export maps it
// to a registered canvas family, and both pick the same underlying woff2 file for
// a given weight, so the SAME face renders in SVG and in the exported raster.
//
// All faces are free Google Fonts under the SIL Open Font License (OFL). The
// woff2 files in ../assets are SELF-HOSTED (never fetched from a CDN at runtime)
// and the CJK faces are subset to a curated glyph coverage (see assets/README) to
// keep the bundle light. Each family's OFL.txt ships beside the woff2 files.

import { type BubbleKind, FONT_FAMILY_IDS, type FontFamilyId } from "@toony/schema";

/** The body weights a face may ship as separate files. */
export type FontFaceWeight = 400 | 700;

/** A single weight's self-hosted woff2 file for a family. */
export interface FontFaceFile {
  weight: FontFaceWeight;
  /** woff2 filename within the fonts package `assets/` directory. */
  file: string;
}

/** Which writing systems a face covers, so the editor can group/filter sensibly. */
export type FontScript = "latin" | "korean" | "japanese";

/** One curated font family. `id` is the stable value persisted on overlays. */
export interface FontFamily {
  /** Stable id persisted as `LetteringOverlay.fontFamily` and validated by schema. */
  id: FontFamilyId;
  /** Human-readable name shown in the editor and used as the canvas/CSS family name. */
  name: string;
  /**
   * CSS font stack for SVG/HTML rendering: the family name first, then a generic
   * fallback so text still shows before the woff2 loads (and for glyphs outside
   * the subset). Render and the studio @font-face use this same `name`.
   */
  stack: string;
  /** Writing systems this curated/subset build covers. */
  scripts: FontScript[];
  /** Self-hosted woff2 files, one per shipped weight. The 400 file is always present. */
  files: FontFaceFile[];
  /** OFL license filename within `assets/`. */
  license: string;
}

const GENERIC_FALLBACK = "sans-serif";

function stack(name: string): string {
  // Quote the family name (several contain spaces) and end with a generic family
  // so rendering degrades gracefully before the woff2 loads.
  return `"${name}", ${GENERIC_FALLBACK}`;
}

/**
 * The curated set. Order is the editor's display order: clean dialogue faces,
 * then display/impact faces, then handwriting faces. Latin faces also cover ASCII
 * for any language; the CJK faces additionally cover their script's subset.
 */
export const FONT_FAMILIES: readonly FontFamily[] = [
  {
    id: "nunito",
    name: "Nunito",
    stack: stack("Nunito"),
    scripts: ["latin"],
    files: [
      { weight: 400, file: "nunito-400.woff2" },
      { weight: 700, file: "nunito-700.woff2" },
    ],
    license: "nunito-OFL.txt",
  },
  {
    id: "noto-sans-kr",
    name: "Noto Sans KR",
    stack: stack("Noto Sans KR"),
    scripts: ["latin", "korean"],
    files: [
      { weight: 400, file: "noto-sans-kr-400.woff2" },
      { weight: 700, file: "noto-sans-kr-700.woff2" },
    ],
    license: "noto-sans-kr-OFL.txt",
  },
  {
    id: "noto-sans-jp",
    name: "Noto Sans JP",
    stack: stack("Noto Sans JP"),
    scripts: ["latin", "japanese"],
    files: [
      { weight: 400, file: "noto-sans-jp-400.woff2" },
      { weight: 700, file: "noto-sans-jp-700.woff2" },
    ],
    license: "noto-sans-jp-OFL.txt",
  },
  {
    id: "bangers",
    name: "Bangers",
    stack: stack("Bangers"),
    scripts: ["latin"],
    files: [{ weight: 400, file: "bangers-400.woff2" }],
    license: "bangers-OFL.txt",
  },
  {
    id: "anton",
    name: "Anton",
    stack: stack("Anton"),
    scripts: ["latin"],
    files: [{ weight: 400, file: "anton-400.woff2" }],
    license: "anton-OFL.txt",
  },
  {
    id: "patrick-hand",
    name: "Patrick Hand",
    stack: stack("Patrick Hand"),
    scripts: ["latin"],
    files: [{ weight: 400, file: "patrick-hand-400.woff2" }],
    license: "patrick-hand-OFL.txt",
  },
  {
    id: "gaegu",
    name: "Gaegu",
    stack: stack("Gaegu"),
    scripts: ["latin", "korean"],
    files: [
      { weight: 400, file: "gaegu-400.woff2" },
      { weight: 700, file: "gaegu-700.woff2" },
    ],
    license: "gaegu-OFL.txt",
  },
  {
    id: "nanum-pen",
    name: "Nanum Pen Script",
    stack: stack("Nanum Pen Script"),
    scripts: ["latin", "korean"],
    files: [{ weight: 400, file: "nanum-pen-400.woff2" }],
    license: "nanum-pen-OFL.txt",
  },
];

// Compile-time guard against drift: every schema id must have exactly one family
// and vice versa. If the registry and the schema id contract diverge, one of
// these lookups produces `undefined` and this typed assignment fails to compile.
const _everySchemaIdHasFamily: Record<FontFamilyId, FontFamily> = Object.fromEntries(
  FONT_FAMILIES.map((f) => [f.id, f]),
) as Record<FontFamilyId, FontFamily>;
for (const id of FONT_FAMILY_IDS) {
  if (!_everySchemaIdHasFamily[id]) {
    throw new Error(`font registry is missing a family for schema id "${id}"`);
  }
}

/** All valid `fontFamily` ids — re-exported from the schema contract. */
export { FONT_FAMILY_IDS };

const BY_ID = new Map<FontFamilyId, FontFamily>(FONT_FAMILIES.map((f) => [f.id, f]));

// A statically-known member used as the last-resort fallback so resolution never
// returns `undefined`; the registry array is a non-empty literal so [0] exists.
const FIRST_FAMILY: FontFamily = FONT_FAMILIES[0] as FontFamily;

/** Whether `id` is a known curated family id. */
export function isFontFamilyId(id: unknown): id is FontFamilyId {
  return typeof id === "string" && (FONT_FAMILY_IDS as readonly string[]).includes(id);
}

/** Look up a family by id, or `undefined` when unknown. */
export function getFontFamily(id: string): FontFamily | undefined {
  return isFontFamilyId(id) ? BY_ID.get(id) : undefined;
}

/**
 * The default family id for each bubble kind. Dialogue kinds default to a clean
 * sans (Noto Sans KR covers Latin + Korean, the project's primary dialogue
 * languages); shout/sfx default to the loud display faces; thought/narration
 * default to a soft handwriting face. An overlay with no `fontFamily` resolves
 * through this map, so projects written before #56 pick a sensible per-kind face.
 */
const DEFAULT_BY_KIND: Record<BubbleKind, FontFamilyId> = {
  speech: "noto-sans-kr",
  whisper: "noto-sans-kr",
  thought: "patrick-hand",
  narration: "patrick-hand",
  shout: "bangers",
  sfx: "anton",
  // #93: a beat's "…" pause reads soft like thought; ambient noise is clean/dense.
  beat: "patrick-hand",
  ambient: "noto-sans-kr",
};

/** The default curated family id for a bubble kind (used when an overlay omits one). */
export function defaultFontFamilyForKind(kind: BubbleKind): FontFamilyId {
  return DEFAULT_BY_KIND[kind] ?? "noto-sans-kr";
}

/**
 * Resolve an overlay's `fontFamily` (possibly absent/unknown for back-compat) to
 * a concrete family, falling back to the per-kind default. Always returns a
 * registered family, so render and export never end up on an unregistered face.
 */
export function resolveFontFamily(
  fontFamily: string | undefined | null,
  kind: BubbleKind,
): FontFamily {
  if (isFontFamilyId(fontFamily)) {
    const fam = BY_ID.get(fontFamily);
    if (fam) return fam;
  }
  const fallback = BY_ID.get(defaultFontFamilyForKind(kind));
  // The per-kind default ids are all registry members, so this is always defined;
  // the final coalesce keeps the return type non-optional without a non-null cast.
  return fallback ?? FIRST_FAMILY;
}

/**
 * The CSS font stack for an overlay's resolved family — what SVG/HTML rendering
 * sets as `font-family`. Render uses this so the preview matches the editor.
 */
export function fontStackFor(fontFamily: string | undefined | null, kind: BubbleKind): string {
  return resolveFontFamily(fontFamily, kind).stack;
}

/** The woff2 file for a family at the nearest available weight (>=700 → 700, else 400). */
export function fontFileForWeight(family: FontFamily, weight: number): FontFaceFile {
  if (weight >= 700) {
    const bold = family.files.find((f) => f.weight === 700);
    if (bold) return bold;
  }
  const regular = family.files.find((f) => f.weight === 400);
  // Every family ships a 400 file by construction; the first file is the final
  // fallback so the return type stays non-optional.
  return regular ?? (family.files[0] as FontFaceFile);
}
