// Shared bounds + validation for export render options (#87).
//
// The `toony export` CLI, the Studio export route and pack export presets all
// accept the same options and must reject the same out-of-range values with the
// same message. This module is the single source of truth for the export
// vocabulary, the option bounds and their checks. It deliberately lives in
// `@toony/schema` (the validation package every caller already depends on)
// rather than the Node/canvas export engine.

/**
 * The export engines. `strip` is the episode as one tall image (optionally
 * split into parts), `cuts` is one image per cut, and `social` lays the episode
 * out on fixed-size frames for social posts. A preset selects one of these; it
 * can never add one.
 */
export const EXPORT_TARGET_KINDS = ["strip", "cuts", "social"] as const;
export type ExportTargetKind = (typeof EXPORT_TARGET_KINDS)[number];

/** Earlier engine names that still select an engine wherever options are parsed. */
export const EXPORT_TARGET_ALIASES = {
  stitched: "strip",
  platform: "cuts",
} as const satisfies Record<string, ExportTargetKind>;
export type ExportTargetAlias = keyof typeof EXPORT_TARGET_ALIASES;
/** An engine name as authored: a current kind or an accepted alias. */
export type ExportTargetName = ExportTargetKind | ExportTargetAlias;

/** Resolve an authored engine name (kind or alias) to its kind, or null. */
export function resolveExportKind(name: unknown): ExportTargetKind | null {
  if (typeof name !== "string") return null;
  if ((EXPORT_TARGET_KINDS as readonly string[]).includes(name)) return name as ExportTargetKind;
  if (Object.hasOwn(EXPORT_TARGET_ALIASES, name)) {
    return EXPORT_TARGET_ALIASES[name as ExportTargetAlias];
  }
  return null;
}

/**
 * Export folders earlier Toony versions wrote under `episodes/<id>/exports/`.
 * They stay on disk untouched; nothing reads them and no output may use them.
 */
export const EXPORT_LEGACY_FOLDERS = ["platform", "stitched", "plotlink"] as const;

/** Fixed frames the social engine lays an episode out on. */
export const SOCIAL_FRAME_IDS = ["instagram-portrait", "instagram-square", "x-landscape"] as const;
export type SocialFrameId = (typeof SOCIAL_FRAME_IDS)[number];

/** What the social engine does with a cut taller than its frame. */
export const TALL_CUT_MODES = ["split", "fit"] as const;
export type TallCutMode = (typeof TALL_CUT_MODES)[number];

/** Raster formats an export can write. */
export const EXPORT_FORMATS = ["png", "jpeg"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Inclusive pixel-width bounds an export render width must fall within. */
export const EXPORT_WIDTH_MIN = 1;
export const EXPORT_WIDTH_MAX = 100_000;

/** Inclusive lossy-quality bounds (0..100) an export quality must fall within. */
export const EXPORT_QUALITY_MIN = 0;
export const EXPORT_QUALITY_MAX = 100;

/** Inclusive bounds for the height a strip is split at. */
export const EXPORT_SLICE_HEIGHT_MIN = 64;
export const EXPORT_SLICE_HEIGHT_MAX = 100_000;

/** Inclusive bounds for an optional per-file byte cap on strip parts. */
export const EXPORT_MAX_BYTES_MIN = 10_000;
export const EXPORT_MAX_BYTES_MAX = 1_000_000_000;

/** Inclusive bounds for the margin around each cut image, in px. */
export const EXPORT_MARGIN_MIN = 0;
export const EXPORT_MARGIN_MAX = 10_000;

/**
 * Every export option, as the CLI, the Studio route and pack presets spell it.
 * An omitted option keeps the engine's default.
 */
export interface ExportOptionValues {
  /** Final image width in px (strip and cuts). */
  width?: number;
  format?: ExportFormat;
  /** Lossy quality 0..100 (JPEG only). */
  quality?: number;
  /** Strip: split into parts no taller than this, breaking between whole cuts. */
  sliceHeight?: number;
  /** Strip parts: optional byte cap per file, met without lowering quality or width. */
  maxBytes?: number;
  /** Cuts: px of background on every side of each cut image. */
  margin?: number;
  /** Cuts: also write text-card transitions as their own images. */
  textCards?: boolean;
  /** Social: the frame to lay the episode out on. */
  frame?: SocialFrameId;
  /** Social: split a too-tall cut into rows, or fit it whole when it stays legible. */
  tallCuts?: TallCutMode;
}

/** Option keys in a stable order (pack allowlists and error messages read this). */
export const EXPORT_OPTION_KEYS = [
  "width",
  "format",
  "quality",
  "sliceHeight",
  "maxBytes",
  "margin",
  "textCards",
  "frame",
  "tallCuts",
] as const satisfies readonly (keyof ExportOptionValues)[];

/**
 * Validate an optional integer export option against an inclusive range. Returns
 * an error string when `value` is provided and is not an integer within
 * `[min, max]`, or `null` when it is absent or valid. The message is stable so
 * the CLI and the Studio route surface identical wording.
 */
export function validateExportInt(
  value: number | undefined,
  name: string,
  min: number,
  max: number,
): string | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    return `${name} must be an integer between ${min} and ${max}`;
  }
  return null;
}

