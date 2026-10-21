// Public API for @toony/export: headless episode strip, cut image and social
// frame exports built on the shared renderer, plus the export manifest schema.

export { composeCut, composeTransitionBand } from "./compose.js";
export {
  type ContactSheetOptions,
  type ContactSheetPicture,
  composeContactSheet,
} from "./contact-sheet.js";
export {
  asCraftBand,
  CRAFT_BAND_FORMAT_VERSION,
  CRAFT_CAPTURE_MODES,
  CRAFT_METRIC_NAMES,
  type CraftBand,
  type CraftBandProvenance,
  type CraftBandRange,
  type CraftBandReport,
  type CraftBandWork,
  type CraftCaptureMode,
  type CraftMeasurement,
  type CraftMetricName,
  type CraftMetrics,
  type CraftMetricVerdict,
  type CraftRecordedMetric,
  compareToCraftBand,
  compareToTransitionVocabulary,
  DEFAULT_SCREEN_ASPECT,
  FLAT_ROW_STDDEV_MAX,
  GUTTER_MIN_RUN_FRACTION,
  type MeasureOptions,
  measureEpisodeCraft,
  measureTransitionMix,
  PANEL_MIN_RUN_FRACTION,
  type PageGeometryMetrics,
  sequencedTransitions,
  type TransitionKindMix,
  type TransitionMix,
  type TransitionRangeVerdict,
  type TransitionVocabularyEntry,
  type TransitionVocabularyVerdict,
  validateCraftBandValue,
} from "./craft.js";
// Plain constants live in the Node-free `./defaults.js` (also a browser-safe
// subpath) so consumers keep importing them from the main entry (#154).
export {
  BUILTIN_OUTPUTS,
  type BuiltinOutput,
  CUTS_DEFAULT_WIDTH,
  DEFAULT_JPEG_QUALITY,
  EXPORT_BACKGROUND,
  type FrameInsets,
  OUTPUT_ALIASES,
  SOCIAL_FIT_MIN_SCALE,
  SOCIAL_FRAMES,
  type SocialFrame,
  STITCHED_DEFAULT_WIDTH,
  socialOutputForFrame,
} from "./defaults.js";
export { clampQuality, encodeCanvas, type RasterFormat } from "./encode.js";
export { ExportError } from "./errors.js";
export { type ImageDimensions, type ImageFormat, readImageDimensions } from "./image-dimensions.js";
export {
  type BandRole,
  cutRasterHeight,
  frameContentBox,
  type LayoutBand,
  type LayoutFile,
  type LayoutPiece,
  type LayoutPlan,
  type LayoutWarning,
  layoutBands,
  planCuts,
  planOutput,
  planSocial,
  planStrip,
  type ResolvedOutputOptions,
  resolveOutputOptions,
} from "./layout.js";
export { computeInputsHash, episodeInputsHash } from "./load.js";
export {
  EXPORT_TARGET_KINDS,
  type ExportManifest,
  type ExportTargetKind,
  MANIFEST_FILE,
  MANIFEST_FILE_ROLES,
  MANIFEST_VERSION,
  type ManifestFile,
  type ManifestFileRole,
  type ManifestItem,
  type ManifestOptions,
  type ManifestWarning,
  sha256Hex,
  validateManifest,
} from "./manifest.js";
export {
  type ExportOptions,
  type ExportOutput,
  type ExportProgress,
  type ExportRun,
  exportCuts,
  exportSocial,
  exportStrip,
  exportWithPreset,
} from "./outputs.js";
export {
  asEpisodePlan,
  comparePlanToCraftBand,
  EPISODE_PLAN_FORMAT_VERSION,
  type EpisodePlan,
  measureEpisodeBundle,
  measureEpisodePlan,
  measurePlan,
  PLAN_PAGE_ROWS_MAX,
  PLAN_UNCHECKED_METRICS,
  type PlanBandGraded,
  type PlanBandReport,
  type PlanBandUngraded,
  type PlanBeat,
  type PlanBeatMeasurement,
  type PlanGap,
  type PlanMeasurement,
  type PlanUncheckedMetric,
  validateEpisodePlanValue,
} from "./plan.js";
export {
  BUILTIN_EXPORT_PRESETS,
  type ContributedExportPreset,
  type ExportPreset,
  listExportPresetIds,
  resolveExportPreset,
} from "./presets.js";
export { publishExport } from "./publish.js";
// The raster caps (#277), exported so a record of a composed page can state its
// size beside the limits that admitted it (#314).
export {
  CANVAS_PIXELS_MAX,
  EPISODE_RASTER_BYTES_MAX,
  IMAGE_FILE_BYTES_MAX,
  IMAGE_PIXELS_MAX,
  RASTER_DIMENSION_MAX,
  viewedImageBytes,
} from "./raster-safety.js";
export { type EpisodeBand, type StitchedEpisode, stitchEpisode } from "./targets.js";
