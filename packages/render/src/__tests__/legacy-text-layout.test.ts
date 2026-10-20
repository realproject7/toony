// Converting an older overlay to an explicit text layout keeps its size and
// line breaks, so a sound effect the agent lettered does not shrink when the
// person starts typing on it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLetteringTextLayout } from "@toony/schema";
import { layoutBubble } from "../layout.js";
import { legacyTextLayout } from "../legacy-text-layout.js";
import { overlay } from "./fixtures.js";

const cases = [
  {
    kind: "sfx" as const,
    text: "쏴아아—",
    geometry: { x: 0.08, y: 0.25, width: 0.84, height: 0.16 },
  },
  {
    kind: "narration" as const,
    text: "새벽 2시. 오늘도 손님은 없다.",
    geometry: { x: 0.08, y: 0.07, width: 0.84, height: 0.16 },
  },
  {
    kind: "speech" as const,
    text: "……어? 너 거기서 뭐 해.",
    geometry: { x: 0.2, y: 0.5, width: 0.5, height: 0.18 },
  },
];

test("an older overlay converts to an editable layout of about the same size", () => {
  for (const sample of cases)
    for (const cut of [
      { width: 832, height: 1216 },
      { width: 800, height: 1700 },
    ]) {
      const legacy = overlay({ id: `ov-${sample.kind}`, ...sample });
      // textRanges makes it the editable layout the cut editor types into.
      const converted = {
        ...legacy,
        textLayout: legacyTextLayout(legacy, cut, 800),
        textRanges: [],
      };
      const before = layoutBubble(legacy, cut.width, cut.height);
      const after = layoutBubble(converted, cut.width, cut.height);
      const change = Math.abs(after.text.fontSize - before.text.fontSize) / before.text.fontSize;
      assert.ok(
        change <= 0.05,
        `${sample.kind} ${cut.height}: ${before.text.fontSize} became ${after.text.fontSize}`,
      );
      assert.ok(
        after.lines.every((line) => line.sourceStart !== undefined),
        "editable offsets",
      );
    }
  // The editable fit may wrap a line differently; where it does not, the
  // visible lines are the same (a wrapped line keeps a trailing space).
  const sfx = overlay({ id: "ov-sfx", ...cases[0] });
  const cut = { width: 832, height: 1216 };
  const visible = (lines: readonly string[]) => lines.map((line) => line.trimEnd());
  assert.deepEqual(
    visible(
      layoutBubble(
        { ...sfx, textLayout: legacyTextLayout(sfx, cut, 800), textRanges: [] },
        832,
        1216,
      ).text.lines,
    ),
    visible(layoutBubble(sfx, 832, 1216).text.lines),
  );
});

test("the fixed default is what shrank large lettering, and the converted range keeps it", () => {
  const sfx = overlay({ id: "ov-sfx", ...cases[0] });
  const cut = { width: 832, height: 1216 };
  const shrunk = layoutBubble(
    { ...sfx, textLayout: defaultLetteringTextLayout(800), textRanges: [] },
    cut.width,
    cut.height,
  );
  const kept = layoutBubble(
    { ...sfx, textLayout: legacyTextLayout(sfx, cut, 800), textRanges: [] },
    cut.width,
    cut.height,
  );
  assert.ok(kept.text.fontSize > shrunk.text.fontSize * 1.5);
});
