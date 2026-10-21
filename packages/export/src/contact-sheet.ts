// A contact sheet: a set of pictures in one image, each under its number, so
// whoever checks the set (a person, or their agent before a character is
// trained) sees all of it at once and can name the pictures to drop.

import { type Canvas, createCanvas, loadImage } from "@napi-rs/canvas";
import { canvasFontFamily, registerToonyFonts } from "./fonts.js";

export interface ContactSheetPicture {
  bytes: Uint8Array;
  /** Shown above the picture, for example its number. */
  label: string;
}

export interface ContactSheetOptions {
  /** Pictures per row. */
  columns?: number;
  /** Width of each picture, in px. */
  cellWidth?: number;
}

const GAP = 8;
const LABEL_HEIGHT = 26;
const SHEET_FILL = "#e9ebf0";
const LABEL_FILL = "#1b2030";
const MISSING_FILL = "#c4c8d2";

/**
 * Lay the pictures out in a grid, each scaled to `cellWidth` at the first
 * picture's aspect ratio, under its label. A picture that cannot be decoded is
 * drawn as an empty grey cell, so the numbering still matches the set.
 */
export async function composeContactSheet(
  pictures: readonly ContactSheetPicture[],
  options: ContactSheetOptions = {},
): Promise<Canvas> {
  const columns = Math.max(1, Math.min(options.columns ?? 6, pictures.length || 1));
  const cellWidth = Math.max(32, Math.round(options.cellWidth ?? 160));
  const images = await Promise.all(
    pictures.map(async (picture) => {
      try {
        return await loadImage(Buffer.from(picture.bytes));
      } catch {
        return null;
      }
    }),
  );
  const first = images.find((image) => image !== null);
  const aspect = first ? first.height / first.width : 1216 / 832;
  const cellHeight = Math.round(cellWidth * aspect);
  const rows = Math.max(1, Math.ceil(pictures.length / columns));
  const width = GAP + columns * (cellWidth + GAP);
  const height = GAP + rows * (LABEL_HEIGHT + cellHeight + GAP);

  registerToonyFonts();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = SHEET_FILL;
  ctx.fillRect(0, 0, width, height);
  ctx.font = `20px "${canvasFontFamily("nunito", 700, "speech")}"`;
  ctx.textBaseline = "middle";
  pictures.forEach((picture, index) => {
    const x = GAP + (index % columns) * (cellWidth + GAP);
    const y = GAP + Math.floor(index / columns) * (LABEL_HEIGHT + cellHeight + GAP);
    ctx.fillStyle = LABEL_FILL;
    ctx.fillText(picture.label, x + 2, y + LABEL_HEIGHT / 2);
    const image = images[index];
    if (image) ctx.drawImage(image, x, y + LABEL_HEIGHT, cellWidth, cellHeight);
    else {
      ctx.fillStyle = MISSING_FILL;
      ctx.fillRect(x, y + LABEL_HEIGHT, cellWidth, cellHeight);
    }
  });
  return canvas;
}
