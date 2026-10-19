// A lettering theme (#334): the per-kind bubble defaults a pack ships, so a
// genre's look includes how its lines are lettered, not only how its page is
// paced. It is DATA a pack contributes and a project selects by id in
// `webtoon.json`. It is applied where an overlay is created (a new bubble in
// Studio, a compiled draft) and where a person asks for it on an existing one;
// rendering and export read the overlay as they always did, so a project that
// selects no theme is unchanged to the byte.

import type { IssueCollector, ValidationResult } from "./errors.js";
import { IssueCollector as Collector, joinPath } from "./errors.js";
import { isFiniteNumber, isNonEmptyString, isOneOf, isPlainObject } from "./guards.js";
import {
  BALLOON_SHAPES,
  type BalloonShape,
  BUBBLE_KINDS,
  type BubbleBorder,
  type BubbleKind,
  CORNER_RADIUS_MAX_PX,
  CORNER_RADIUS_MIN_PX,
  FONT_FAMILY_IDS,
  FONT_WEIGHTS,
  type FontFamilyId,
  type FontWeight,
  type LetteringOverlay,
  SFX_MODES,
  type SfxMode,
} from "./types.js";

/** The format version a theme file must declare. */
export const LETTERING_THEME_FORMAT_VERSION = 1;

/** The defaults a theme states for one bubble kind. Every field is optional. */
export interface LetteringThemeKind {
  balloonShape?: BalloonShape;
  fontFamily?: FontFamilyId;
  fontWeight?: FontWeight;
  /** Bubble fill, a CSS colour. */
  fill?: string;
  /** Body text colour, a CSS colour. */
  textColor?: string;
  /** Border, or null for none. */
  border?: BubbleBorder | null;
  cornerRadius?: number;
  /** Fill opacity, 0 to 1. */
  opacity?: number;
}

export interface LetteringTheme {
  themeFormat: number;
  name?: string;
  /** Per-kind defaults. A kind the theme does not state keeps the renderer's own. */
  kinds: Partial<Record<BubbleKind, LetteringThemeKind>>;
  /** How SFX letter by default under this theme. */
  sfxMode?: SfxMode;
}

const THEME_KEYS = ["themeFormat", "name", "kinds", "sfxMode"] as const;
const KIND_KEYS = [
  "balloonShape",
  "fontFamily",
  "fontWeight",
  "fill",
  "textColor",
  "border",
  "cornerRadius",
  "opacity",
] as const;

function allowlist(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  c: IssueCollector,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      c.add(joinPath(path, key), "theme.unknown-key", `unknown key: ${key}`);
  }
}

function validateKind(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "theme.kind", "a kind's defaults must be an object.");
    return;
  }
  allowlist(value, KIND_KEYS, path, c);
  if (value.balloonShape !== undefined && !isOneOf(value.balloonShape, BALLOON_SHAPES)) {
    c.add(joinPath(path, "balloonShape"), "theme.balloon-shape", "Unknown balloon shape.");
  }
  if (value.fontFamily !== undefined && !isOneOf(value.fontFamily, FONT_FAMILY_IDS)) {
    c.add(
      joinPath(path, "fontFamily"),
      "theme.font-family",
      `fontFamily must be one of: ${FONT_FAMILY_IDS.join(", ")}.`,
    );
  }
  if (value.fontWeight !== undefined && !FONT_WEIGHTS.includes(value.fontWeight as FontWeight)) {
    c.add(
      joinPath(path, "fontWeight"),
      "theme.font-weight",
      `fontWeight must be one of: ${FONT_WEIGHTS.join(", ")}.`,
    );
  }
  for (const key of ["fill", "textColor"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      c.add(joinPath(path, key), "theme.color", `${key} must be a non-empty colour string.`);
    }
  }
  if (value.border !== undefined && value.border !== null) {
    const border = value.border;
    if (
      !isPlainObject(border) ||
      !isFiniteNumber(border.width) ||
      border.width < 0 ||
      !isNonEmptyString(border.color)
    ) {
      c.add(
        joinPath(path, "border"),
        "theme.border",
        "border must be { width >= 0, color } or null.",
      );
    } else {
      allowlist(border, ["width", "color"], joinPath(path, "border"), c);
    }
  }
  if (
    value.cornerRadius !== undefined &&
    (!isFiniteNumber(value.cornerRadius) ||
      value.cornerRadius < CORNER_RADIUS_MIN_PX ||
      value.cornerRadius > CORNER_RADIUS_MAX_PX)
  ) {
    c.add(
      joinPath(path, "cornerRadius"),
      "theme.corner-radius",
      `cornerRadius must be a number between ${CORNER_RADIUS_MIN_PX} and ${CORNER_RADIUS_MAX_PX}.`,
    );
  }
  if (
    value.opacity !== undefined &&
    (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)
  ) {
    c.add(joinPath(path, "opacity"), "theme.opacity", "opacity must be a number between 0 and 1.");
  }
}

