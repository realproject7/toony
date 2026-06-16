// Shared schema definitions for Toony projects.
//
// This package owns the canonical structural model consumed by the preview
// (#7), lettering editor (#8), transition editor (#9), export (#10), and lint
// (#11) tickets. Downstream tickets import these definitions instead of
// redefining them, so the data contract has a single source of truth.
//
// File loading and YAML/JSON parsing are intentionally NOT part of this module:
// validators operate on already-parsed structures, keeping the schema headless
// and deterministic. The CLI (#5) is responsible for reading files from disk.

/** Schema version embedded in `webtoon.json` and `episode.yaml`. */
export const SCHEMA_VERSION = 1;

/** Built-in provider id meaning "assets are supplied manually". */
export const MANUAL_PROVIDER_ID = "manual";

/**
 * Bubble kinds for lettering overlays. This is the MVP vocabulary; new kinds
 * are added here so consumers validate against one list.
 */
export const BUBBLE_KINDS = ["speech", "thought", "narration", "shout", "whisper", "sfx"] as const;
export type BubbleKind = (typeof BUBBLE_KINDS)[number];

/**
 * Transition type vocabulary between cuts. `gutter` is plain vertical spacing;
 * the others describe reading-rhythm beats. MVP vocabulary, extended here.
 */
export const TRANSITION_TYPES = [
  "hard-cut",
  "gutter",
  "fade",
  "beat",
  "scene-break",
  "time-skip",
] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/** Review/human-edit status shared by lettering overlays and transitions. */
export const REVIEW_STATUSES = ["draft", "human-edited", "final"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Gutter height is expressed in CSS pixels (px) — the natural shared unit for
 * the preview (#7), transition editor (#9), and stitched export (#10), which
 * preserves gutters at concrete heights. Must be an integer in this range.
 */
export const GUTTER_HEIGHT_MIN_PX = 0;
export const GUTTER_HEIGHT_MAX_PX = 4096;

/**
 * A normalized point in the cut-image coordinate space: both axes are in the
 * inclusive range 0..1, with (0,0) at the top-left of the cut image.
 */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * Bubble box geometry, normalized 0..1 relative to the cut image. `x`/`y` are
 * the top-left corner; `width`/`height` are positive and must keep the box
 * inside the image (x + width <= 1, y + height <= 1). Resizing adjusts
 * width/height within these bounds.
 */
export interface BubbleGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bubble border styling. `width` is in px (>= 0); `color` is a CSS color. */
export interface BubbleBorder {
  width: number;
  color: string;
}

/**
 * A single lettering overlay placed on a cut. The tail resolves deterministically
 * to a normalized point in the same 0..1 coordinate space as `geometry`; a null
 * tail means the bubble is tailless (e.g. narration boxes). Consumers therefore
 * never re-derive tail positions from an enum.
 */
export interface LetteringOverlay {
  id: string;
  cutId: string;
  speaker: string;
  kind: BubbleKind;
  text: string;
  font: string;
  fill: string;
  opacity: number;
  border: BubbleBorder | null;
  tail: NormalizedPoint | null;
  geometry: BubbleGeometry;
  overflow: boolean;
  reviewStatus: ReviewStatus;
}

/**
 * Project-relative image asset paths for a cut. Populated by the asset
 * ingestion/generation workflow (#14); null until an asset is associated.
 */
export interface ImageAssetRef {
  clean: string | null;
  final: string | null;
}

/** A cut record. Image assets are referenced project-relative, never absolute. */
export interface Cut {
  id: string;
  image: ImageAssetRef | null;
}

/** A transition record placed between cuts in the canonical sequence. */
export interface Transition {
  id: string;
  type: TransitionType;
  gutterHeight: number;
  text: string | null;
  sfx: string | null;
  agentNote: string | null;
  humanNote: string | null;
  image: string | null;
  reviewStatus: ReviewStatus;
}

/** An item in the canonical episode reading sequence. */
export type SequenceItem = { type: "cut"; id: string } | { type: "transition"; id: string };

/** An episode: an ordered reading sequence of cut and transition references. */
export interface Episode {
  schemaVersion: number;
  id: string;
  title: string;
  sequence: SequenceItem[];
}

/** Project-level language configuration. */
export interface LanguageConfig {
  defaultLanguage: string;
  supportedLanguages: string[];
  dialogueLanguage: string;
  promptLanguage: string;
}

/**
 * A configured image provider. Fields are provider-neutral labels only — no
 * account ids, keys, endpoints, or other private provider details belong here.
 */
export interface ProviderConfig {
  id: string;
  kind: string;
}

/** Image provider configuration. `defaultProvider` is `manual` or a provider id. */
export interface ImageProvidersConfig {
  defaultProvider: string;
  providers: ProviderConfig[];
}

/** The `webtoon.json` project root. */
export interface Webtoon {
  schemaVersion: number;
  projectId: string;
  title: string;
  languages: LanguageConfig;
  imageProviders: ImageProvidersConfig;
}

/** The records for a single episode, assembled from its files. */
export interface EpisodeBundle {
  episode: Episode;
  cuts: Cut[];
  transitions: Transition[];
  lettering: LetteringOverlay[];
}

/** A full project: the webtoon root plus every episode bundle. */
export interface Project {
  webtoon: Webtoon;
  episodes: EpisodeBundle[];
}
