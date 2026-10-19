import assert from "node:assert/strict";
import { test } from "node:test";
import { BALLOON_SHAPES, defaultLetteringTextLayout, TAIL_STYLES } from "@toony/schema";
import { authoredBalloon } from "../authored-balloon.js";
import { layoutBubble } from "../layout.js";
import { overlay } from "./fixtures.js";

const box = { x: 100, y: 100, width: 300, height: 180 };

test("every authored contour supports independent tails in every direction at both output scales", () => {
  for (const shape of BALLOON_SHAPES)
    for (const style of TAIL_STYLES)
      for (const tip of [
        { x: 50, y: 80 },
        { x: 500, y: 180 },
        { x: 250, y: 380 },
        { x: 30, y: 230 },
      ]) {
        const a = authoredBalloon(box, shape, tip, 24, { style, width: 0.2, bend: -0.5 });
        const b = authoredBalloon(
          { x: 200, y: 200, width: 600, height: 360 },
          shape,
          { x: tip.x * 2, y: tip.y * 2 },
          48,
          { style, width: 0.2, bend: -0.5 },
        );
        assert.equal(a.tail !== null, style !== "none", `${shape}:${style}`);
        assert.equal(a.outline.filter((c) => c.k === "M").length, style === "beads" ? 4 : 1);
        assert.equal(a.outline.filter((c) => c.k === "Z").length, style === "beads" ? 4 : 1);
        assert.equal(a.outline.length, b.outline.length);
        [...a.outline, ...a.accents].forEach((command, index) => {
          const scaled = [...b.outline, ...b.accents][index] as unknown as Record<string, unknown>;
          for (const [key, value] of Object.entries(command))
            if (typeof value === "number") {
              assert.ok(Number.isFinite(value));
              assert.ok(
                Math.abs(Number(scaled[key]) - value * 2) < 1e-7,
                `${shape}:${style}:${key}`,
              );
            }
        });
      }
});

test("explicit no-tail suppresses normal and off-panel targets for every semantic kind", () => {
  for (const kind of ["speech", "thought", "shout", "whisper", "narration"] as const) {
    const b = overlay({
      id: "tail",
      kind,
      balloonShape: "oval",
      tailStyle: "none",
      tail: { x: 0.9, y: 0.9 },
      tailTarget: { x: -1, y: 0.8 },
    });
    const a = layoutBubble(b, 800, 1200);
    const cleared = layoutBubble({ ...b, tail: null, tailTarget: null }, 800, 1200);
    assert.equal(a.tail, null);
    assert.equal(a.pathD, cleared.pathD);
  }
});

test("tail styles are independent from semantic kind, and shape bodies remain still for thought dots", () => {
  for (const shape of BALLOON_SHAPES) {
    const b = overlay({
      id: "tail",
      balloonShape: shape,
      tailStyle: "straight",
      tail: { x: 0.9, y: 0.9 },
    });
    assert.equal(
      layoutBubble(b, 800, 1200).pathD,
      layoutBubble({ ...b, kind: "thought" }, 800, 1200).pathD,
    );
    const body = (tip: { x: number; y: number }) => {
      const a = authoredBalloon(box, shape, tip, 24, { style: "beads" }).outline;
      return a.slice(0, a.findIndex((c) => c.k === "Z") + 1);
    };
    assert.deepEqual(body({ x: 500, y: 200 }), body({ x: 220, y: 400 }));
  }
});

test("tail width and signed curvature change the pointer without changing its target", () => {
  const tip = { x: 280, y: 380 };
  const narrow = authoredBalloon(box, "soft", tip, 24, {
    style: "curved",
    width: 0.06,
    bend: -0.7,
  });
  const wide = authoredBalloon(box, "soft", tip, 24, { style: "curved", width: 0.4, bend: 0.7 });
  assert.ok(narrow.tail && wide.tail);
  assert.deepEqual(narrow.tail.tip, wide.tail.tip);
  assert.ok(
    Math.hypot(wide.tail.base1.x - wide.tail.base2.x, wide.tail.base1.y - wide.tail.base2.y) >
      Math.hypot(
        narrow.tail.base1.x - narrow.tail.base2.x,
        narrow.tail.base1.y - narrow.tail.base2.y,
      ) *
        3,
  );
  assert.notDeepEqual(narrow.outline, wide.outline);
});

test("radial emphasis has a quiet text center and separate deterministic filled rays", () => {
  const a = layoutBubble(
    overlay({
      id: "radial",
      balloonShape: "radial",
      tailStyle: "none",
      text: "잠깐, 이건...",
      textLayout: defaultLetteringTextLayout(800),
      textRanges: [],
      verticalAlign: "middle",
    }),
    800,
    1200,
  );
  assert.equal(a.accents?.filter((c) => c.k === "Z").length, 96);
  assert.ok(a.accentPathD);
  assert.equal(a.strokeWidth, 0);
  assert.equal(a.text.overflow, false);
  assert.ok(a.textOrigin.x >= a.box.x + a.box.width * 0.27);
});

test("all authored shapes preserve text wrapping and fitting across export widths", () => {
  for (const balloonShape of BALLOON_SHAPES) {
    const b = overlay({
      id: "wrap",
      balloonShape,
      tailStyle: "none",
      text: "우리 다시 만나요.\nSee you soon.",
      textLayout: defaultLetteringTextLayout(800),
      textRanges: [],
      verticalAlign: "middle",
    });
    const a = layoutBubble(b, 800, 1200),
      scaled = layoutBubble(b, 1600, 2400);
    assert.deepEqual(a.text.lines, scaled.text.lines, balloonShape);
    assert.equal(a.text.fontSize * 2, scaled.text.fontSize, balloonShape);
    assert.equal(a.text.overflow, false, balloonShape);
  }
});

test("an explicit tail style opts a legacy kind into a usable default contour", () => {
  const b = overlay({
    id: "legacy-choice",
    kind: "thought",
    tailStyle: "straight",
    tail: { x: 0.9, y: 0.8 },
  });
  const plan = layoutBubble(b, 800, 1200);
  assert.ok(plan.tail);
  assert.equal(plan.pathD, layoutBubble({ ...b, balloonShape: "oval" }, 800, 1200).pathD);
});
