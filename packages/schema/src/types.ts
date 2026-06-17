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
export const BUBBLE_KINDS = [
  "speech",
  "thought",
  "narration",
  "shout",
  "whisper",
  "sfx",
  // v3 bubble grammar (#93): `beat` = an ellipsis/"…" silence-pause bubble;
  // `ambient` = a small, dense, low-emphasis "background noise" bubble.
  "beat",
  "ambient",
] as const;
export type BubbleKind = (typeof BUBBLE_KINDS)[number];

/**
 * Emotional tone for a bubble (#93). Refines the outline SHAPE so the silhouette
 * encodes emotion: `neutral` keeps the kind's default outline; `shout` →
 * scalloped/cloud; `aggressive` → jagged/spiky. Default `"neutral"`.
 */
export const BUBBLE_TONES = ["neutral", "shout", "aggressive"] as const;
export type BubbleTone = (typeof BUBBLE_TONES)[number];

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

// --- Pro-lettering style fields (#54) ---------------------------------------
//
// Additive, OPTIONAL style overrides on a lettering overlay (mirrors how #38
// added prompt fields to Cut). When a field is absent, `@toony/render`
// reproduces the CURRENT behavior — auto-fit sizing and per-kind weight/color/
// corner-radius — so every project written before these fields existed renders
// identically. The exact bounds/enums/defaults below are the single contract
// that schema validation, `@toony/render`, Studio (#55), and `@toony/export`
// (#53) all agree on.

/** Allowed body font weights. */
export const FONT_WEIGHTS = [400, 500, 600, 700] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/**
 * The curated lettering font-family ids (#56). This list is the schema-level
 * CONTRACT for the optional `LetteringOverlay.fontFamily` field: validation
 * accepts only these ids, and the `@toony/fonts` family registry is built to
 * match them one-for-one. All faces are free Google Fonts under the SIL Open Font
 * License, self-hosted as subset woff2 — schema only needs the id vocabulary, not
 * the files, so it stays headless and free of any font-asset dependency.
 */
export const FONT_FAMILY_IDS = [
  "nunito",
  "noto-sans-kr",
  "noto-sans-jp",
  "bangers",
  "anton",
  "patrick-hand",
  "gaegu",
  "nanum-pen",
] as const;
export type FontFamilyId = (typeof FONT_FAMILY_IDS)[number];

/** Allowed horizontal text alignments. */
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Fixed body font size bounds, in px. */
export const FONT_SIZE_MIN_PX = 6;
export const FONT_SIZE_MAX_PX = 200;
/** Line-height multiple bounds. */
export const LINE_HEIGHT_MIN = 0.8;
export const LINE_HEIGHT_MAX = 2.5;
/** Letter-spacing bounds, in em. */
export const LETTER_SPACING_MIN_EM = -0.1;
export const LETTER_SPACING_MAX_EM = 0.5;
/** Bubble corner-radius bounds, in px. */
export const CORNER_RADIUS_MIN_PX = 0;
export const CORNER_RADIUS_MAX_PX = 200;

/**
 * The editor's starting values for the additive style fields — what the #55
 * controls pre-fill when a user first opens them. This is NOT how the renderer
 * fills an absent field: `@toony/render` leaves on-disk overlays sparse and, for
 * `fontWeight`/`textColor`/`cornerRadius`, falls back to the PER-KIND render
 * style (so shout/sfx stay weight 700 and legacy text keeps its per-kind color —
 * that per-kind fallback, not these constants, is what preserves pixel
 * consistency). The flat values here (`lineHeight` 1.2, `textAlign` "center",
 * `letterSpacing` 0, `zIndex` 0, `fontSize` null → auto-fit) happen to match the
 * renderer's current behavior. `cornerRadius` is omitted because it has no single
 * starting value (it is per-kind). NB for #55: persist a field only when the user
 * actually changes it — pre-filling and saving e.g. `textColor: "#111111"` would
 * bake a color onto a bubble that never had one.
 */
