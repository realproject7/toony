import assert from "node:assert/strict";
import { test } from "node:test";

import { cloneValidProject, validProject } from "../__fixtures__/valid-project.js";
import { parseProject, serializeProject } from "../serialize.js";
import { validateProject } from "../validate.js";

test("round-trips a valid project without data loss", () => {
  const restored = parseProject(serializeProject(validProject));
  assert.deepEqual(restored, validProject);
});

test("serialization is deterministic regardless of key order", () => {
  const reordered = cloneValidProject();
  // Rebuild the webtoon object with keys in a different insertion order.
  reordered.webtoon = {
    title: reordered.webtoon.title,
    imageProviders: reordered.webtoon.imageProviders,
    languages: reordered.webtoon.languages,
    projectId: reordered.webtoon.projectId,
    schemaVersion: reordered.webtoon.schemaVersion,
  };
  assert.equal(serializeProject(reordered), serializeProject(validProject));
});

test("re-serializing parsed output is byte-stable", () => {
  const once = serializeProject(validProject);
  const twice = serializeProject(parseProject(once));
  assert.equal(once, twice);
});

test("serialized output ends with a trailing newline", () => {
  assert.ok(serializeProject(validProject).endsWith("\n"));
});

test("a round-tripped project still validates", () => {
  const restored = parseProject(serializeProject(validProject));
  assert.equal(validateProject(restored).valid, true);
});
