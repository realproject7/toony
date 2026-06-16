// Balloon outline + speech-tail geometry, in a caller-chosen pixel space.
//
// ADOPTED from plotlink-ows `app/lib/overlays.ts` (`balloonOutline`,
// `balloonPathD`, `speechTailPoints`, `fitTailMouth`, `defaultBalloonRadius`):
// the single-command-list pattern where one ordered `BalloonCommand[]` is traced
// identically as an SVG path `d` (preview) and as canvas `moveTo`/`lineTo`/
// `arcTo` (export), so the two can never drift and there is no body/tail seam.
//
// Adapted for Toony's schema: plotlink-ows's tail anchor is BUBBLE-relative
// (0..1 across the bubble box). Toony's `LetteringOverlay.tail` is an
// IMAGE-relative normalized point in the same 0..1 space as the bubble
// `geometry` (the #4 decision: the tail resolves to a point, not an enum). So
// the tail tip here is computed directly from the image-space point rather than
// from a bubble-local fraction.

/** A point in the caller's pixel space. */
export interface Point {
  x: number;
  y: number;
}

/** A speech-tail triangle: the tip plus the two base points on the bubble edge. */
export interface TailGeometry {
  tip: Point;
  base1: Point;
  base2: Point;
}

/**
 * One drawing command in a balloon outline. `M`/`L` are move/line to (x,y); `A`
 * is a rounded corner — round the corner whose vertex is (cornerX,cornerY),
 * ending at (x,y), with radius r. The command set maps 1:1 onto both a canvas
 * path (`moveTo`/`lineTo`/`arcTo`) and an SVG path (`M`/`L`/`A`), so the SVG
 * preview and the canvas export trace the EXACT same outline.
 */
