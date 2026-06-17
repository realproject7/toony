// Public API for @toony/schema: the shared structural model, its validators,
// and canonical serialization for Toony projects.

export type { ValidationIssue, ValidationResult } from "./errors.js";
export { IssueCollector, joinPath } from "./errors.js";
export {
  EXPORT_QUALITY_MAX,
  EXPORT_QUALITY_MIN,
  EXPORT_WIDTH_MAX,
  EXPORT_WIDTH_MIN,
  validateExportInt,
  validateExportQuality,
  validateExportWidth,
} from "./export-options.js";
export { isPathSafeId } from "./path-safe-id.js";
export { parseProject, serializeProject } from "./serialize.js";
export type {
  BubbleBorder,
  BubbleGeometry,
  BubbleKind,
  Character,
  Cut,
  Episode,
  EpisodeBundle,
  FontFamilyId,
  FontWeight,
  ImageAssetRef,
  ImageProvidersConfig,
  LanguageConfig,
  LetteringOverlay,
  NormalizedPoint,
  Project,
  ProviderConfig,
  ReviewStatus,
  SequenceItem,
  TextAlign,
  Transition,
  TransitionType,
  Webtoon,
} from "./types.js";
export {
  BUBBLE_KINDS,
  CORNER_RADIUS_MAX_PX,
  CORNER_RADIUS_MIN_PX,
  FONT_FAMILY_IDS,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_WEIGHTS,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  LETTER_SPACING_MAX_EM,
  LETTER_SPACING_MIN_EM,
  LETTERING_STYLE_DEFAULTS,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MANUAL_PROVIDER_ID,
  REVIEW_STATUSES,
  SCHEMA_VERSION,
  TEXT_ALIGNS,
  TRANSITION_TYPES,
} from "./types.js";
export {
  isProjectRelativePath,
  validateCutValue,
  validateEpisodeValue,
  validateImageProvidersValue,
  validateLanguageConfigValue,
  validateLetteringOverlayValue,
  validateProject,
  validateSequenceItemValue,
  validateTransitionValue,
  validateWebtoon,
  validateWebtoonValue,
} from "./validate.js";
