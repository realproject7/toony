import type { LetteringOverlay } from "@toony/schema";

export interface LetteringGradient {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: { offset: number; color: string }[];
}

/** 0° goes left to right; 90° top to bottom. Stops span the projected body. */
export function resolveLetteringGradient(
  gradient: LetteringOverlay["fillGradient"],
  box: { x: number; y: number; width: number; height: number },
): LetteringGradient | null {
  if (!gradient) return null;
  const angle = (gradient.angle * Math.PI) / 180;
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  const radius = (Math.abs(dx) * box.width + Math.abs(dy) * box.height) / 2;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  return {
    x1: cx - dx * radius,
    y1: cy - dy * radius,
    x2: cx + dx * radius,
    y2: cy + dy * radius,
    stops: gradient.stops,
  };
}
