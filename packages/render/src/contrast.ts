// sRGB color math for the render core's own legibility decisions.
//
// `layoutCut` never receives pixels — only overlays and dimensions — so it can
// never look at the artwork under a caption. What it CAN do is reason about the
// surface it draws itself. The caption plate (#186) uses the arithmetic here to
// prove that a plate makes its ink legible over the WORST background the artwork
// could possibly be, instead of trusting a hand-picked constant.
//
// Pure and framework-agnostic like the rest of @toony/render, and the only place
// these formulas live, so the studio preview and the export raster can never
// disagree about what "legible" means.

/** An opaque color, 0..255 per channel. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A color with an alpha channel, 0..1. */
export interface Rgba extends Rgb {
  a: number;
}

/** Pure black — the darkest artwork a caption can ever land on. */
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
/** Pure white — the lightest artwork a caption can ever land on. */
export const WHITE: Rgb = { r: 255, g: 255, b: 255 };

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN =
  /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)$/i;

function byte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Parse the CSS color forms Toony actually stores — `#rgb`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()` and `rgba()` — into channels plus alpha. Returns null for
 * anything else (a named color, a gradient, a paint server): a color the core
 * cannot measure is a color it must not make promises about.
 */
export function parseCssColor(color: string): Rgba | null {
  const value = color.trim();
  const m3 = HEX3.exec(value);
  if (m3) {
    return {
      r: Number.parseInt(`${m3[1]}${m3[1]}`, 16),
      g: Number.parseInt(`${m3[2]}${m3[2]}`, 16),
      b: Number.parseInt(`${m3[3]}${m3[3]}`, 16),
      a: 1,
    };
  }
  const m8 = HEX8.exec(value);
  if (m8) {
    return {
      r: Number.parseInt(m8[1] as string, 16),
      g: Number.parseInt(m8[2] as string, 16),
      b: Number.parseInt(m8[3] as string, 16),
      a: Number.parseInt(m8[4] as string, 16) / 255,
    };
  }
  const m6 = HEX6.exec(value);
  if (m6) {
    return {
      r: Number.parseInt(m6[1] as string, 16),
      g: Number.parseInt(m6[2] as string, 16),
      b: Number.parseInt(m6[3] as string, 16),
      a: 1,
    };
  }
  const fn = RGB_FN.exec(value);
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : Number.parseFloat(fn[4]);
    if (!Number.isFinite(alpha)) return null;
    return {
      r: byte(Number.parseFloat(fn[1] as string)),
      g: byte(Number.parseFloat(fn[2] as string)),
      b: byte(Number.parseFloat(fn[3] as string)),
      a: Math.max(0, Math.min(1, alpha)),
    };
  }
  return null;
}

/** `#rrggbb` for an opaque color, so the drawn plate carries no second alpha. */
export function toHex(color: Rgb): string {
  const hex = (c: number) => byte(c).toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/** WCAG 2.x sRGB relative luminance. */
export function relativeLuminance(color: Rgb): number {
  const channel = (raw: number): number => {
    const c = byte(raw) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2.x contrast ratio between two opaque colors (1..21, order-independent). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Source-over compositing of a translucent color onto an opaque background —
 * the identical model an SVG `fill` + `fill-opacity` and a canvas `fillStyle` +
 * `globalAlpha` both apply, so what this predicts is what both consumers draw.
 */
export function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, fg.a));
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}
