// Composite cuts (image + lettering) and transition bands onto real rasters.
//
// Layout comes entirely from @toony/render (layoutCut/layoutTransition) so export
// matches the studio preview and never invents its own lettering/transition
// geometry. This module only turns those layout plans into pixels.

import {
  type Canvas,
  createCanvas,
  type Image,
  loadImage,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  type BalloonCommand,
  type BubbleRender,
  cutPlacementFrame,
  IMPACT_BURST_FILL,
  IMPACT_BURST_STROKE,
  IMPACT_RAY_COLOR,
  layoutCut,
  layoutTransition,
  type TransitionRender,
} from "@toony/render";
import type { LetteringOverlay, Transition } from "@toony/schema";
import { canvasFontFamily, registerToonyFonts } from "./fonts.js";
import { createCanvasMeasure } from "./measure.js";

// Band labels (transition cards/breaks) use a registered curated face so the
// stitched export never falls back to the host's default sans. Nunito is the
// clean dialogue face and ships both 400 and 700.
const BAND_FONT_REGULAR = canvasFontFamily("nunito", 400, "narration");
const BAND_FONT_BOLD = canvasFontFamily("nunito", 700, "narration");

/** Height/width ratio used for a cut that has no image asset yet. */
const FALLBACK_CUT_ASPECT = 1.4;

export interface ComposedCut {
  canvas: Canvas;
  width: number;
  height: number;
}

// @napi-rs/canvas@1.0.0's `new Image(); img.src = …` sets width/height but never
// decodes pixels, so a later drawImage paints nothing. The async loadImage()
// fully decodes the buffer, which is what drawImage actually needs.
async function decode(imageBytes: Uint8Array): Promise<Image> {
  return loadImage(Buffer.from(imageBytes));
}

function traceOutline(ctx: SKRSContext2D, outline: readonly BalloonCommand[]): void {
  ctx.beginPath();
  for (const cmd of outline) {
    if (cmd.k === "M") ctx.moveTo(cmd.x, cmd.y);
    else if (cmd.k === "L") ctx.lineTo(cmd.x, cmd.y);
    else ctx.arcTo(cmd.cornerX, cmd.cornerY, cmd.x, cmd.y, cmd.r);
  }
  ctx.closePath();
}

