// Moving and resizing a cut's frame (CMP-02) over its picture, in fractions of
// the picture. Pure, so the dialog and its tests share it. A frame never leaves
// the picture: what is not in the picture cannot be shown, only drawn anew.

import type { ImageView } from "@toony/schema";

export type FrameHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The smallest frame side the editor allows, as a fraction of the picture. */
export const FRAME_MIN = 0.05;

export const WHOLE_FRAME: ImageView = { x: 0, y: 0, width: 1, height: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The frame after dragging `handle` by (dx, dy), fractions of the picture. */
export function dragFrame(
  start: ImageView,
  handle: FrameHandle,
  dx: number,
  dy: number,
): ImageView {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - FRAME_MIN);
  if (handle.includes("e")) right = clamp(right + dx, left + FRAME_MIN, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - FRAME_MIN);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + FRAME_MIN, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Which picture edges the frame reaches: there is nothing more to show beyond them. */
export function frameEdges(view: ImageView): { top: boolean; bottom: boolean } {
  return { top: view.y <= 0.001, bottom: view.y + view.height >= 0.999 };
}

/** Whether a frame shows the whole picture. */
export function isWholeFrame(view: ImageView): boolean {
  return view.x <= 0.001 && view.y <= 0.001 && view.width >= 0.999 && view.height >= 0.999;
}

/** Quick frames for a tall picture split across cuts. */
export const FRAME_PRESETS: ReadonlyArray<{ label: string; view: ImageView }> = [
  { label: "All", view: WHOLE_FRAME },
  { label: "Top half", view: { x: 0, y: 0, width: 1, height: 0.5 } },
  { label: "Bottom half", view: { x: 0, y: 0.5, width: 1, height: 0.5 } },
  { label: "Top third", view: { x: 0, y: 0, width: 1, height: 1 / 3 } },
  { label: "Middle third", view: { x: 0, y: 1 / 3, width: 1, height: 1 / 3 } },
  { label: "Bottom third", view: { x: 0, y: 2 / 3, width: 1, height: 1 / 3 } },
];
