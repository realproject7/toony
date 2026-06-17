import assert from "node:assert/strict";
import { test } from "node:test";

import { makeValidProject } from "../__fixtures__/project.js";
import { lintProjectSchema } from "../schema-lint.js";

test("a valid project yields no schema findings", () => {
  assert.deepEqual(lintProjectSchema(makeValidProject()), []);
});

test("schema findings are errors namespaced under schema/", () => {
  const project = makeValidProject();
  project.episodes[0]?.episode.sequence.push({ type: "cut", id: "cut-missing" });
  const findings = lintProjectSchema(project);
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.equal(f.severity, "error");
    assert.ok(f.code.startsWith("schema/"));
    assert.ok(f.targetId.length > 0);
    assert.ok(f.message.length > 0);
  }
  assert.ok(findings.some((f) => f.code === "schema/sequence.missing-cut"));
});

test("the finding target id carries the validator path", () => {
  const project = makeValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.cuts.push({ id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" });
  const findings = lintProjectSchema(project);
  const dup = findings.find((f) => f.code === "schema/cut.duplicate-id");
  assert.ok(dup);
  assert.ok(dup.targetId.includes("cuts"));
});