function drawBubble(ctx: SKRSContext2D, b: BubbleRender): void {
  if (b.hasBubble) {
    traceOutline(ctx, b.outline);
    ctx.globalAlpha = b.fillOpacity;
    ctx.fillStyle = b.fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (b.strokeWidth > 0) {
      ctx.lineWidth = b.strokeWidth;
      ctx.strokeStyle = b.stroke;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  // impact_band SFX (#99): radial speed-lines + a burst star behind the text,
  // traced from the render plan's pure straight segments so the raster matches the
  // studio SVG exactly. Drawn before the bare text so the lettering reads on top.
  if (b.impact) {
    ctx.strokeStyle = IMPACT_RAY_COLOR;
    ctx.lineWidth = b.impact.rayWidth;
    for (const ray of b.impact.rays) {
      ctx.beginPath();
      ctx.moveTo(ray.x1, ray.y1);
      ctx.lineTo(ray.x2, ray.y2);
      ctx.stroke();
    }
    ctx.beginPath();
    b.impact.burst.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = IMPACT_BURST_FILL;
    ctx.fill();
    ctx.lineWidth = b.impact.burstStrokeWidth;
    ctx.strokeStyle = IMPACT_BURST_STROKE;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // Use the SAME face the render plan resolved (#56): the per-weight registered
  // canvas family for the overlay's font family, so the raster matches the SVG.
  const fontWeight = b.fontWeight;
  const family = canvasFontFamily(b.fontFamily, fontWeight, b.kind);
  // Honor the render plan's resolved alignment (#54/#55): draw each line at its
  // `anchorX` with the matching canvas textAlign so the raster matches the SVG.
  ctx.textAlign = b.textAlign === "left" ? "left" : b.textAlign === "right" ? "right" : "center";
  ctx.textBaseline = "top";
  // Letter spacing is expressed in em by the plan; @napi-rs/canvas takes a CSS
  // length, so convert at the resolved font size. Reset afterward so the band
  // labels and the next bubble are unaffected.
  ctx.letterSpacing = `${b.letterSpacing * b.text.fontSize}px`;

  ctx.font = `${fontWeight} ${b.text.fontSize}px "${family}"`;
  for (const line of b.lines) {
    if (b.hasBubble) {
      ctx.fillStyle = b.textColor;
      ctx.fillText(line.text, line.anchorX, line.y);
    } else {
      // SFX: outline the bare text so it reads on any background. Width comes
      // from the render plan (single source) so the raster and the SVG preview
      // stroke it identically (#83).
      ctx.lineWidth = b.textOutlineWidth;
      ctx.strokeStyle = b.stroke;
      ctx.lineJoin = "round";
      ctx.strokeText(line.text, line.anchorX, line.y);
      ctx.fillStyle = b.textColor;
      ctx.fillText(line.text, line.anchorX, line.y);
    }
  }
  ctx.letterSpacing = "0px";
}

/**
 * Composite a cut at `targetWidth`: its image (scaled to width) with all its
 * lettering overlays drawn on top via the shared renderer. When the cut has no
 * image asset, a neutral background of the fallback aspect is used so reading
 * order and lettering still export.
 */
export async function composeCut(
  overlays: LetteringOverlay[],
  imageBytes: Uint8Array | null,
  targetWidth: number,
): Promise<ComposedCut> {
  const width = Math.max(1, Math.round(targetWidth));
  let height: number;
  let image: Image | null = null;
  if (imageBytes) {
    image = await decode(imageBytes);
    const natW = image.width > 0 ? image.width : width;
    const natH = image.height > 0 ? image.height : Math.round(width * FALLBACK_CUT_ASPECT);
    height = Math.max(1, Math.round((natH * width) / natW));
  } else {
    height = Math.max(1, Math.round(width * FALLBACK_CUT_ASPECT));
  }

  // Register the bundled curated faces before any text is measured or drawn so the
  // raster uses the SAME self-hosted faces as the studio preview (no CDN, no
  // host-default fallback). Idempotent across cuts.
  registerToonyFonts();

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // Reserve the gutter strip(s) (#98): the artwork fills only the `art` rect; the
  // band(s) are a neutral reading margin where gutter bubbles sit. No gutter
  // overlays → art == the whole canvas (full-bleed, byte-identical to before).
  const { art, bands } = cutPlacementFrame(overlays, width, height);
  if (bands.length > 0) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  if (image) {
    ctx.drawImage(image, art.x, art.y, art.width, art.height);
  } else {
    ctx.fillStyle = "#eceae6";
    ctx.fillRect(art.x, art.y, art.width, art.height);
  }

  const measure = createCanvasMeasure();
  for (const bubble of layoutCut(overlays, width, height, { measure })) {
    drawBubble(ctx, bubble);
  }
  return { canvas, width, height };
}

function drawBandText(
  ctx: SKRSContext2D,
  render: TransitionRender,
  width: number,
  height: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelSize = Math.max(10, Math.round(height * 0.22));
  const cx = width / 2;
  if (render.detail) {
    ctx.font = `700 ${labelSize}px "${BAND_FONT_BOLD}"`;
    ctx.fillText(render.detail, cx, height * 0.42);
    ctx.font = `400 ${Math.max(8, Math.round(labelSize * 0.6))}px "${BAND_FONT_REGULAR}"`;
    ctx.fillText(render.label, cx, height * 0.68);
  } else {
    ctx.font = `400 ${Math.max(8, Math.round(labelSize * 0.7))}px "${BAND_FONT_REGULAR}"`;
    ctx.fillText(render.label, cx, height / 2);
  }
}

/**
 * Compose a transition into a band of `targetWidth` × its gutter height. Card and
 * break treatments get a floor height so their label/detail is legible; a plain
 * gutter of zero height yields null (pure spacing, nothing to draw).
 */
export function composeTransitionBand(
  transition: Transition,
  targetWidth: number,
): { canvas: Canvas; width: number; height: number } | null {
  const render = layoutTransition(transition);
  const width = Math.max(1, Math.round(targetWidth));
  // Cards/breaks and the v3 solid bands (#99) get a floor so they stay legible/
  // visible even when authored with a small gutter; plain gutters honor the exact
  // height.
  const floor = render.isCard || render.treatment === "band" ? Math.round(width * 0.1) : 0;
  const height = Math.max(render.gutterHeight, floor);
  if (height <= 0) return null;

  // Band labels draw with a bundled curated face; register before drawing.
  registerToonyFonts();

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Band background: the resolved v3 solid-band fill (#99 — black_band/title_card/
  // palette_shift/desaturate_repeat, already folding in any #98 `color`) wins;
  // otherwise an explicit #98 `color` on a legacy kind; otherwise the per-treatment
  // default (card dark, fade gradient, others white reading space).
  if (render.bandFill) {
    ctx.fillStyle = render.bandFill;
    ctx.fillRect(0, 0, width, height);
  } else if (render.color) {
    ctx.fillStyle = render.color;
    ctx.fillRect(0, 0, width, height);
  } else if (render.treatment === "card") {
    ctx.fillStyle = "#15110d";
    ctx.fillRect(0, 0, width, height);
  } else if (render.treatment === "fade") {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(1, "#d9d4cc");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  // Foreground per treatment (text/divider), drawn over the background.
  if (render.treatment === "card") {
    ctx.fillStyle = "#f3ece0";
    drawBandText(ctx, render, width, height);
  } else if (render.treatment === "break") {
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = Math.max(1, Math.round(height * 0.04));
    ctx.beginPath();
    ctx.moveTo(width * 0.2, height / 2);
    ctx.lineTo(width * 0.8, height / 2);
    ctx.stroke();
    ctx.fillStyle = "#2a2a2a";
    if (render.detail) drawBandText(ctx, render, width, height);
  }

  return { canvas, width, height };
}