export const LETTERING_STYLE_DEFAULTS = {
  fontSize: null,
  fontWeight: 400,
  lineHeight: 1.2,
  textAlign: "center",
  letterSpacing: 0,
  textColor: "#111111",
  zIndex: 0,
} as const;

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
  /**
   * Emotional tone (#93), one of `BUBBLE_TONES`. Refines the outline shape;
   * absent → `"neutral"` (the kind's default outline). Back-compatible.
   */
  tone?: BubbleTone;
  /**
   * Off-panel speaker target for the tail (#93), a point in the SAME cut-image
   * 0..1 space as `geometry`. UNLIKE `tail`, it MAY lie outside [0,1] (the
   * speaker is off-panel); the renderer clamps the drawn tail tip to the art
   * edge. `null`/absent → the tail uses `tail` (current behavior).
   */
  tailTarget?: NormalizedPoint | null;
  // Additive pro-lettering style overrides (#54, #56). All OPTIONAL and back-
  // compatible: absent fields fall back to the renderer's current behavior. See
  // the bounds/defaults constants above.
  /**
   * Curated lettering font family id (#56), one of `FONT_FAMILY_IDS`. Absent →
   * the renderer/export resolve the per-kind default family from `@toony/fonts`,
   * so projects written before this field existed render with a sensible face.
   * The SAME resolved family renders in the studio SVG and the export canvas.
   */
  fontFamily?: FontFamilyId;
  /** Fixed body font size in px (6–200); null or absent → renderer auto-fit. */
  fontSize?: number | null;
  /** Body font weight; absent → per-kind default (700 for shout/sfx). */
  fontWeight?: FontWeight;
  /** Line advance as a multiple of font size (0.8–2.5); absent → 1.2. */
  lineHeight?: number;
  /** Horizontal text alignment; absent → "center". */
  textAlign?: TextAlign;
  /** Letter spacing in em (-0.1–0.5); absent → 0. */
  letterSpacing?: number;
  /** Body text color (CSS color); absent → per-kind default. */
  textColor?: string;
  /** Bubble corner radius in px (0–200); absent → per-kind default. */
  cornerRadius?: number;
  /** Stacking order among overlapping overlays (integer ≥ 0); absent → 0. */
  zIndex?: number;
}

/**
 * Project-relative image asset paths for a cut. Populated by the asset
 * ingestion/generation workflow (#14); null until an asset is associated.
 */
export interface ImageAssetRef {
  clean: string | null;
  final: string | null;
}

/**
 * A cut record. Image assets are referenced project-relative, never absolute.
 *
 * `imagePrompt` is the positive generation prompt for the cut's artwork and
 * `negativePrompt` is the exclusion prompt; both are author-authored text that
 * downstream generation (#36's `toony generate`) defaults from. They are always
 * present in the in-memory model (defaulting to "" when absent on disk), so
 * consumers never branch on undefined. Older projects written before these
 * fields existed remain valid: see `validateCutValue`, which treats a missing
 * prompt as the empty string for back-compatibility.
 */
export interface Cut {
  id: string;
  image: ImageAssetRef | null;
  imagePrompt: string;
  negativePrompt: string;
  /**
   * Ids of the project characters (#92) present in this cut. OPTIONAL and
   * back-compatible: projects written before the character registry omit it.
   * `toony generate` injects the referenced characters' lockstrings verbatim
   * into the cut's prompt; an unknown id is flagged by lint, not the schema.
   */
  characters?: string[];
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

/**
 * A reusable character in the project's registry (#92). The `lockstring` is a
 * short FIXED phrase — a locked palette + 2–3 invariant shape cues + style (per
 * `docs/TOONY-WEBTOON-CRAFT.md` §1) — injected VERBATIM into the image prompt of
 * every cut the character appears in, so the character stays on-model across cuts.
 */
export interface Character {
  id: string;
  name: string;
  lockstring: string;
}

/** The `webtoon.json` project root. */
export interface Webtoon {
  schemaVersion: number;
  projectId: string;
  title: string;
  languages: LanguageConfig;
  imageProviders: ImageProvidersConfig;
  /**
   * Project character registry (#92). OPTIONAL and back-compatible: projects
   * written before it existed simply omit it (treated as no characters).
   */
  characters?: Character[];
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
