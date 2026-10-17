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

test("a declared panel shape survives the round trip (#237)", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  // A fractional height, because that is what a measured band asks for and a
  // lossy round trip would quietly re-shape the panel.
  cut.panelAspect = 1.4327;
  const restored = parseProject(serializeProject(project));
  assert.equal(restored.episodes[0]?.cuts[0]?.panelAspect, 1.4327);
  assert.deepEqual(restored, project);
  assert.equal(validateProject(restored).valid, true);
});
