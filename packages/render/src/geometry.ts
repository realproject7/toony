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

// --- Impact-band SFX decoration (#99) ---------------------------------------
//
// `impact_band` SFX draws a large full-width impact: radial speed-lines + a
// jagged burst behind the lettering. Every primitive here is a PURE straight
// segment (no arcs, no gradients) so the SVG preview and the canvas export trace
// the identical shapes and stay pixel-consistent (the #88/#93 parity rule).

/** A straight speed-line segment in the caller's pixel space. */
export interface ImpactLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Shared colors for the impact decoration, so studio and export never drift. */
export const IMPACT_RAY_COLOR = "#111111";
export const IMPACT_BURST_FILL = "#ffffff";
export const IMPACT_BURST_STROKE = "#111111";

/** Number of star spikes in the impact burst polygon. */
const IMPACT_BURST_SPIKES = 16;
/** Number of radial speed-lines. */
const IMPACT_RAY_COUNT = 28;

/**
 * The geometry of an `impact_band` SFX decoration (#99) for a box in pixel space:
 * a jagged burst polygon (a closed star, drawn behind the text) plus radial
 * speed-lines that fan out from the center to the box edges. All pure straight
 * segments; the resolved stroke widths are returned so both consumers stroke them
 * identically. Deterministic: same box → same geometry.
 */
export interface ImpactDecoration {
  /** Closed star polygon (draw as M, L…, Z). */
  burst: Point[];
  /** Stroke width in px for the burst outline. */
  burstStrokeWidth: number;
  /** Radial speed-lines. */
  rays: ImpactLine[];
  /** Stroke width in px for the speed-lines. */
  rayWidth: number;
}

