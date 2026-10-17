import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import { IssueCollector } from "../errors.js";
import { defaultLetteringTextLayout, validateLetteringTextLayout } from "../lettering-layout.js";
import { parseProject, serializeProject } from "../serialize.js";
import { validateProject } from "../validate.js";

test("explicit text layout validates and survives a canonical project round trip", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.textLayout = defaultLetteringTextLayout(1080);
  overlay.fontSize = 28;
  assert.equal(validateProject(project).valid, true);
  assert.deepEqual(parseProject(serializeProject(project)), project);
});

test("text layout rejects malformed versions, units, padding and inverted fit bounds", () => {
  const base = defaultLetteringTextLayout();
  for (const value of [
    null,
    [],
    {},
    { ...base, version: 2 },
    { ...base, referenceWidth: 0 },
    { ...base, paddingX: 0.5 },
    { ...base, paddingY: NaN },
    { ...base, minFontSize: 0 },
    { ...base, minFontSize: 40, maxFontSize: 20 },
    { ...base, surprise: true },
  ]) {
    const c = new IssueCollector();
    validateLetteringTextLayout(value, "layout", c);
    assert.equal(c.result().valid, false, JSON.stringify(value));
  }
});
