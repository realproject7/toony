import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLetteringTextLayout, type LetteringOverlay } from "@toony/schema";
import { layoutBubble } from "../layout.js";
import type { MeasureWidth } from "../text.js";

const measure: MeasureWidth = (text, size, weight) =>
  [...text].length * size * (weight === 700 ? 0.7 : 0.5);
measure.metrics = (_text, size) => ({ ascent: size * 0.8, descent: size * 0.2 });
const fixture: LetteringOverlay = {
  id: "range-fixture",
  cutId: "cut-001",
  speaker: "Speaker",
  kind: "speech",
  text: "AA BB\n\n가👩‍🚀",
  textRanges: [
    { start: 0, end: 2, style: { fontSize: 40, fontWeight: 700, textColor: "#ff0000" } },
  ],
  textLayout: defaultLetteringTextLayout(),
  fontSize: 20,
  fontFamily: "noto-sans-kr",
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  overflow: false,
  reviewStatus: "draft",
  verticalAlign: "middle",
  cornerRadius: 0,
};

test("mixed styles, explicit blank lines and Unicode source text share one render plan", () => {
  const p = layoutBubble(fixture, 800, 1000, { measure });
  assert.deepEqual(p.text.lines, ["AA BB", "", "가👩‍🚀"]);
  const first = p.lines[0]?.segments?.[0];
  assert.equal(first?.text, "AA");
  assert.equal(first?.fontSize, 40);
  assert.equal(first?.fontWeight, 700);
  assert.equal(first?.textColor, "#ff0000");
  assert.equal(p.overflow, false);
  assert.ok((p.lines[2]?.baselineY ?? 0) - (p.lines[0]?.baselineY ?? 0) > 48);
});

test("rich wrapping and segment geometry scale identically at two output widths", () => {
  const a = layoutBubble(fixture, 400, 500, { measure });
  const b = layoutBubble(fixture, 800, 1000, { measure });
  assert.deepEqual(a.text.lines, b.text.lines);
  a.lines.forEach((line, i) => {
    line.segments?.forEach((s, j) => {
      const other = b.lines[i]?.segments?.[j];
      assert.ok(other);
      assert.equal(s.x * 2, other.x);
      assert.equal(s.fontSize * 2, other.fontSize);
      assert.equal(s.baselineY * 2, other.baselineY);
    });
  });
});

test("range sizes participate in bounded fit and unresolved overflow stays visible", () => {
  const b = {
    ...fixture,
    text: "WWWWWWWWWWWW",
    fontSize: undefined,
    textRanges: [{ start: 0, end: 12, style: { fontSize: 80 } }],
    geometry: { x: 0, y: 0, width: 0.12, height: 0.1 },
  };
  const p = layoutBubble(b, 800, 800, { measure });
  assert.equal(p.text.fontSize, 20);
  assert.ok((p.lines[0]?.segments?.[0]?.fontSize ?? 80) < 80);
  assert.equal(p.overflow, true);
});

test("mixed-size baselines use shared font metrics independent of platform ink rounding", () => {
  const p = layoutBubble(fixture, 800, 1000, { measure });
  const first = p.lines[0]?.segments?.[0],
    last = p.lines.at(-1)?.segments?.at(-1);
  assert.ok(first && last);
  const alternate: MeasureWidth = (...args) => measure(...args);
  alternate.metrics = (_text, size) => ({ ascent: size, descent: size });
  const other = layoutBubble(fixture, 800, 1000, { measure: alternate });
  assert.deepEqual(p.lines, other.lines);
  for (const textAlign of ["left", "right"] as const) {
    const aligned = layoutBubble({ ...fixture, textAlign }, 800, 1000, { measure });
    const segments = aligned.lines[0]?.segments ?? [];
    if (textAlign === "left") assert.equal(segments[0]?.x, aligned.textFrame.x);
    else
      assert.equal(
        (segments.at(-1)?.x ?? 0) + (segments.at(-1)?.width ?? 0),
        aligned.textFrame.x + aligned.textFrame.width,
      );
  }
});

