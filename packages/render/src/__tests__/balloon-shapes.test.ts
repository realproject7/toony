import assert from "node:assert/strict";
import { test } from "node:test";
import { BALLOON_SHAPES, defaultLetteringTextLayout } from "@toony/schema";
import { shapedBalloon } from "../balloon-shapes.js";
import { balloonPathD, buildBalloonOutline, speechTailGeometry } from "../geometry.js";
import { layoutBubble } from "../layout.js";
import { overlay } from "./fixtures.js";

const box = { x: 100, y: 100, width: 300, height: 180 };

test("modern shape commands and tail mouths scale with the output, in all directions", () => {
  for (const shape of BALLOON_SHAPES)
    for (const tip of [
      { x: 80, y: 80 },
      { x: 440, y: 220 },
      { x: 200, y: 350 },
      { x: 40, y: 160 },
    ]) {
      const a = shapedBalloon(box, shape, tip, false, 50);
      const b = shapedBalloon(
        { x: 200, y: 200, width: 600, height: 360 },
        shape,
        { x: tip.x * 2, y: tip.y * 2 },
        false,
        100,
      );
      assert.equal(a.outline.length, b.outline.length);
      a.outline.forEach((command, i) => {
        const enlarged = b.outline[i] as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(command)) {
          if (typeof value === "number")
            assert.ok(Math.abs(Number(enlarged[key]) - value * 2) < 1e-8, `${shape}:${key}`);
          else assert.equal(enlarged[key], value);
        }
      });
      assert.deepEqual(b.tail?.tip, { x: tip.x * 2, y: tip.y * 2 });
    }
});

test("oval joins the pointer to one closed curved perimeter without a seam", () => {
  const { outline, tail } = shapedBalloon(box, "oval", { x: 400, y: 330 }, false, 50);
  assert.ok(tail);
  assert.equal(outline.filter((c) => c.k === "M").length, 1);
  assert.equal(outline.filter((c) => c.k === "Z").length, 1);
  assert.ok(outline.some((c) => c.k === "Q" && c.x === tail.tip.x && c.y === tail.tip.y));
  for (const point of [tail.base1, tail.base2]) {
    assert.ok(Math.abs(((point.x - 250) / 150) ** 2 + ((point.y - 190) / 90) ** 2 - 1) < 1e-8);
  }
});

test("thought tails are three closed detached beads, and an inside target hides them", () => {
  for (const shape of ["oval", "cloud"] as const) {
    const plan = shapedBalloon(box, shape, { x: 300, y: 350 }, true, 50);
    assert.equal(plan.outline.filter((c) => c.k === "M").length, 4);
    assert.equal(plan.outline.filter((c) => c.k === "Z").length, 4);
    assert.ok(!plan.outline.some((c) => c.k === "L"));
    const hidden = shapedBalloon(box, shape, { x: 200, y: 200 }, true, 50);
    assert.equal(hidden.tail, null);
    assert.equal(hidden.outline.filter((c) => c.k === "M").length, 1);
  }
});

test("cloud and burst shape the full perimeter with a fixed number of large curves", () => {
  const cloud = shapedBalloon(box, "cloud", null, false, 50);
  const burst = shapedBalloon(box, "burst", null, false, 50);
  assert.equal(cloud.outline.filter((c) => c.k === "Q").length, 12);
  assert.equal(burst.outline.filter((c) => c.k === "Q").length, 14);
  for (const { outline } of [cloud, burst])
    assert.ok(!outline.some((c) => c.k === "A" || c.k === "L"));
});

test("moving a thought tail never rotates or reshapes the cloud body", () => {
  const body = (tip: { x: number; y: number }) => {
    const { outline } = shapedBalloon(box, "cloud", tip, true, 50);
    return outline.slice(0, outline.findIndex((c) => c.k === "Z") + 1);
  };
  assert.deepEqual(body({ x: 200, y: 360 }), body({ x: 500, y: 200 }));
});

test("legacy thought and speech keep their exact outline and tail policy", () => {
  const thought = overlay({ id: "t", kind: "thought", tail: { x: 0.4, y: 0.5 } });
  const t = layoutBubble(thought, 800, 1200);
  assert.equal(t.tail, null);
  assert.equal(
    t.pathD,
    balloonPathD(
      buildBalloonOutline(
        t.box.x,
        t.box.y,
        t.box.width,
        t.box.height,
        null,
        t.cornerRadius,
        "bumpy",
      ),
    ),
  );
  const speech = layoutBubble({ ...thought, kind: "speech" }, 800, 1200);
  const b = speech.box;
  const tail = speechTailGeometry(
    b.x,
    b.y,
    b.width,
    b.height,
    { x: 320, y: 600 },
    speech.cornerRadius,
  );
  assert.equal(
    speech.pathD,
    balloonPathD(buildBalloonOutline(b.x, b.y, b.width, b.height, tail, speech.cornerRadius)),
  );
});

test("curved shapes reserve a safe text rectangle and keep wrapping stable across widths", () => {
  for (const balloonShape of ["oval", "cloud", "burst"] as const) {
    const b = overlay({
      id: "t",
      balloonShape,
      text: "A quiet moment. 조용한 순간.",
      textLayout: defaultLetteringTextLayout(800),
      textRanges: [],
      verticalAlign: "middle",
    });
    const a = layoutBubble(b, 800, 1200),
      doubled = layoutBubble(b, 1600, 2400);
    assert.deepEqual(a.text.lines, doubled.text.lines);
    assert.equal(a.text.fontSize * 2, doubled.text.fontSize);
    assert.ok(a.textOrigin.x >= a.box.x + a.box.width * 0.18);
    assert.equal(a.text.overflow, false);
  }
});

test("whisper dashes require an explicit modern shape and scale with its stroke", () => {
  const b = overlay({ id: "w", kind: "whisper" });
  assert.equal(layoutBubble(b, 800, 1200).strokeDash, undefined);
  const a = layoutBubble({ ...b, balloonShape: "oval" }, 800, 1200);
  assert.deepEqual(a.strokeDash, [a.strokeWidth * 4, a.strokeWidth * 3]);
});
