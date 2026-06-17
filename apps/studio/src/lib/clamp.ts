// Shared numeric clamp for the editor components.
//
// The cut editor, bubble inspector, and transition editor all constrain dragged
// geometry and numeric inputs to a range. They previously each defined an
// identical `clamp`; this is the single shared definition they import (#87).

/** Constrain `value` to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
