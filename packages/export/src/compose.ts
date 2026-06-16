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
  layoutCut,
  layoutTransition,
  type TransitionRender,
} from "@toony/render";
import type { LetteringOverlay, Transition } from "@toony/schema";
import { createCanvasMeasure, FONT_FAMILY } from "./measure.js";

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

  const fontWeight = b.kind === "shout" || b.kind === "sfx" ? 700 : 400;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Speaker label, when present, sits in the strip above the body text.
  if (b.text.speakerFontSize > 0 && b.speaker.trim().length > 0) {
    const padY = Math.max(2, b.box.height * 0.08);
    ctx.font = `700 ${b.text.speakerFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = b.speakerColor;
    ctx.fillText(b.speaker, b.box.x + b.box.width / 2, b.box.y + padY);
  }

  ctx.font = `${fontWeight} ${b.text.fontSize}px ${FONT_FAMILY}`;
  for (const line of b.lines) {
    if (b.hasBubble) {
      ctx.fillStyle = b.textColor;
      ctx.fillText(line.text, line.centerX, line.y);
    } else {
      // SFX: outline the bare text so it reads on any background.
      ctx.lineWidth = Math.max(1, b.text.fontSize * 0.12);
      ctx.strokeStyle = b.stroke;
      ctx.lineJoin = "round";
      ctx.strokeText(line.text, line.centerX, line.y);
      ctx.fillStyle = b.textColor;
      ctx.fillText(line.text, line.centerX, line.y);
    }
  }
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

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#eceae6";
    ctx.fillRect(0, 0, width, height);
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
    ctx.font = `700 ${labelSize}px ${FONT_FAMILY}`;
    ctx.fillText(render.detail, cx, height * 0.42);
    ctx.font = `400 ${Math.max(8, Math.round(labelSize * 0.6))}px ${FONT_FAMILY}`;
    ctx.fillText(render.label, cx, height * 0.68);
  } else {
    ctx.font = `400 ${Math.max(8, Math.round(labelSize * 0.7))}px ${FONT_FAMILY}`;
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
  const floor = render.isCard ? Math.round(width * 0.1) : 0;
  const height = Math.max(render.gutterHeight, floor);
  if (height <= 0) return null;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  if (render.treatment === "card") {
    ctx.fillStyle = "#15110d";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f3ece0";
    drawBandText(ctx, render, width, height);
  } else if (render.treatment === "break") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = Math.max(1, Math.round(height * 0.04));
    ctx.beginPath();
    ctx.moveTo(width * 0.2, height / 2);
    ctx.lineTo(width * 0.8, height / 2);
    ctx.stroke();
    ctx.fillStyle = "#2a2a2a";
    if (render.detail) drawBandText(ctx, render, width, height);
  } else if (render.treatment === "fade") {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(1, "#d9d4cc");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else {
    // Plain gutter: white reading space.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  return { canvas, width, height };
}
