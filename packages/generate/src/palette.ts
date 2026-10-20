// Palette-to-words for the generate prompt (#207).
//
// A cut declares `palette` as a CSS colour and the prompt is the only lever the
// image provider has, so the colour has to become WORDS before it can influence
// anything: diffusion models do not read hex. This module is the whole mapping.
// It is pure and table-driven, so one palette always yields one phrase and the
// composed clause can be asserted without a live provider.

/** Red, green, blue, each 0..255. */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa`. Alpha is accepted and
 * dropped: it says nothing about the hue or the value a palette names. Anything
 * else, including CSS named colours and `rgb()` notation, returns null.
 */
function parseHexColor(value: string): Rgb | null {
  const hex = value.toLowerCase();
  if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) return null;
  const digits = hex.slice(1);
  const short = digits.length <= 4;
  const channel = (index: number): number => {
    const raw = short
      ? digits.slice(index, index + 1).repeat(2)
      : digits.slice(index * 2, index * 2 + 2);
    return Number.parseInt(raw, 16);
  };
  return { r: channel(0), g: channel(1), b: channel(2) };
}

/**
 * Rec. 709 luminance, 0..255. `@toony/export` grades a rendered page's
 * `valueMean` with these same coefficients, and they are repeated here rather
 * than shared for the reason stated there: each consumer names the coefficients
 * it grades against. The two must agree, or the value word a palette asks for
 * would mean something different from the metric the pack is graded on.
 */
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Hue in degrees (0..360) and HSL saturation (0..1). */
function hueAndSaturation({ r, g, b }: Rgb): { hue: number; saturation: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  // Pure greys have no hue to name, and both HSL denominators below collapse to
  // zero at pure black and pure white, which this also covers.
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = max + min <= 255 ? delta / (max + min) : delta / (510 - max - min);
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return { hue: hue < 0 ? hue + 360 : hue, saturation };
}

/** Exclusive upper bound of each luminance band, 0..255, and the word for it. */
const VALUE_WORDS: readonly (readonly [number, string])[] = [
  [48, "very dark"],
  [96, "dark"],
  [160, "mid-tone"],
  [208, "light"],
  [Number.POSITIVE_INFINITY, "very light"],
];

/**
 * Exclusive upper bound of each saturation band and the word for it. The empty
 * word is the ordinary middle: a plainly coloured palette reads better as "dark
 * blue" than as "dark moderately saturated blue".
 */
const SATURATION_WORDS: readonly (readonly [number, string])[] = [
  [0.4, "desaturated"],
  [0.7, ""],
  [Number.POSITIVE_INFINITY, "vivid"],
];

/** Below this HSL saturation the hue is noise, so the phrase names grey instead. */
const NEUTRAL_SATURATION = 0.12;
const NEUTRAL_WORD = "neutral grey";

/**
 * Twelve 30-degree hue sectors, indexed by `round(hue / 30) % 12`. The compound
 * names keep the plain colour word in the phrase for a model that does not know
 * the specific one, and avoid a name whose everyday sense fights the value word
 * ("sky blue" reads bright, and pairs with "very dark").
 */
const HUE_NAMES = [
  "red",
  "orange",
  "yellow",
  "yellow-green",
  "green",
  "sea green",
  "teal",
  "azure blue",
  "blue",
  "violet",
  "magenta",
  "pink",
] as const;

function bandWord(bands: readonly (readonly [number, string])[], value: number): string {
  // The last band's bound is infinite, so the fallback is unreachable.
  return bands.find(([bound]) => value < bound)?.[1] ?? "";
}

/**
 * Turn a cut's `palette` into a prompt clause, or null when it contributes
 * nothing. A hex colour becomes a deterministic phrase.
 *
 * Any other non-empty string is used VERBATIM, the way a character lockstring
 * is (#92). The schema validates `palette` only as a non-empty string, so
 * "muted teal" is as legitimate an authored value as "#1d2130", and dropping it
 * would leave the field unread all over again.
 */
export function describePalette(palette: string): string | null {
  const trimmed = palette.trim();
  if (trimmed.length === 0) return null;
  const rgb = parseHexColor(trimmed);
  if (rgb === null) return trimmed;
  const value = bandWord(VALUE_WORDS, luminance(rgb));
  const { hue, saturation } = hueAndSaturation(rgb);
  const words =
    saturation < NEUTRAL_SATURATION
      ? [value, NEUTRAL_WORD]
      : [value, bandWord(SATURATION_WORDS, saturation), HUE_NAMES[Math.round(hue / 30) % 12] ?? ""];
  return `${words.filter((word) => word.length > 0).join(" ")} color palette`;
}

/**
 * Append the cut's palette clause to an already-composed prompt (#207). It goes
 * LAST, after the lockstrings that are prepended (#92), so it qualifies the
 * whole scene instead of reading as part of one character's description. An
 * absent or blank palette leaves the prompt unchanged, byte for byte.
 */
export function appendPaletteClause(basePrompt: string, palette: string | undefined): string {
  if (palette === undefined) return basePrompt;
  const clause = describePalette(palette);
  if (clause === null) return basePrompt;
  return `${basePrompt}, ${clause}`;
}
