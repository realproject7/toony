import type { BalloonShape, TailStyle } from "@toony/schema";
import type { BalloonCommand, Point, TailGeometry } from "./geometry.js";

type Curve = [Point, Point, Point, Point];
const TAU = Math.PI * 2;
function item<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("Invalid balloon contour index.");
  return value;
}
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function split(c: Curve, t: number): [Curve, Curve] {
  const a = mix(c[0], c[1], t),
    b = mix(c[1], c[2], t),
    d = mix(c[2], c[3], t);
  const e = mix(a, b, t),
    f = mix(b, d, t),
    p = mix(e, f, t);
  return [
    [c[0], a, e, p],
    [p, f, d, c[3]],
  ];
}
const at = (c: Curve, t: number) => split(c, t)[0][3];
const command = (c: Curve): BalloonCommand => ({
  k: "C",
  x1: c[1].x,
  y1: c[1].y,
  x2: c[2].x,
  y2: c[2].y,
  ...c[3],
});
function slice(c: Curve, a: number, b: number): Curve {
  const head = b === 1 ? c : split(c, b)[0];
  return a === 0 ? head : split(head, a / b)[1];
}

/** Original normalized contours. They are not traced source artwork. */
function contour(shape: BalloonShape, radiusX: number, radiusY: number): Curve[] {
  const curves: Curve[] = [];
  let p: Point = { x: 1, y: 0.5 };
  const move = (x: number, y: number) => {
    p = { x, y };
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const q = { x, y };
    curves.push([p, { x: x1, y: y1 }, { x: x2, y: y2 }, q]);
    p = q;
  };
  const line = (x: number, y: number) => {
    const q = { x, y };
    curves.push([p, mix(p, q, 1 / 3), mix(p, q, 2 / 3), q]);
    p = q;
  };
  const quad = (cx: number, cy: number, x: number, y: number) => {
    const q = { x, y },
      c = { x: cx, y: cy };
    const a = mix(p, c, 2 / 3),
      b = mix(q, c, 2 / 3);
    cubic(a.x, a.y, b.x, b.y, x, y);
  };
  const polar = (a: number, r = 1) => ({
    x: 0.5 + 0.5 * r * Math.cos(a),
    y: 0.5 + 0.5 * r * Math.sin(a),
  });
  if (shape === "oval" || shape === "radial") {
    const r = shape === "radial" ? 0.77 : 1;
    move(0.5 + r / 2, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2,
        b = a + Math.PI / 2,
        k = 0.5522847498307936;
      const q = polar(b, r);
      cubic(
        0.5 + (r / 2) * (Math.cos(a) - k * Math.sin(a)),
        0.5 + (r / 2) * (Math.sin(a) + k * Math.cos(a)),
        0.5 + (r / 2) * (Math.cos(b) + k * Math.sin(b)),
        0.5 + (r / 2) * (Math.sin(b) - k * Math.cos(b)),
        q.x,
        q.y,
      );
    }
  } else if (shape === "soft") {
    move(0.5, 0);
    cubic(0.72, 0, 0.93, 0.07, 0.97, 0.25);
    cubic(1.01, 0.4, 1.01, 0.6, 0.96, 0.76);
    cubic(0.92, 0.93, 0.72, 1, 0.5, 1);
    cubic(0.28, 1, 0.08, 0.93, 0.04, 0.76);
    cubic(-0.01, 0.6, -0.01, 0.4, 0.03, 0.25);
    cubic(0.07, 0.07, 0.28, 0, 0.5, 0);
  } else if (shape === "rounded" || shape === "rectangle") {
    const rx = shape === "rectangle" ? 0 : Math.min(0.49, radiusX),
      ry = shape === "rectangle" ? 0 : Math.min(0.49, radiusY);
    move(rx, 0);
    line(1 - rx, 0);
    cubic(1 - rx * 0.448, 0, 1, ry * 0.448, 1, ry);
    line(1, 1 - ry);
    cubic(1, 1 - ry * 0.448, 1 - rx * 0.448, 1, 1 - rx, 1);
    line(rx, 1);
    cubic(rx * 0.448, 1, 0, 1 - ry * 0.448, 0, 1 - ry);
    line(0, ry);
    cubic(0, ry * 0.448, rx * 0.448, 0, rx, 0);
  } else if (shape === "cloud") {
    // Unequal broad lobes, with small valleys and a quiet central text area.
    const angles = [
      -1.57, -0.83, -0.28, 0.34, 0.95, 1.6, 2.19, 2.88, 3.52, 4.08, 4.713185307179586,
    ];
    const radii = [0.82, 0.87, 0.83, 0.88, 0.84, 0.86, 0.81, 0.87, 0.84, 0.86, 0.82];
    const first = polar(item(angles, 0), item(radii, 0));
    move(first.x, first.y);
    for (let i = 0; i < angles.length - 1; i++) {
      const a = item(angles, i),
        b = item(angles, i + 1),
        q = polar(b, item(radii, i + 1));
      const c = polar((a + b) / 2, 1.2 + (i % 3) * 0.025);
      quad(c.x, c.y, q.x, q.y);
    }
  } else if (shape === "wobble") {
    const points = Array.from({ length: 16 }, (_, i) => {
      const a = (i * TAU) / 16;
      return polar(a, 0.93 + Math.sin(a * 5 + 0.4) * 0.045 + Math.cos(a * 3) * 0.025);
    });
    move(item(points, 0).x, item(points, 0).y);
    for (let i = 0; i < points.length; i++) {
      const before = item(points, (i + 15) % 16),
        a = item(points, i),
        b = item(points, (i + 1) % 16),
        after = item(points, (i + 2) % 16);
      cubic(
        a.x + (b.x - before.x) / 6,
        a.y + (b.y - before.y) / 6,
        b.x - (after.x - a.x) / 6,
        b.y - (after.y - a.y) / 6,
        b.x,
        b.y,
      );
    }
  } else if (shape === "burst-box") {
    move(0.06, 0.04);
    quad(0.5, 0.15, 0.94, 0.04);
    quad(0.88, 0.15, 0.99, 0.08);
    quad(0.89, 0.5, 0.99, 0.92);
    quad(0.86, 0.85, 0.95, 0.99);
    quad(0.5, 0.88, 0.05, 0.99);
    quad(0.14, 0.85, 0.01, 0.94);
    quad(0.12, 0.5, 0.01, 0.06);
    quad(0.14, 0.16, 0.06, 0.04);
  } else if (shape === "electric") {
    const points: [number, number][] = [
      [0.08, 0.05],
      [0.86, 0.05],
      [0.86, 0],
      [0.94, 0.06],
      [1, 0.02],
      [0.96, 0.12],
      [1, 0.12],
      [1, 0.86],
      [0.95, 0.86],
      [1, 0.96],
      [0.89, 0.93],
      [0.92, 1],
      [0.14, 1],
      [0.14, 0.95],
      [0.04, 1],
      [0.08, 0.9],
      [0, 0.9],
      [0, 0.14],
      [0.05, 0.14],
      [0, 0.04],
      [0.11, 0.08],
      [0.08, 0.05],
    ];
    move(item(points, 0)[0], item(points, 0)[1]);
    for (const q of points.slice(1)) line(q[0], q[1]);
  } else {
    const count = shape === "spikes" ? 28 : 12;
    const first = polar(-Math.PI / 2);
    move(first.x, first.y);
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (i * TAU) / count,
        b = a + TAU / count;
      const q = polar(b, i === count - 1 ? 1 : 0.94 + (i % 3) * 0.03);
      const c = polar((a + b) / 2, shape === "spikes" ? 0.78 : 0.71 + (i % 3) * 0.02);
      if (shape === "spikes") {
        line(c.x, c.y);
        line(q.x, q.y);
      } else quad(c.x, c.y, q.x, q.y);
    }
  }
  return curves;
}

