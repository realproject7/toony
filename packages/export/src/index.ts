// Public API for @toony/export: headless platform / stitched / PlotLink-ready
// exports built on the shared renderer, plus the export manifest schema.

export { composeCut, composeTransitionBand } from "./compose.js";
export {
  clampQuality,
  DEFAULT_JPEG_QUALITY,
  DEFAULT_WEBP_QUALITY,
  encodeCanvas,
  encodeWebpToFit,
  type FitResult,
  type RasterFormat,
} from "./encode.js";
export { ExportError } from "./errors.js";
export {
  EXPORT_TARGET_KINDS,
  type ExportManifest,
  type ExportTargetKind,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  type ManifestFile,
  type ManifestMarkdown,
  PLOTLINK_MAX_BYTES,
  PLOTLINK_MAX_IMAGES,
  sha256Hex,
  validateManifest,
} from "./manifest.js";
export {
  buildPlotlinkMarkdown,
  PLOTLINK_MARKDOWN_MAX,
  PLOTLINK_MARKDOWN_MIN,
} from "./markdown.js";
export {
  type ExportOptions,
  type ExportOutput,
  exportPlatform,
  exportPlotlink,
  exportStitched,
} from "./targets.js";