/** Validate an untrusted value as a lettering theme file. */
export function validateLetteringThemeValue(value: unknown): ValidationResult {
  const c = new Collector();
  const path = "theme";
  if (!isPlainObject(value)) {
    c.add(path, "theme.type", "a lettering theme must be an object.");
    return c.result();
  }
  allowlist(value, THEME_KEYS, path, c);
  if (value.themeFormat !== LETTERING_THEME_FORMAT_VERSION) {
    c.add(
      joinPath(path, "themeFormat"),
      "theme.format",
      `themeFormat must be ${LETTERING_THEME_FORMAT_VERSION}.`,
    );
  }
  if (value.name !== undefined && !isNonEmptyString(value.name)) {
    c.add(joinPath(path, "name"), "theme.name", "name must be a non-empty string.");
  }
  if (value.sfxMode !== undefined && !isOneOf(value.sfxMode, SFX_MODES)) {
    c.add(
      joinPath(path, "sfxMode"),
      "theme.sfx-mode",
      `sfxMode must be one of: ${SFX_MODES.join(", ")}.`,
    );
  }
  if (!isPlainObject(value.kinds)) {
    c.add(joinPath(path, "kinds"), "theme.kinds", "kinds must be an object keyed by bubble kind.");
    return c.result();
  }
  for (const [kind, defaults] of Object.entries(value.kinds)) {
    const kindPath = joinPath(joinPath(path, "kinds"), kind);
    if (!isOneOf(kind, BUBBLE_KINDS)) {
      c.add(
        kindPath,
        "theme.unknown-kind",
        `unknown bubble kind "${kind}"; one of: ${BUBBLE_KINDS.join(", ")}.`,
      );
      continue;
    }
    validateKind(defaults, kindPath, c);
  }
  return c.result();
}

/** Narrow a value that already passed `validateLetteringThemeValue`. */
export function asLetteringTheme(value: Record<string, unknown>): LetteringTheme {
  return value as unknown as LetteringTheme;
}

/**
 * Apply a theme to one overlay: every field the theme states for the overlay's
 * kind is written, and nothing else moves. Used for a new overlay and for an
 * explicit "apply theme" on an existing one; a theme is never applied on read,
 * so an overlay saved without one renders exactly as it did.
 */
export function applyLetteringTheme(
  overlay: LetteringOverlay,
  theme: LetteringTheme,
): LetteringOverlay {
  const defaults = theme.kinds[overlay.kind];
  const next: LetteringOverlay = { ...overlay };
  if (defaults !== undefined) {
    if (defaults.fontFamily !== undefined) next.fontFamily = defaults.fontFamily;
    if (defaults.fontWeight !== undefined) next.fontWeight = defaults.fontWeight;
    if (defaults.fill !== undefined) next.fill = defaults.fill;
    if (defaults.textColor !== undefined) next.textColor = defaults.textColor;
    if (defaults.border !== undefined)
      next.border = defaults.border === null ? null : { ...defaults.border };
    if (defaults.cornerRadius !== undefined) next.cornerRadius = defaults.cornerRadius;
    if (defaults.balloonShape !== undefined) next.balloonShape = defaults.balloonShape;
    if (defaults.opacity !== undefined) next.opacity = defaults.opacity;
  }
  if (overlay.kind === "sfx" && theme.sfxMode !== undefined) next.sfxMode = theme.sfxMode;
  return next;
}
