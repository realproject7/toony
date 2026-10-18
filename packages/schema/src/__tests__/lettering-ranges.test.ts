import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import { IssueCollector } from "../errors.js";
import { defaultLetteringTextLayout } from "../lettering-layout.js";
import {
  letteringGraphemeBoundaries,
  reconcileLetteringText,
  replaceLetteringText,
  styleLetteringRange,
  validateLetteringTextRanges,
} from "../lettering-ranges.js";
import { parseProject, serializeProject } from "../serialize.js";
import { validateProject } from "../validate.js";

test("Unicode style ranges survive canonical project persistence with explicit units", () => {
  const project = cloneValidProject(),
    overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  Object.assign(overlay, {
    text: "안녕 👩‍🚀!",
    textLayout: defaultLetteringTextLayout(),
    textRanges: [
      {
        start: 3,
        end: 8,
        style: { fontWeight: 700, fontFamily: "noto-sans-kr", fontSize: 32, textColor: "#bb2233" },
      },
    ],
  });
  assert.equal(validateProject(project).valid, true);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  delete overlay.textLayout;
  assert.ok(validateProject(project).issues.some((i) => i.code === "text-ranges.layout"));
});

test("invalid Unicode boundaries, overlap, unknown styles and invalid values are rejected", () => {
  const good = { start: 1, end: 6, style: { fontWeight: 700 } };
  for (const ranges of [
    null,
    {},
    [{ ...good, end: 2 }],
    [good, good],
    [{ ...good, start: -1 }],
    [{ ...good, style: {} }],
    [{ ...good, style: { italic: true } }],
    [{ ...good, style: { fontWeight: 900 } }],
    [{ ...good, style: { fontFamily: "unknown" } }],
    [{ ...good, style: { fontSize: 0 } }],
    [{ ...good, style: { textColor: "red" } }],
    Array(2049).fill(good),
  ]) {
    const c = new IssueCollector();
    validateLetteringTextRanges(ranges, "A👩‍🚀B", "ranges", c);
    assert.equal(c.result().valid, false);
  }
});

test("formatting splits, merges and clears overrides without changing plain text", () => {
  const a = styleLetteringRange({ text: "abcd" }, 0, 4, { fontWeight: 700 });
  const b = styleLetteringRange(a, 1, 3, { textColor: "#ff0000" });
  assert.equal(b.textRanges?.length, 3);
  assert.deepEqual(styleLetteringRange(b, 1, 3, { textColor: null }), a);
  assert.deepEqual(styleLetteringRange(a, 0, 4, { fontWeight: null }), {
    text: "abcd",
    textRanges: [],
  });
  assert.throws(() => styleLetteringRange(a, 0, 1, { fontSize: NaN }));
});

test("italic range inheritance and bounded transparent gradients round trip without changing text", () => {
  const project = cloneValidProject(),
    overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  Object.assign(overlay, {
    textLayout: defaultLetteringTextLayout(),
    fontStyle: "italic",
    ...styleLetteringRange({ text: "Hello 안녕" }, 6, 8, { fontStyle: "normal" }),
    fillGradient: {
      angle: 35,
      stops: [
        { offset: 0, color: "#ffffff00" },
        { offset: 0.3, color: "#ddffee" },
        { offset: 1, color: "#112233cc" },
      ],
    },
  });
  assert.equal(validateProject(project).valid, true);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.equal(
    replaceLetteringText(overlay, 7, 8, "하세요").textRanges?.[0]?.style.fontStyle,
    "normal",
  );
  delete overlay.textLayout;
  assert.ok(validateProject(project).issues.some((i) => i.code === "style.font-style-layout"));
});

test("invalid gradient coordinates, stops, colors and text styles are rejected", () => {
  const project = cloneValidProject(),
    overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  const stop = { offset: 0, color: "#ffffff" },
    last = { offset: 1, color: "#222222" };
  for (const gradient of [
    false,
    {},
    { angle: NaN, stops: [stop, last] },
    { angle: 360, stops: [stop, last] },
    { angle: -1, stops: [stop, last] },
    { angle: 0, stops: [stop] },
    { angle: 0, stops: Array(9).fill(stop) },
    { angle: 0, stops: [last, stop] },
    { angle: 0, stops: [{ offset: -0.1, color: "#ffffff" }, last] },
    { angle: 0, stops: [stop, { offset: 1.1, color: "#ffffff" }] },
    { angle: 0, stops: [stop, { offset: 1, color: "url(file)" }] },
  ]) {
    Object.assign(overlay, { fillGradient: gradient });
    assert.equal(validateProject(project).valid, false, JSON.stringify(gradient));
  }
  Object.assign(overlay, {
    fillGradient: null,
    fontStyle: "oblique",
    textLayout: defaultLetteringTextLayout(),
  });
  assert.equal(validateProject(project).valid, false);
  assert.throws(() =>
    styleLetteringRange({ text: "abc" }, 0, 1, { fontStyle: "invalid" } as never),
  );
});

test("insert, replace and delete preserve unaffected ranges and defined inheritance", () => {
  const doc = {
    text: "ab CD",
    textRanges: [
      { start: 0, end: 2, style: { fontWeight: 700 as const } },
      { start: 3, end: 5, style: { textColor: "#ff0000" } },
    ],
  };
  const inserted = replaceLetteringText(doc, 2, 2, "!");
  assert.deepEqual(inserted.textRanges, [
    { start: 0, end: 3, style: { fontWeight: 700 } },
    { start: 4, end: 6, style: { textColor: "#ff0000" } },
  ]);
  assert.deepEqual(replaceLetteringText(inserted, 2, 3, ""), doc);
  assert.deepEqual(replaceLetteringText(doc, 1, 4, "XY").textRanges, [
    { start: 0, end: 3, style: { fontWeight: 700 } },
    { start: 3, end: 4, style: { textColor: "#ff0000" } },
  ]);
  assert.deepEqual(replaceLetteringText(doc, 0, 5, ""), { text: "", textRanges: [] });
});

test("combining input and emoji edits retain whole graphemes", () => {
  const doc = styleLetteringRange({ text: "e 👩‍🚀!" }, 0, 1, { fontWeight: 700 });
  const changed = reconcileLetteringText(doc, "é 👩‍🚀!");
  assert.deepEqual(changed.textRanges, [{ start: 0, end: 2, style: { fontWeight: 700 } }]);
  assert.deepEqual(letteringGraphemeBoundaries(changed.text), [0, 2, 3, 8, 9]);
  assert.throws(() => replaceLetteringText(changed, 4, 5, ""));
  assert.equal(replaceLetteringText(changed, 3, 8, "🙂").text, "é 🙂!");
});

test("native Korean composition and multiline edits keep surrounding style ranges", () => {
  const doc = styleLetteringRange({ text: "가나다\nHello" }, 4, 9, { textColor: "#112233" });
  let current = doc;
  for (const text of ["가ㄴ다\nHello", "가나다\nHello", "가나나다\nHello"])
    current = reconcileLetteringText(current, text);
  assert.deepEqual(current.textRanges, [{ start: 5, end: 10, style: { textColor: "#112233" } }]);
  assert.deepEqual(reconcileLetteringText({ text: "plain" }, "plain!"), { text: "plain!" });
});
