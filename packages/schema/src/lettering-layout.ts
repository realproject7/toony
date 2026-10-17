import { type IssueCollector, joinPath } from "./errors.js";
import { EXPORT_WIDTH_MAX, EXPORT_WIDTH_MIN } from "./export-options.js";
import { isFiniteNumber, isInteger, isPlainObject } from "./guards.js";
import { resolveReferenceWidth } from "./presets.js";
import { FONT_SIZE_MAX_PX, FONT_SIZE_MIN_PX } from "./types.js";

/** Explicit typography units and text frame, independent of the cut's height. */
export interface LetteringTextLayout {
  version: 1;
  /** Font sizes are pixels at this reference artwork width. */
  referenceWidth: number;
  /** Padding on each side as fractions of the bubble body width/height. */
  paddingX: number;
  paddingY: number;
  /** Auto-fit bounds in the same reference units as an explicit fontSize. */
  minFontSize: number;
  maxFontSize: number;
}

export function defaultLetteringTextLayout(
  referenceWidth = resolveReferenceWidth(undefined),
): LetteringTextLayout {
  return {
    version: 1,
    referenceWidth,
    paddingX: 0.08,
    paddingY: 0.12,
    minFontSize: 20,
    maxFontSize: 30,
  };
}

export function validateLetteringTextLayout(value: unknown, path: string, c: IssueCollector): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    c.add(path, "style.text-layout", "textLayout must be a versioned layout object.");
    return;
  }
  const keys = new Set([
    "version",
    "referenceWidth",
    "paddingX",
    "paddingY",
    "minFontSize",
    "maxFontSize",
  ]);
  for (const key of Object.keys(value)) {
    if (!keys.has(key))
      c.add(joinPath(path, key), "style.text-layout-key", "unsupported text layout field.");
  }
  if (value.version !== 1)
    c.add(joinPath(path, "version"), "style.text-layout-version", "textLayout version must be 1.");
  if (
    !isInteger(value.referenceWidth) ||
    value.referenceWidth < EXPORT_WIDTH_MIN ||
    value.referenceWidth > EXPORT_WIDTH_MAX
  ) {
    c.add(
      joinPath(path, "referenceWidth"),
      "style.text-layout-width",
      `referenceWidth must be an integer in ${EXPORT_WIDTH_MIN}..${EXPORT_WIDTH_MAX}.`,
    );
  }
  for (const key of ["paddingX", "paddingY"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] < 0 || value[key] > 0.45) {
      c.add(
        joinPath(path, key),
        "style.text-layout-padding",
        "text padding must be a fraction in 0..0.45.",
      );
    }
  }
  for (const key of ["minFontSize", "maxFontSize"] as const) {
    if (
      !isFiniteNumber(value[key]) ||
      value[key] < FONT_SIZE_MIN_PX ||
      value[key] > FONT_SIZE_MAX_PX
    ) {
      c.add(
        joinPath(path, key),
        "style.text-layout-size",
        `fit size must be in ${FONT_SIZE_MIN_PX}..${FONT_SIZE_MAX_PX} reference pixels.`,
      );
    }
  }
  if (
    isFiniteNumber(value.minFontSize) &&
    isFiniteNumber(value.maxFontSize) &&
    value.minFontSize > value.maxFontSize
  ) {
    c.add(path, "style.text-layout-range", "minimum fit size must not exceed maximum fit size.");
  }
}
