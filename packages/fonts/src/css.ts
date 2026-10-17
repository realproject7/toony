// Generate the `@font-face` CSS that self-hosts the curated woff2 faces.
//
// The studio serves the woff2 files from its own origin (no CDN) and injects
// these rules so the SVG preview/editor render with the SAME family names the
// registry exposes — the names render also targets and export registers. The
// `display: swap` + `unicode-range`-free declarations keep it simple; CJK faces
// are large-ish even subset, so callers can mark them `font-display: optional`
// or lazy-load by only emitting the families the current view needs.

import { FONT_FAMILIES, type FontFamily } from "./registry.js";

/** Build the `@font-face` block for one family at `baseUrl` (no trailing slash needed). */
export function fontFaceCss(family: FontFamily, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return family.files
    .map(
      (f) =>
        `@font-face {\n` +
        `  font-family: "${family.name}";\n` +
        `  font-style: normal;\n` +
        `  font-weight: ${f.weight};\n` +
        `  font-display: swap;\n` +
        `  src: url("${base}/${f.file}") format("woff2");\n` +
        `}`,
    )
    .join("\n");
}

/**
 * Build the full `@font-face` stylesheet for the curated set (or a subset of
 * families), with every woff2 referenced relative to `baseUrl`. Studio injects
 * this so the editor and preview render the selected faces from self-hosted
 * files. Pass a filtered `families` list to lazy-load only what a view needs.
 */
export function fontFacesCss(
  baseUrl: string,
  families: readonly FontFamily[] = FONT_FAMILIES,
): string {
  return families.map((f) => fontFaceCss(f, baseUrl)).join("\n\n");
}
