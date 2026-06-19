// v4 interstitial-panel presets (#117) — shared, headless typed constants.
//
// The "gutter-as-clock" spacing ladder, panel-height presets, and the mood-color
// script from docs/TOONY-INTERSTITIAL-CRAFT.md (§1/§2/§5). These are the SINGLE
// source the v4 transition schema/render/export (#115), craft lints (#116),
// transition editor (#119), and the agent/CLI all consume — no consumer should
// hardcode its own copy (the parity discipline from #112). Pure data + small
// typed helpers; no UI, no rendering here.

/**
 * Standard canvas width (px) the presets are calibrated against (§1). A reader
 * scrolls a ~800px-wide canvas at ~800px/sec, so vertical pixels map to seconds.
 */
export const STANDARD_CANVAS_WIDTH_PX = 800;

/**
 * A single no-art panel taller than this (px) gets sliced across the mobile fold
 * (~1200–1280px per screen), so it can't read as one beat. #116's panel-slice
 * lint warns above this; the editor/agent can auto-note it (§1/§5).
 */
export const PANEL_FOLD_SLICE_PX = 1200;

// --- Clock-ladder spacing presets (§1/§5) -----------------------------------
// Empty vertical space IS time: each preset is how long a no-art gap "reads"
// at the standard scroll speed. Px on the standard canvas; authors may override.

/** Spacing preset names, ordered from shortest (continuous) to longest (time skip). */
export const SPACING_PRESET_NAMES = ["tight", "beat", "cut", "pause", "timeskip"] as const;
export type SpacingPreset = (typeof SPACING_PRESET_NAMES)[number];

/** Clock-ladder spacing presets in px: tight=120 · beat=250 · cut=500 · pause=700 · timeskip=1600. */
export const SPACING_PRESETS: Record<SpacingPreset, number> = {
  tight: 120,
  beat: 250,
  cut: 500,
  pause: 700,
  timeskip: 1600,
};

// --- Panel-height presets (§5) ----------------------------------------------

/** Panel-height preset names, ordered smallest → largest. */
export const PANEL_HEIGHT_PRESET_NAMES = ["S", "M", "L", "Impact"] as const;
export type PanelHeightPreset = (typeof PANEL_HEIGHT_PRESET_NAMES)[number];

/** Panel-height presets in px: S=400 · M=800 · L=1600 · Impact=2000. */
export const PANEL_HEIGHT_PRESETS: Record<PanelHeightPreset, number> = {
  S: 400,
  M: 800,
  L: 1600,
  Impact: 2000,
};

// --- Mood-color presets (§2) ------------------------------------------------
// A per-scene mood-color SCRIPT (named swatch → emotion), not per-panel decor.
// Hex values follow the color→emotion coding in §2.

/** Mood-color preset names (named swatch → emotion). */
export const MOOD_COLOR_NAMES = [
  "anger-red",
  "calm-blue",
  "melancholy-desat",
  "joy-vivid",
  "dread-black",
  "shock-white",
] as const;
export type MoodColor = (typeof MOOD_COLOR_NAMES)[number];

/**
 * Mood-color preset hex values (§2): red = rage/danger; cool blue = sadness/
 * calm/night; desaturated = numbness/memory; vivid = intensity/joy; near-black =
 * dread/void; white = emptiness/shock. All `#rrggbb`.
 */
export const MOOD_COLORS: Record<MoodColor, string> = {
  "anger-red": "#c62828",
  "calm-blue": "#3f6fa3",
  "melancholy-desat": "#8a8f98",
  "joy-vivid": "#f5a623",
  "dread-black": "#0a0a0a",
  "shock-white": "#ffffff",
};

// --- Typed helpers ----------------------------------------------------------

/** Narrow an arbitrary value to a spacing-preset name. */
export function isSpacingPreset(value: unknown): value is SpacingPreset {
  return typeof value === "string" && (SPACING_PRESET_NAMES as readonly string[]).includes(value);
}

/** Narrow an arbitrary value to a panel-height-preset name. */
export function isPanelHeightPreset(value: unknown): value is PanelHeightPreset {
  return (
    typeof value === "string" && (PANEL_HEIGHT_PRESET_NAMES as readonly string[]).includes(value)
  );
}

/** Narrow an arbitrary value to a mood-color name. */
export function isMoodColor(value: unknown): value is MoodColor {
  return typeof value === "string" && (MOOD_COLOR_NAMES as readonly string[]).includes(value);
}

/** Resolve a spacing preset to its px height. */
export function spacingPx(preset: SpacingPreset): number {
  return SPACING_PRESETS[preset];
}

/** Resolve a panel-height preset to its px height. */
export function panelHeightPx(preset: PanelHeightPreset): number {
  return PANEL_HEIGHT_PRESETS[preset];
}

/** Resolve a mood-color name to its hex value. */
export function moodColorHex(name: MoodColor): string {
  return MOOD_COLORS[name];
}
