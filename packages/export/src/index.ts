// Public API for @toony/export: headless platform / stitched / PlotLink-ready
// exports built on the shared renderer, plus the export manifest schema.

export { composeCut, composeTransitionBand } from "./compose.js";
export {
  asCraftBand,
  CRAFT_BAND_FORMAT_VERSION,
  CRAFT_METRIC_NAMES,
  type CraftBand,
  type CraftBandRange,
  type CraftBandReport,
  type CraftMeasurement,
  type CraftMetricName,
  type CraftMetrics,
  type CraftMetricVerdict,
  compareToCraftBand,
  DEFAULT_SCREEN_ASPECT,
  FLAT_ROW_STDDEV_MAX,
  GUTTER_MIN_RUN_FRACTION,
  type MeasureOptions,
  measureEpisodeCraft,
  PANEL_MIN_RUN_FRACTION,
  validateCraftBandValue,
} from "./craft.js";
// Plain constants live in the Node-free `./defaults.js` (also a browser-safe
// subpath) so consumers keep importing them from the main entry (#154).
export {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_WEBP_QUALITY,
  PLATFORM_DEFAULT_WIDTH,
  PLOTLINK_DEFAULT_WIDTH,
  STITCHED_DEFAULT_WIDTH,
} from "./defaults.js";
export {
  clampQuality,
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
  BUILTIN_EXPORT_PRESETS,
  type ExportPreset,
  listExportPresetIds,
  resolveExportPreset,
} from "./presets.js";
export {
  type ExportOptions,
  type ExportOutput,
  exportPlatform,
  exportPlotlink,
  exportStitched,
  type StitchedEpisode,
  stitchEpisode,
} from "./targets.js";
