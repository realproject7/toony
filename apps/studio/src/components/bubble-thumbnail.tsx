"use client";

import type { BubbleRender } from "@toony/render";
import { BubbleBody } from "./bubble-body";
import { BubbleText } from "./bubble-text";

/** The actual render plan, cropped to the body/tail. No second icon geometry. */
export function BubbleThumbnail({ plan }: { plan: BubbleRender }) {
  const points = plan.outline.flatMap((command) => {
    if (command.k === "Z") return [];
    const end = { x: command.x, y: command.y };
    if (command.k === "C")
      return [end, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }];
    if (command.k === "Q") return [end, { x: command.cx, y: command.cy }];
    return [end];
  });
  const { x, y, width, height } = plan.box;
  let left = Math.min(x, ...points.map((point) => point.x)) - 14;
  let top = Math.min(y, ...points.map((point) => point.y)) - 14;
  let right = Math.max(x + width, ...points.map((point) => point.x)) + 14;
  let bottom = Math.max(y + height, ...points.map((point) => point.y)) + 14;
  if (!plan.hasBubble) {
    const segments = plan.lines.flatMap((line) => line.segments ?? []);
    const size = plan.text.fontSize;
    const line = plan.lines[0];
    left = segments.length
      ? Math.min(...segments.map((segment) => segment.x)) - size * 0.2
      : (line?.centerX ?? x + width / 2) - size;
    right = segments.length
      ? Math.max(...segments.map((segment) => segment.x + segment.width)) + size * 0.2
      : left + size * 2;
    top = segments.length
      ? Math.min(...segments.map((segment) => segment.baselineY)) - size
      : (line?.baselineY ?? y + height / 2) - size;
    bottom = top + size * 1.4;
  }
  return (
    <svg
      className="bubble-thumbnail"
      viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
      aria-hidden="true"
      data-preview-kind={plan.kind}
    >
      <BubbleBody plan={plan} thumbnail />
      {!plan.hasBubble && <BubbleText plan={plan} />}
    </svg>
  );
}
