import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import { IssueCollector } from "../errors.js";
import { applyLetteringTheme, validateLetteringThemeValue } from "../lettering-theme.js";
import { BALLOON_SHAPES } from "../types.js";
import { validateLetteringOverlayValue } from "../validate.js";

test("explicit silhouettes validate and round-trip, while invalid shapes are rejected", () => {
  const base = cloneValidProject().episodes[0]?.lettering[0];
  assert.ok(base);
  for (const balloonShape of [...BALLOON_SHAPES, undefined, "square", null, 3]) {
    const value = JSON.parse(JSON.stringify({ ...base, balloonShape }));
    const collector = new IssueCollector();
    validateLetteringOverlayValue(value, "overlay", collector);
    assert.equal(
      collector.result().issues.some((issue) => issue.code === "overlay.balloon-shape"),
      ![...BALLOON_SHAPES, undefined].includes(balloonShape as never),
    );
  }
});

test("themes carry explicit silhouettes only on intentional application", () => {
  const base = cloneValidProject().episodes[0]?.lettering[0];
  assert.ok(base);
  const theme = { themeFormat: 1, kinds: { speech: { balloonShape: "oval" as const } } };
  assert.deepEqual(validateLetteringThemeValue(theme).issues, []);
  assert.equal(applyLetteringTheme(base, theme).balloonShape, "oval");
  assert.equal(base.balloonShape, undefined);
  assert.ok(
    validateLetteringThemeValue({ ...theme, kinds: { speech: { balloonShape: "invalid" } } }).issues
      .length > 0,
  );
});