/** Intersect the ray from `(cx,cy)` in direction `(dx,dy)` with the box edges. */
function rayBoxEdge(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  halfW: number,
  halfH: number,
): Point {
  const tx = Math.abs(dx) > 1e-9 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > 1e-9 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Build the impact-band decoration for a box rect (pixel space). */
export function impactDecoration(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ImpactDecoration {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const minHalf = Math.max(1, Math.min(halfW, halfH));

  // Burst: a closed star alternating outer/inner radius around the center.
  const outer = minHalf * 0.92;
  const inner = outer * 0.5;
  const burst: Point[] = [];
  const points = IMPACT_BURST_SPIKES * 2;
  for (let i = 0; i < points; i++) {
    const angle = (Math.PI * 2 * i) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    burst.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }

  // Speed-lines: fan from a ring just inside the burst out to the box edges.
  const rayStart = minHalf * 0.5;
  const rays: ImpactLine[] = [];
  for (let i = 0; i < IMPACT_RAY_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / IMPACT_RAY_COUNT;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const end = rayBoxEdge(cx, cy, dx, dy, halfW, halfH);
    rays.push({ x1: cx + dx * rayStart, y1: cy + dy * rayStart, x2: end.x, y2: end.y });
  }

  return {
    burst,
    burstStrokeWidth: Math.max(1, minHalf * 0.03),
    rays,
    rayWidth: Math.max(1, minHalf * 0.02),
  };
}

/**
 * Outline decoration for a straight edge span (#93): the body silhouette that
 * encodes a bubble's kind/tone. `rounded` is a plain straight edge (current
 * behavior); `scalloped`/`bumpy` bulge the edge into cloud lobes (shout / thought);
 * `jagged` pushes it into spikes (aggressive). All are emitted as pure LINE
 * segments so the SVG path and the canvas trace are byte-identical (#88 parity).
 */
export type OutlineDecoration = "rounded" | "scalloped" | "bumpy" | "jagged";

/**
 * Decorate the straight span from (fx,fy) to (tx,ty) — whose OUTWARD normal is
 * the unit vector (nx,ny) — returning the commands AFTER the start point (the
 * caller is already at (fx,fy)) up to and including (tx,ty). `rounded` is a single
 * line; the others tile the span with outward lobes/spikes.
 */
function decorateSpan(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  decoration: OutlineDecoration,
): BalloonCommand[] {
  if (decoration === "rounded") return [{ k: "L", x: tx, y: ty }];
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len < 2) return [{ k: "L", x: tx, y: ty }];
  const amp =
    decoration === "jagged"
      ? Math.min(len * 0.18, 16)
      : decoration === "bumpy"
        ? Math.min(len * 0.1, 9)
        : Math.min(len * 0.16, 14);
  const lobeLen = decoration === "bumpy" ? amp * 2.2 : amp * 2.4;
  const lobes = Math.max(1, Math.round(len / lobeLen));
  const out: BalloonCommand[] = [];
  for (let i = 0; i < lobes; i++) {
    const a0 = i / lobes;
    const a1 = (i + 1) / lobes;
    if (decoration === "jagged") {
      const m = (a0 + a1) / 2;
      out.push({ k: "L", x: fx + dx * m + nx * amp, y: fy + dy * m + ny * amp });
      out.push({ k: "L", x: fx + dx * a1, y: fy + dy * a1 });
    } else {
      // Outward semicircle from lobe start to lobe end, sampled as line segments.
      const segments = 5;
      const sx = fx + dx * a0;
      const sy = fy + dy * a0;
      const ex = fx + dx * a1;
      const ey = fy + dy * a1;
      for (let s = 1; s <= segments; s++) {
        const angle = Math.PI * (s / segments);
        const along = (1 - Math.cos(angle)) / 2;
        const bulge = Math.sin(angle);
        out.push({
          x: sx + (ex - sx) * along + nx * amp * bulge,
          y: sy + (ey - sy) * along + ny * amp * bulge,
          k: "L",
        });
      }
    }
  }
  return out;
}

/**
 * The single source of truth for a balloon's outline: the rounded-rect body plus
 * its pointer tail as ONE continuous perimeter, with the tail folded into
 * whichever edge it sits on (a detour out to the tip and back), never a separate
 * shape. `tail` is null for a tailless bubble → a plain rounded rectangle.
 * `decoration` (#93) shapes the four edge spans — rounded keeps the corner arcs +
 * straight edges (so existing bubbles are byte-identical); scalloped/bumpy/jagged
 * replace the straight spans with lobes/spikes. Coordinates are in pixel space.
 */
export function buildBalloonOutline(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: TailGeometry | null,
  radius?: number,
  decoration: OutlineDecoration = "rounded",
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
  let cx = ox + r;
  let cy = oy;
  // Top edge, traced left→right (outward normal up).
  if (onTop && tail) {
    cmds.push(
      { k: "L", x: tail.base1.x, y: oy },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: tail.base2.x, y: oy },
    );
    cx = tail.base2.x;
    cy = oy;
  }
  cmds.push(...decorateSpan(cx, cy, right - r, oy, 0, -1, decoration));
  cmds.push({ k: "A", cornerX: right, cornerY: oy, x: right, y: oy + r, r });
  cx = right;
  cy = oy + r;
  // Right edge, traced top→bottom (outward normal right).
  if (onRight && tail) {
    cmds.push(
      { k: "L", x: right, y: tail.base1.y },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: right, y: tail.base2.y },
    );
    cx = right;
    cy = tail.base2.y;
  }
  cmds.push(...decorateSpan(cx, cy, right, bottom - r, 1, 0, decoration));
  cmds.push({ k: "A", cornerX: right, cornerY: bottom, x: right - r, y: bottom, r });
  cx = right - r;
  cy = bottom;
  // Bottom edge, traced right→left (outward normal down).
  if (onBottom && tail) {
    cmds.push(
      { k: "L", x: tail.base2.x, y: bottom },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: tail.base1.x, y: bottom },
    );
    cx = tail.base1.x;
    cy = bottom;
  }
  cmds.push(...decorateSpan(cx, cy, ox + r, bottom, 0, 1, decoration));
  cmds.push({ k: "A", cornerX: ox, cornerY: bottom, x: ox, y: bottom - r, r });
  cx = ox;
  cy = bottom - r;
  // Left edge, traced bottom→top (outward normal left).
  if (onLeft && tail) {
    cmds.push(
      { k: "L", x: ox, y: tail.base2.y },
      { k: "L", x: tail.tip.x, y: tail.tip.y },
      { k: "L", x: ox, y: tail.base1.y },
    );
    cx = ox;
    cy = tail.base1.y;
  }
  cmds.push(...decorateSpan(cx, cy, ox, oy + r, -1, 0, decoration));
  cmds.push({ k: "A", cornerX: ox, cornerY: oy, x: ox + r, y: oy, r });
  return cmds;
}

/** The rounded balloon outline (back-compat wrapper over {@link buildBalloonOutline}). */
export function balloonOutline(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: TailGeometry | null,
  radius?: number,
): BalloonCommand[] {
  return buildBalloonOutline(ox, oy, ow, oh, tail, radius, "rounded");
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
