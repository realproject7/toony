// Public API for @toony/schema: the shared structural model, its validators,
// and canonical serialization for Toony projects.

export type { ValidationIssue, ValidationResult } from "./errors.js";
export { IssueCollector, joinPath } from "./errors.js";
export { parseProject, serializeProject } from "./serialize.js";
export type {
  BubbleBorder,
  BubbleGeometry,
  BubbleKind,
  Cut,
  Episode,
  EpisodeBundle,
  ImageAssetRef,
  ImageProvidersConfig,
  LanguageConfig,
  LetteringOverlay,
  NormalizedPoint,
  Project,
  ProviderConfig,
  ReviewStatus,
  SequenceItem,
  Transition,
  TransitionType,
  Webtoon,
} from "./types.js";
export {
  BUBBLE_KINDS,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  MANUAL_PROVIDER_ID,
  REVIEW_STATUSES,
  SCHEMA_VERSION,
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
