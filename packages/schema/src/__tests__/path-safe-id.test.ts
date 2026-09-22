import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import type { ValidationResult } from "../errors.js";
import { foldPathSafeId, isPathSafeId } from "../path-safe-id.js";
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

// --- The fold two ids share when a filesystem treats them as one name --------

// The over-aggressive direction FIRST. A fold that merges ids an author can
// tell apart refuses valid work, and there is nothing the author can do about
// it; a fold that misses a pair leaves a hazard the rest of the guard already
// lived with. These pairs are distinct on disk on a case-insensitive APFS
// volume, so the fold must keep them distinct too.
test("foldPathSafeId keeps genuinely distinct ids distinct (#317)", () => {
  for (const [a, b] of [
    ["ep-001", "ep-002"],
    // An accent is a real difference: NFC folds canonical equivalence, and
    // `e` and `\u00e9` are not canonically equivalent.
    ["ep-caf\u00e9", "ep-cafe"],
    // Compatibility equivalence is NOT folded: NFKC would merge these, and so
    // would `Intl.Collator` at accent sensitivity.
    ["ep-\u00b2", "ep-2"],
    ["ep-\u2160", "ep-I"],
    // Dotless i is its own letter outside a Turkic locale, and the filesystem
    // keeps it apart from `i`.
    ["ep-\u0131", "ep-i"],
  ]) {
    assert.ok(a !== undefined && b !== undefined);
    assert.notEqual(
      foldPathSafeId(a),
      foldPathSafeId(b),
      `expected ${JSON.stringify(a)} and ${JSON.stringify(b)} to stay distinct`,
    );
  }
});

test("foldPathSafeId folds case and Unicode normalization form alike (#317)", () => {
  for (const [a, b] of [
    ["ep-A", "ep-a"],
    // Composed e-acute against `e` + combining acute: the same text, two forms.
    ["ep-caf\u00e9", "ep-cafe\u0301"],
    // Both folds at once.
    ["EP-CAF\u00c9", "ep-cafe\u0301"],
  ]) {
    assert.ok(a !== undefined && b !== undefined);
    assert.notEqual(a, b, `${JSON.stringify(a)} and ${JSON.stringify(b)} are the same string`);
    assert.equal(
      foldPathSafeId(a),
      foldPathSafeId(b),
      `expected ${JSON.stringify(a)} and ${JSON.stringify(b)} to fold together`,
    );
  }
});
