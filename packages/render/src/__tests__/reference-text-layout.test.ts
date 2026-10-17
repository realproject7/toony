import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLetteringTextLayout } from "@toony/schema";
import { layoutBubble } from "../layout.js";
import { overlay } from "./fixtures.js";

const bubble = () =>
  overlay({
    id: "reference-fixture",
    text: "A letter before sunrise.\n안녕하세요.",
    verticalAlign: "middle",
    textLayout: defaultLetteringTextLayout(),
    geometry: { x: 0.1, y: 0.1, width: 0.6, height: 0.3 },
  });

test("reference-sized text preserves line breaks and scales geometry with output width", () => {
  const a = layoutBubble(bubble(), 800, 1000),
    b = layoutBubble(bubble(), 1600, 2000);
  assert.deepEqual(a.text.lines, b.text.lines);
  assert.equal(b.text.fontSize, a.text.fontSize * 2);
  for (let i = 0; i < a.lines.length; i++) {
    assert.equal(b.lines[i]?.anchorX, (a.lines[i]?.anchorX ?? 0) * 2);
    assert.equal(b.lines[i]?.baselineY, (a.lines[i]?.baselineY ?? 0) * 2);
  }
});

test("equal-width cuts no longer choose different text sizes because their heights differ", () => {
  const a = bubble(),
    b = bubble();
  b.geometry = { ...b.geometry, height: 0.1 };
  const short = layoutBubble(a, 800, 800),
    tall = layoutBubble(b, 800, 2400);
  assert.deepEqual(short.text, tall.text);
  assert.equal(short.text.fontSize, 30);
});

test("text padding has its own frame and minimum size reports unresolved overflow", () => {
  const value = bubble();
  value.text = "Too many words to fit safely. ".repeat(100);
  value.textLayout = { ...defaultLetteringTextLayout(), paddingX: 0.2, paddingY: 0.25 };
  const plan = layoutBubble(value, 800, 800);
  assert.equal(plan.text.fontSize, 20);
  assert.equal(plan.overflow, true);
  assert.ok(Math.abs(plan.textFrame.width - plan.box.width * 0.6) < 1e-9);
  assert.equal(plan.textFrame.height, plan.box.height * 0.5);
});

test("legacy fixed font sizes keep pixel units without rewriting stored overlay fields", () => {
  const value = bubble();
  delete value.textLayout;
  delete value.verticalAlign;
  value.fontSize = 28;
  const before = structuredClone(value);
  const a = layoutBubble(value, 800, 1000),
    b = layoutBubble(value, 1600, 2000);
  assert.equal(a.text.fontSize, 28);
  assert.equal(b.text.fontSize, 28);
  assert.equal(a.verticalAlign, "top");
  assert.equal(a.lines[0]?.baselineY, undefined);
  assert.deepEqual(value, before);
});
