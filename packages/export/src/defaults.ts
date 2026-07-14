// Plain export defaults (#154) — deliberately free of any Node/canvas import.
//
// The Node-only export engine (targets/encode) imports these, AND the studio's
// browser client (export-panel) single-sources them via "@toony/export/defaults"
// — a module with no runtime dependencies, so pulling these numbers into a client
// bundle does NOT drag in `@napi-rs/canvas` / `node:fs`. Exactly one defining site.

/** Per-target default render width in px. */
export const PLATFORM_DEFAULT_WIDTH = 1200;
export const STITCHED_DEFAULT_WIDTH = 1200;
export const PLOTLINK_DEFAULT_WIDTH = 800;

/** Default lossy encode quality (0..100) for JPEG / WebP. */
export const DEFAULT_JPEG_QUALITY = 82;
export const DEFAULT_WEBP_QUALITY = 82;