/** Validate an optional export width against the shared bounds. */
export function validateExportWidth(value: number | undefined, name = "width"): string | null {
  return validateExportInt(value, name, EXPORT_WIDTH_MIN, EXPORT_WIDTH_MAX);
}

/** Validate an optional export quality against the shared bounds. */
export function validateExportQuality(value: number | undefined, name = "quality"): string | null {
  return validateExportInt(value, name, EXPORT_QUALITY_MIN, EXPORT_QUALITY_MAX);
}

/** Validate an optional strip slice height against the shared bounds. */
export function validateExportSliceHeight(
  value: number | undefined,
  name = "sliceHeight",
): string | null {
  return validateExportInt(value, name, EXPORT_SLICE_HEIGHT_MIN, EXPORT_SLICE_HEIGHT_MAX);
}

/** Validate an optional per-file byte cap against the shared bounds. */
export function validateExportMaxBytes(
  value: number | undefined,
  name = "maxBytes",
): string | null {
  return validateExportInt(value, name, EXPORT_MAX_BYTES_MIN, EXPORT_MAX_BYTES_MAX);
}

/** Validate an optional cut-image margin against the shared bounds. */
export function validateExportMargin(value: number | undefined, name = "margin"): string | null {
  return validateExportInt(value, name, EXPORT_MARGIN_MIN, EXPORT_MARGIN_MAX);
}

/** One problem found while parsing export options, keyed by the option name. */
export interface ExportOptionProblem {
  key: string;
  message: string;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Parse an export options object (JSON from the Studio route or a pack preset).
 * Unknown keys, wrong types and out-of-range values are problems; the parsed
 * options carry only the valid keys. `"jpg"` is accepted as a spelling of JPEG.
 */
export function parseExportOptions(value: unknown): {
  options: ExportOptionValues;
  problems: ExportOptionProblem[];
} {
  const options: ExportOptionValues = {};
  const problems: ExportOptionProblem[] = [];
  if (value === undefined || value === null) return { options, problems };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { options, problems: [{ key: "options", message: "options must be an object" }] };
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!(EXPORT_OPTION_KEYS as readonly string[]).includes(key)) {
      problems.push({
        key,
        message: `unknown export option "${key}"; use one of: ${EXPORT_OPTION_KEYS.join(", ")}`,
      });
    }
  }
  const integer = (
    key: "width" | "quality" | "sliceHeight" | "maxBytes" | "margin",
    check: (value: number | undefined, name: string) => string | null,
  ) => {
    const raw = source[key];
    if (raw === undefined) return;
    const error = typeof raw === "number" ? check(raw, key) : check(Number.NaN, key);
    if (error) problems.push({ key, message: error });
    else options[key] = raw as number;
  };
  integer("width", validateExportWidth);
  integer("quality", validateExportQuality);
  integer("sliceHeight", validateExportSliceHeight);
  integer("maxBytes", validateExportMaxBytes);
  integer("margin", validateExportMargin);
  if (source.format !== undefined) {
    const format = source.format === "jpg" ? "jpeg" : source.format;
    if (oneOf(format, EXPORT_FORMATS)) options.format = format;
    else problems.push({ key: "format", message: 'format must be "png" or "jpeg"' });
  }
  if (source.textCards !== undefined) {
    if (typeof source.textCards === "boolean") options.textCards = source.textCards;
    else problems.push({ key: "textCards", message: "textCards must be true or false" });
  }
  if (source.frame !== undefined) {
    if (oneOf(source.frame, SOCIAL_FRAME_IDS)) options.frame = source.frame;
    else {
      problems.push({
        key: "frame",
        message: `frame must be one of: ${SOCIAL_FRAME_IDS.join(", ")}`,
      });
    }
  }
  if (source.tallCuts !== undefined) {
    if (oneOf(source.tallCuts, TALL_CUT_MODES)) options.tallCuts = source.tallCuts;
    else problems.push({ key: "tallCuts", message: 'tallCuts must be "split" or "fit"' });
  }
  return { options, problems };
}
