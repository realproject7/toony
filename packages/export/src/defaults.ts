// Plain export defaults (#154), with no Node/canvas imports.
//
// The Node-only export engine (targets/encode) imports these, AND the studio's
// browser client (export-panel) single-sources them via "@toony/export/defaults"
// — a module with no runtime dependencies, so a client
// bundle does NOT drag in `@napi-rs/canvas` / `node:fs`. Exactly one defining site.

/** Per-target default render width in px. */
export const PLATFORM_DEFAULT_WIDTH = 1200;
/** Legacy fixed width used by geometry planning. Stitched output now uses referenceWidth. */
export const STITCHED_DEFAULT_WIDTH = 1200;
export const PLOTLINK_DEFAULT_WIDTH = 800;

/** Default lossy encode quality (0..100) for JPEG / WebP. */
export const DEFAULT_JPEG_QUALITY = 82;
export const DEFAULT_WEBP_QUALITY = 82;