test("rich wrapping keeps complete emoji clusters and legacy text stays on its previous path", () => {
  const p = layoutBubble(
    {
      ...fixture,
      text: "👩‍🚀👩‍🚀👩‍🚀",
      textRanges: [],
      geometry: { x: 0, y: 0, width: 0.08, height: 0.8 },
    },
    800,
    1000,
    { measure },
  );
  assert.ok(p.text.lines.every((line) => /^(?:👩‍🚀)+$/u.test(line)));
  const old = layoutBubble({ ...fixture, textRanges: undefined }, 800, 1000, { measure });
  assert.ok(old.lines.every((line) => line.segments === undefined));
});

test("wrapping keeps closing punctuation with the preceding grapheme", () => {
  const p = layoutBubble(
    {
      ...fixture,
      text: "Yes. 안녕하세요. 가나다라!",
      textRanges: [],
      geometry: { x: 0, y: 0, width: 0.1, height: 0.8 },
    },
    800,
    1000,
    { measure },
  );
  assert.ok(p.text.lines.length > 1);
  assert.ok(p.text.lines.every((line) => !/^[.!?]/u.test(line)));
});

test("fallback faces participate in measurement and missing clusters remain inspectable", () => {
  const seen = new Set<string>();
  const faceAware: MeasureWidth = (text, size, _weight, family) => {
    seen.add(family ?? "");
    return [...text].length * size * (family === "noto-sans-kr" ? 1 : 0.5);
  };
  const p = layoutBubble(
    { ...fixture, text: "안녕👩‍🚀", textRanges: [], fontFamily: "bangers" },
    800,
    1000,
    { measure: faceAware },
  );
  const runs = p.lines.flatMap((line) => line.segments ?? []);
  assert.ok(seen.has("noto-sans-kr"));
  assert.equal(runs[0]?.fontFamily, "noto-sans-kr");
  assert.equal(runs[0]?.requestedFontFamily, "bangers");
  assert.equal(runs[0]?.width, 40);
  assert.equal(runs.at(-1)?.text, "👩‍🚀");
  assert.deepEqual(runs.at(-1)?.missingCodepoints, [0x1f469, 0x1f680]);
});

test("geometric oblique reserves overhang, scales and can be cleared within an italic body", () => {
  const b = {
    ...fixture,
    text: "Hello world",
    fontStyle: "italic" as const,
    textRanges: [{ start: 6, end: 11, style: { fontStyle: "normal" as const } }],
  };
  const p = layoutBubble(b, 800, 1000, { measure });
  const runs = p.lines[0]?.segments ?? [];
  assert.ok((runs[0]?.skew ?? 0) > 0);
  assert.ok((runs[0]?.textOffsetX ?? 0) > 0);
  assert.equal(runs[1]?.skew, 0);
  assert.ok((runs[0]?.width ?? 0) > measure("Hello ", 20));
  const small = layoutBubble(b, 400, 500, { measure }).lines[0]?.segments?.[0];
  assert.equal((small?.textOffsetX ?? 0) * 2, runs[0]?.textOffsetX);
  assert.equal(small?.skew, runs[0]?.skew);
});

test("linear gradient endpoints use body coordinates and preserve legacy solid plans", () => {
  const b = {
    ...fixture,
    fillGradient: {
      angle: 90,
      stops: [
        { offset: 0, color: "#ffffff00" },
        { offset: 1, color: "#000000" },
      ],
    },
  };
  const p = layoutBubble(b, 800, 1000, { measure });
  const g = p.fillGradient;
  assert.ok(g);
  assert.ok(Math.abs(g.x1 - (p.box.x + p.box.width / 2)) < 1e-6);
  assert.equal(g.y1, p.box.y);
  assert.equal(g.y2, p.box.y + p.box.height);
  assert.deepEqual(g.stops, b.fillGradient.stops);
  assert.equal(layoutBubble(fixture, 800, 1000, { measure }).fillGradient, undefined);
});