export interface TailOptions {
  style: TailStyle;
  width?: number;
  bend?: number;
}

/** Shared curves and tail splice for both SVG and raster. All dimensions scale together. */
export function authoredBalloon(
  box: { x: number; y: number; width: number; height: number },
  shape: BalloonShape,
  tip: Point | null,
  radius: number,
  options: TailOptions,
): { outline: BalloonCommand[]; tail: TailGeometry | null; accents: BalloonCommand[] } {
  const { x, y, width, height } = box;
  const curves = contour(shape, radius / width, radius / height).map(
    (c) => c.map((p) => ({ x: x + p.x * width, y: y + p.y * height })) as Curve,
  );
  const outside = tip && (tip.x < x || tip.x > x + width || tip.y < y || tip.y > y + height);
  const active = outside && options.style !== "none" ? tip : null;
  const outline: BalloonCommand[] = [];
  let tail: TailGeometry | null = null;
  let anchor = item(curves, 0)[0];
  // A small arc-length table locates a mouth on the actual contour, including
  // flat box edges. Sub-curves are split exactly, so a pointer has no closing seam.
  const table: { s: number; u: number; p: Point }[] = [{ s: 0, u: 0, p: anchor }];
  for (let i = 0; i < curves.length; i++)
    for (let j = 1; j <= 24; j++) {
      const p = at(item(curves, i), j / 24),
        last = item(table, table.length - 1);
      table.push({ s: last.s + distance(last.p, p), u: i + j / 24, p });
    }
  const length = item(table, table.length - 1).s;
  const locate = (s: number) => {
    const wrapped = ((s % length) + length) % length;
    const index = table.findIndex((v) => v.s >= wrapped);
    if (index <= 0) return 0;
    const a = item(table, index - 1),
      b = item(table, index);
    return a.u + ((b.u - a.u) * (wrapped - a.s)) / (b.s - a.s || 1);
  };
  const pointAt = (u: number) => at(item(curves, Math.floor(u) % curves.length), u % 1);
  const append = (from: number, to: number) => {
    let cursor = from;
    while (cursor < to - 1e-9) {
      const i = Math.floor(cursor),
        end = Math.min(i + 1, to);
      outline.push(command(slice(item(curves, i % curves.length), cursor - i, end - i)));
      cursor = end;
    }
  };
  if (active) {
    const nearest = table.reduce((a, b) =>
      distance(a.p, active) <= distance(b.p, active) ? a : b,
    );
    anchor = nearest.p;
    const half = (Math.min(width, height) * (options.width ?? 0.14)) / 2;
    const begin = locate(nearest.s + half),
      end0 = locate(nearest.s - half);
    const end = end0 > begin ? end0 : end0 + curves.length;
    tail = { tip: active, base1: pointAt(end0), base2: pointAt(begin) };
    if (options.style !== "beads") {
      outline.push({ k: "M", ...tail.base2 });
      append(begin, end);
      if (options.style === "straight")
        outline.push({ k: "L", ...active }, { k: "L", ...tail.base2 });
      else {
        const dx = active.x - anchor.x,
          dy = active.y - anchor.y,
          bend = (options.bend ?? 0.25) * 0.4;
        const c1 = mix(tail.base1, active, 0.5),
          c2 = mix(tail.base2, active, 0.5);
        outline.push(
          { k: "Q", cx: c1.x - dy * bend, cy: c1.y + dx * bend, ...active },
          { k: "Q", cx: c2.x - dy * bend, cy: c2.y + dx * bend, ...tail.base2 },
        );
      }
      outline.push({ k: "Z" });
    }
  }
  if (!outline.length) {
    outline.push({ k: "M", ...item(curves, 0)[0] });
    append(0, curves.length);
    outline.push({ k: "Z" });
  }
  if (active && options.style === "beads") {
    const d = distance(anchor, active),
      size = Math.min(Math.min(width, height) * 0.055, d * 0.11);
    for (const [t, scale] of [
      [0.26, 1],
      [0.63, 0.68],
      [1, 0.4],
    ] as const) {
      const c = mix(anchor, active, t),
        r = size * scale;
      const bead = contour("oval", 0, 0).map(
        (segment) =>
          segment.map((p) => ({
            x: c.x + (p.x - 0.5) * r * 2,
            y: c.y + (p.y - 0.5) * r * 2,
          })) as Curve,
      );
      outline.push({ k: "M", ...item(bead, 0)[0] }, ...bead.map(command), { k: "Z" });
    }
  }
  const accents: BalloonCommand[] = [];
  if (shape === "radial") {
    const angle = active
      ? Math.atan2((active.y - y - height / 2) / height, (active.x - x - width / 2) / width)
      : null;
    const point = (a: number, r: number) => ({
      x: x + width / 2 + (width / 2) * r * Math.cos(a),
      y: y + height / 2 + (height / 2) * r * Math.sin(a),
    });
    for (let i = 0; i < 96; i++) {
      const a = (i * TAU) / 96;
      if (
        angle !== null &&
        options.style !== "beads" &&
        Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) < 0.13
      )
        continue;
      const inner = 0.76 + (i % 5) * 0.008,
        outer = 0.9 + ((i * 7) % 11) * 0.01;
      accents.push(
        { k: "M", ...point(a - 0.012, inner) },
        { k: "L", ...point(a, outer) },
        { k: "L", ...point(a + 0.013, inner) },
        { k: "Z" },
      );
    }
  }
  return { outline, tail, accents };
}

export function balloonTextInset(shape: BalloonShape): number {
  if (shape === "rectangle" || shape === "rounded") return 0;
  if (shape === "soft" || shape === "electric") return 0.12;
  if (shape === "burst-box") return 0.16;
  if (shape === "radial") return 0.27;
  if (shape === "burst" || shape === "spikes") return 0.23;
  if (shape === "cloud" || shape === "wobble") return 0.2;
  return 0.18;
}
