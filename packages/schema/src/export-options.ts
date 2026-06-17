// Shared bounds + validation for export render options (#87).
//
// The `toony export` CLI and the Studio `/api/export` route both accept a
// `--width`/`--quality` (or JSON `width`/`quality`) and must reject the same
// out-of-range values with the same message. Those bounds and the integer-range
// check were previously hardcoded in BOTH callers, so they could silently
// diverge. This module is the single source of truth for the bounds and the
// check; both callers import it. It deliberately lives in `@toony/schema` (the
// validation package both already depend on) rather than the export engine, so
// the option *bounds* live next to the rest of the project's validation rules.

/** Inclusive pixel-width bounds an export render width must fall within. */
export const EXPORT_WIDTH_MIN = 1;
export const EXPORT_WIDTH_MAX = 100_000;

/** Inclusive lossy-quality bounds (0..100) an export quality must fall within. */
export const EXPORT_QUALITY_MIN = 0;
export const EXPORT_QUALITY_MAX = 100;

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
