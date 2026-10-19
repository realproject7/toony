import type { BalloonShape } from "@toony/schema";
import {
  type BalloonCommand,
  buildBalloonOutline,
  type Point,
  speechTailGeometry,
  type TailGeometry,
} from "./geometry.js";

const TAU = Math.PI * 2;

/** Cubic ellipse arcs, shared verbatim by SVG and raster. */
function ellipseArc(cx: number, cy: number, rx: number, ry: number, from: number, to: number) {
  const commands: BalloonCommand[] = [];
  const steps = Math.ceil((to - from) / (Math.PI / 2));
  for (let i = 0; i < steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const b = from + ((to - from) * (i + 1)) / steps;
    const k = (4 / 3) * Math.tan((b - a) / 4);
    commands.push({
      k: "C",
      x1: cx + rx * (Math.cos(a) - k * Math.sin(a)),
      y1: cy + ry * (Math.sin(a) + k * Math.cos(a)),
      x2: cx + rx * (Math.cos(b) + k * Math.sin(b)),
      y2: cy + ry * (Math.sin(b) - k * Math.cos(b)),
      x: cx + rx * Math.cos(b),
      y: cy + ry * Math.sin(b),
    });
  }
  return commands;
}

/** Shape geometry is independent of output size, including tails and cloud lobes. */
export function shapedBalloon(
  box: { x: number; y: number; width: number; height: number },
  shape: BalloonShape,
  tip: Point | null,
  thought: boolean,
  radius: number,
): { outline: BalloonCommand[]; tail: TailGeometry | null } {
  const { x, y, width, height } = box;
  const cx = x + width / 2,
    cy = y + height / 2;
  const rx = width / 2,
    ry = height / 2;
  const point = (a: number, scale = 1): Point => ({
    x: cx + rx * Math.cos(a) * scale,
    y: cy + ry * Math.sin(a) * scale,
  });
  // A handle inside the bounding box hides the tail. This also avoids a tail
  // crossing text when the author moves its tip through the body.
  const outside = tip && (tip.x < x || tip.x > x + width || tip.y < y || tip.y > y + height);
  const angle = outside ? Math.atan2((tip.y - cy) / ry, (tip.x - cx) / rx) : Math.PI / 2;
  const mouth = Math.min(
    0.28,
    (Math.min(width, height) * 0.09) / Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle)),
  );
  let tail: TailGeometry | null = outside
    ? {
        tip,
        base1: point(angle - mouth),
        base2: point(angle + mouth),
      }
    : null;
  const outline: BalloonCommand[] = [];
  const joinTail = (start: Point, end: Point) => {
    if (!tail) return;
    // A restrained bend keeps a narrow pointer attached to the perimeter.
    outline.push(
      {
        k: "Q",
        cx: start.x + (tail.tip.x - start.x) * 0.4,
        cy: start.y + (tail.tip.y - start.y) * 0.68,
        ...tail.tip,
      },
      {
        k: "Q",
        cx: end.x + (tail.tip.x - end.x) * 0.2,
        cy: end.y + (tail.tip.y - end.y) * 0.35,
        ...end,
      },
    );
  };
  if (shape === "rounded") {
    const pointer =
      outside && !thought ? speechTailGeometry(x, y, width, height, tip, radius) : null;
    outline.push(...buildBalloonOutline(x, y, width, height, pointer, radius));
    if (!thought) tail = pointer;
  } else if (shape === "oval") {
    const begin = outside && !thought ? angle + mouth : 0;
    const end = outside && !thought ? angle - mouth + TAU : TAU;
    outline.push({ k: "M", ...point(begin) }, ...ellipseArc(cx, cy, rx, ry, begin, end));
    if (!thought && tail) joinTail(tail.base1, tail.base2);
  } else {
    // Large lobes / inward-curved burst edges shape the whole perimeter, with
    // no rectangular corners or resolution-dependent micro-serrations.
    const count = shape === "cloud" ? 12 : 14;
    const step = TAU / count;
    const start = -Math.PI / 2;
    const tailEdge = Math.floor(((((angle - start) % TAU) + TAU) % TAU) / step);
    const scale = shape === "cloud" ? 0.88 : 1;
    outline.push({ k: "M", ...point(start, scale) });
    for (let i = 0; i < count; i++) {
      const a = start + step * i,
        b = a + step;
      const p = point(a, scale),
        q = point(b, scale);
      if (i === tailEdge && tail && !thought) {
        tail = { tip: tail.tip, base1: p, base2: q };
        joinTail(p, q);
      } else {
        const control = point((a + b) / 2, shape === "cloud" ? 1.11 : 0.72 + (i % 3) * 0.025);
        outline.push({ k: "Q", cx: control.x, cy: control.y, ...q });
      }
    }
  }
  outline.push({ k: "Z" });
  if (thought && tail) {
    // Three detached, diminishing beads. Their radii shrink with short tails,
    // so the circles cannot collide or merge into the body.
    const roundedAnchor =
      shape === "rounded" ? speechTailGeometry(x, y, width, height, tail.tip, radius) : null;
    const anchor = roundedAnchor
      ? {
          x: (roundedAnchor.base1.x + roundedAnchor.base2.x) / 2,
          y: (roundedAnchor.base1.y + roundedAnchor.base2.y) / 2,
        }
      : point(angle);
    const distance = Math.hypot(tail.tip.x - anchor.x, tail.tip.y - anchor.y);
    const size = Math.min(Math.min(width, height) * 0.065, distance * 0.12);
    for (const [t, scale] of [
      [0.23, 1],
      [0.62, 0.7],
      [1, 0.42],
    ] as const) {
      const px = anchor.x + (tail.tip.x - anchor.x) * t;
      const py = anchor.y + (tail.tip.y - anchor.y) * t;
      const r = size * scale;
      outline.push({ k: "M", x: px + r, y: py }, ...ellipseArc(px, py, r, r, 0, TAU), { k: "Z" });
    }
  }
  return { outline, tail };
}
