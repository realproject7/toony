import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import type { ValidationResult } from "../errors.js";
import { isPathSafeId } from "../path-safe-id.js";
import { validateProject } from "../validate.js";

function codes(result: ValidationResult): string[] {
  return result.issues.map((issue) => issue.code);
}

test("isPathSafeId accepts plain segment ids", () => {
  assert.equal(isPathSafeId("ep-001"), true);
  assert.equal(isPathSafeId("episode_2"), true);
  assert.equal(isPathSafeId("a"), true);
});

test("isPathSafeId rejects traversal, separators, absolute, and empty", () => {
  for (const bad of [
    "",
    ".",
    "..",
    "../../outside",
    "foo/bar",
    "foo\\bar",
    "/etc/passwd",
    "C:\\Windows",
    "with\0nul",
  ]) {
    assert.equal(isPathSafeId(bad), false, `expected ${JSON.stringify(bad)} to be unsafe`);
  }
});

test("isPathSafeId rejects non-strings", () => {
  assert.equal(isPathSafeId(undefined), false);
  assert.equal(isPathSafeId(null), false);
  assert.equal(isPathSafeId(123), false);
});

test("validateProject rejects an episode id that would escape the episodes tree", () => {
  const project = cloneValidProject();
  const first = project.episodes[0];
  assert.ok(first);
  first.episode.id = "../../outside";
  const result = validateProject(project);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("episode.id.unsafe"), JSON.stringify(result.issues));
});

test("validateProject still accepts a normal episode id", () => {
  const project = cloneValidProject();
  const result = validateProject(project);
  assert.ok(
    !codes(result).includes("episode.id.unsafe"),
    `unexpected unsafe-id issue: ${JSON.stringify(result.issues)}`,
  );
});
