// A pack workflow may declare where a reference sheet goes (#327). The manifest
// validator holds the declaration to its shape, and discovery carries it beside
// the workflow's file path so the provider can be told without parsing packs.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadPacks } from "../discover.js";
import { PACK_MANIFEST_FILE, PROJECT_PACKS_DIR } from "../manifest.js";
import { validatePackManifest } from "../validate.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "toony-pack-ref-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function manifest(reference?: unknown) {
  return {
    packFormat: 1,
    id: "refpack",
    name: "Reference pack",
    workflows: [
      {
        name: "ref",
        file: "workflows/ref.workflow.json",
        ...(reference === undefined ? {} : { reference }),
      },
    ],
  };
}

test("a workflow reference is an object with a node and an input, and nothing else", () => {
  assert.deepEqual(validatePackManifest(manifest()).issues, []);
  assert.deepEqual(validatePackManifest(manifest({ node: "10", input: "image" })).issues, []);
  const codes = (reference: unknown) =>
    validatePackManifest(manifest(reference)).issues.map((issue) => issue.code);
  assert.deepEqual(codes("10"), ["pack.workflow.reference"]);
  assert.deepEqual(codes({ node: "10" }), ["pack.workflow.reference"]);
  assert.deepEqual(codes({ node: "", input: "image" }), ["pack.workflow.reference"]);
  const extra = validatePackManifest(manifest({ node: "10", input: "image", type: "image" }));
  assert.ok(
    extra.issues.some((issue) => issue.path === "pack.workflows[0].reference.type"),
    JSON.stringify(extra.issues),
  );
});

test("discovery carries the reference beside the workflow path, and none for a workflow without one", async () => {
  const dir = join(root, PROJECT_PACKS_DIR, "refpack");
  await mkdir(join(dir, "workflows"), { recursive: true });
  const graph = { "10": { class_type: "LoadImage", inputs: { image: "x.png" } } };
  await writeFile(join(dir, "workflows", "ref.workflow.json"), JSON.stringify(graph));
  await writeFile(join(dir, "workflows", "plain.workflow.json"), JSON.stringify(graph));
  await writeFile(
    join(dir, PACK_MANIFEST_FILE),
    JSON.stringify({
      ...manifest({ node: "10", input: "image" }),
      workflows: [
        ...manifest({ node: "10", input: "image" }).workflows,
        { name: "plain", file: "workflows/plain.workflow.json" },
      ],
    }),
  );
  const loaded = await loadPacks(root, {});
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual([...loaded.content.workflows.keys()].sort(), ["plain", "ref"]);
  assert.deepEqual(loaded.content.workflowReferences.get("ref"), { node: "10", input: "image" });
  assert.equal(loaded.content.workflowReferences.has("plain"), false);
});
