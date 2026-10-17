// Public API for @toony/fonts: the single source-of-truth curated font family
// registry plus helpers to resolve a family for rendering (CSS stack), for
// canvas registration (on-disk woff2 paths), and for self-hosting (@font-face
// CSS). Imported by @toony/render, @toony/export, and the studio so the SAME
// curated OFL faces render in the SVG preview and in the exported raster.

export type { FontFamilyId } from "@toony/schema";
export { fontFaceCss, fontFacesCss } from "./css.js";
export {
  defaultFontFamilyForKind,
  FONT_FAMILIES,
  FONT_FAMILY_IDS,
  type FontFaceFile,
  type FontFaceWeight,
  type FontFamily,
  type FontScript,
  fontFileForWeight,
  fontStackFor,
  getFontFamily,
  isFontFamilyId,
  resolveFontFamily,
} from "./registry.js";

// NOTE: on-disk asset path helpers (`fontAssetPath`, `fontsAssetDir`) use
// `node:url` and are NOT re-exported here so this entry stays browser-safe for
// @toony/render and the studio's client components. Import them from
// "@toony/fonts/node" in Node-only code (e.g. @toony/export's canvas
// registration).
