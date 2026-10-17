import assert from "node:assert/strict";
import { test } from "node:test";
import { validProject } from "../__fixtures__/valid-project.js";
import { REVIEW_STATUSES } from "../types.js";
import { validateProject } from "../validate.js";

test("cut review is optional without mutating legacy records", () => {
  const project = structuredClone(validProject);
  const before = JSON.stringify(project);
  assert.equal(validateProject(project).valid, true);
  assert.equal(JSON.stringify(project), before);
  assert.equal(Object.hasOwn(project.episodes[0]?.cuts[0] ?? {}, "reviewStatus"), false);
});

test("all three review states validate for cuts, including imageless cuts", () => {
  assert.deepEqual(REVIEW_STATUSES, ["draft", "human-edited", "final"]);
  for (const reviewStatus of REVIEW_STATUSES) {
    const project = structuredClone(validProject);
    const cut = project.episodes[0]?.cuts[0];
    assert.ok(cut);
    cut.image = null;
    cut.reviewStatus = reviewStatus;
    assert.equal(validateProject(project).valid, true, reviewStatus);
  }
});

test("unknown, null, and non-string cut review values are rejected", () => {
  for (const reviewStatus of ["rejected", "", null, 1, {}, []]) {
    const project = structuredClone(validProject);
    Object.assign(project.episodes[0]?.cuts[0] ?? {}, { reviewStatus });
    const result = validateProject(project);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.code === "cut.review-status"));
  }
});