export type BalloonCommand =
  | { k: "M"; x: number; y: number }
  | { k: "L"; x: number; y: number }
  | { k: "A"; cornerX: number; cornerY: number; x: number; y: number; r: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Default corner radius for a balloon: proportional to the bubble's shorter
 * side so rounding reads as a comic balloon at any export scale, and capped
 * strictly below half the shorter side so the four corner arcs never overrun the
 * body. Single source of truth shared by the body curve and the tail mouth so
 * the tail never lands inside a rounded corner.
 */
export function defaultBalloonRadius(width: number, height: number): number {
  const shorter = Math.min(width, height);
  return Math.max(0, Math.min(shorter * 0.4, shorter / 2));
}

/**
 * Place a tail mouth of nominal width `baseW`, centered as near `toward` as
 * possible but kept entirely on the STRAIGHT span of the edge — between the two
 * rounded corners `[start + r, start + size - r]`. If the straight span is
 * narrower than the mouth, the mouth shrinks to fit. Guarantees both base points
 * sit on the flat edge, never inside a corner arc, so the unified outline never
 * back-tracks into a corner (which would render as an internal notch/seam).
 */
function fitTailMouth(
  toward: number,
  start: number,
  size: number,
  r: number,
  baseW: number,
): { center: number; half: number } {
  const span = Math.max(0, size - 2 * r);
  const half = Math.max(1, Math.min(baseW, span) / 2);
  const lo = start + r + half;
  const hi = start + size - r - half;
  const center = hi >= lo ? clamp(toward, lo, hi) : start + size / 2;
  return { center, half };
}

/**
 * Geometry for a speech-bubble tail in the bubble's pixel space. `tip` is the
 * tail tip in the SAME pixel space as the bubble rect (already converted from
 * the image-space normalized tail point by the caller). Returns the tip plus the
 * two base points where the tail meets the bubble border, or `null` when the tip
 * falls inside the bubble (no visible tail to draw). The base is anchored to the
 * edge the tail points toward and fitted onto that edge's straight span.
 */
export function speechTailGeometry(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tip: Point,
  radius?: number,
): TailGeometry | null {
  const cx = ox + ow / 2;
  const cy = oy + oh / 2;
  const tipX = tip.x;
  const tipY = tip.y;

  // Tip inside the bubble → nothing meaningful to draw.
  if (tipX >= ox && tipX <= ox + ow && tipY >= oy && tipY <= oy + oh) return null;

  const dx = tipX - cx;
  const dy = tipY - cy;
  const baseW = Math.max(6, Math.min(ow, oh) * 0.3);
  const r = radius ?? defaultBalloonRadius(ow, oh);

  if (Math.abs(dy) >= Math.abs(dx)) {
    const edgeY = dy >= 0 ? oy + oh : oy;
    const { center, half } = fitTailMouth(tipX, ox, ow, r, baseW);
    return {
      tip: { x: tipX, y: tipY },
      base1: { x: center - half, y: edgeY },
      base2: { x: center + half, y: edgeY },
    };
  }
  const edgeX = dx >= 0 ? ox + ow : ox;
  const { center, half } = fitTailMouth(tipY, oy, oh, r, baseW);
  return {
    tip: { x: tipX, y: tipY },
    base1: { x: edgeX, y: center - half },
    base2: { x: edgeX, y: center + half },
  };
}

/**
 * The single source of truth for a balloon's outline: the rounded-rect body plus
 * its pointer tail as ONE continuous perimeter, with the tail folded into
 * whichever edge it sits on (a detour out to the tip and back), never a separate
 * shape. `tail` is null for a tailless bubble → a plain rounded rectangle.
 * Coordinates are in the caller's pixel space.
 */
export function balloonOutline(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: TailGeometry | null,
  radius?: number,
): BalloonCommand[] {
  const r = radius ?? defaultBalloonRadius(ow, oh);
  const right = ox + ow;
  const bottom = oy + oh;

  // speechTailGeometry anchors both base points exactly on one bubble edge, so
  // the edge each comparison identifies is exact (no float fuzz needed).
  const onTop = !!tail && tail.base1.y === oy && tail.base2.y === oy;
  const onRight = !!tail && tail.base1.x === right && tail.base2.x === right;
  const onBottom = !!tail && tail.base1.y === bottom && tail.base2.y === bottom;
  const onLeft = !!tail && tail.base1.x === ox && tail.base2.x === ox;

  const cmds: BalloonCommand[] = [{ k: "M", x: ox + r, y: oy }];
  // Top edge, traced left→right.
  if (onTop && tail) {
    cmds.push(
      { k: "L", x: tail.base1.x, y: oy },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: tail.base2.x, y: oy },
    );
  }
  cmds.push(
    { k: "L", x: right - r, y: oy },
    { k: "A", cornerX: right, cornerY: oy, x: right, y: oy + r, r },
  );
  // Right edge, traced top→bottom.
  if (onRight && tail) {
    cmds.push(
      { k: "L", x: right, y: tail.base1.y },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: right, y: tail.base2.y },
    );
  }
  cmds.push(
    { k: "L", x: right, y: bottom - r },
    { k: "A", cornerX: right, cornerY: bottom, x: right - r, y: bottom, r },
  );
  // Bottom edge, traced right→left.
  if (onBottom && tail) {
    cmds.push(
      { k: "L", x: tail.base2.x, y: bottom },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: tail.base1.x, y: bottom },
    );
  }
  cmds.push(
    { k: "L", x: ox + r, y: bottom },
    { k: "A", cornerX: ox, cornerY: bottom, x: ox, y: bottom - r, r },
  );
  // Left edge, traced bottom→top.
  if (onLeft && tail) {
    cmds.push(
      { k: "L", x: ox, y: tail.base2.y },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: ox, y: tail.base1.y },
    );
  }
  cmds.push(
    { k: "L", x: ox, y: oy + r },
    { k: "A", cornerX: ox, cornerY: oy, x: ox + r, y: oy, r },
  );
  return cmds;
}

/**
 * SVG path `d` for a balloon, built from the shared {@link balloonOutline}.
 * Filling and stroking this single path yields an integrated balloon with no
 * internal body/tail seam; it traces the identical outline the canvas export
 * does from the same command list.
 */
export function balloonPathD(commands: BalloonCommand[]): string {
  const parts = commands.map((c) =>
    c.k === "A" ? `A ${c.r} ${c.r} 0 0 1 ${c.x} ${c.y}` : `${c.k} ${c.x} ${c.y}`,
  );
  parts.push("Z");
  return parts.join(" ");
}
