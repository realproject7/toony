// Node-side helpers for locating the self-hosted font assets on disk.
//
// The export raster path (@toony/export) registers these woff2 files with
// @napi-rs/canvas before drawing, and tooling copies them into the studio's
// public directory. Both need the absolute on-disk path of an asset; this module
// resolves it relative to the built package so it works from any cwd and after
// the package is installed into another workspace.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the fonts package `assets/` directory (the woff2 files and
 * OFL licenses). Resolved from this module's own URL so it is correct whether the
 * code runs from `src` (ts) or `dist` (built) — both sit one level under the
 * package root, beside `assets/`.
 */
export function fontsAssetDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // `here` is <pkg>/dist (built) or <pkg>/src (dev); assets sits at <pkg>/assets.
  return join(here, "..", "assets");
}

/** Absolute path to a named asset file within `assets/`. */
export function fontAssetPath(file: string): string {
  return join(fontsAssetDir(), file);
}
