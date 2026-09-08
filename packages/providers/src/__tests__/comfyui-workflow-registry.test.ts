// Workflow resolution BY NAME (#192). The registry is injected as plain data —
// name to local file path — so this package resolves a named workflow without
// depending on the pack loader. With no name requested, the pre-existing
// precedence chain must be untouched.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { COMFYUI_DEFAULT_LOCAL_URL, resolveComfyUIConfig } from "../comfyui-config.js";
import { ProviderError } from "../errors.js";

const ENV = { TOONY_COMFYUI_URL: COMFYUI_DEFAULT_LOCAL_URL };

async function writeGraph(steps: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toony-wf-"));
  const file = join(dir, "graph.json");
  await writeFile(
    file,
    JSON.stringify({
      "3": { class_type: "KSampler", inputs: { seed: 0, steps } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    }),
  );
  return file;
}

test("a requested workflow name resolves from the injected registry", async () => {
  const file = await writeGraph(40);
  const config = await resolveComfyUIConfig({
    env: ENV,
    workflows: new Map([["high-detail", file]]),
    workflowName: "high-detail",
  });
  assert.equal(config.workflow["3"]?.inputs.steps, 40);
});

test("an unknown workflow name fails with the available names, never a silent fallback", async () => {
  const file = await writeGraph(40);
  try {
    await resolveComfyUIConfig({
      env: ENV,
      workflows: new Map([["high-detail", file]]),
      workflowName: "nope",
    });
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "comfyui.unknown-workflow");
    assert.match(error.message, /available: high-detail/);
  }
});

test("a name requested with no registry installed fails clearly", async () => {
  try {
    await resolveComfyUIConfig({ env: ENV, workflowName: "high-detail" });
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "comfyui.unknown-workflow");
    assert.match(error.message, /no named workflows are installed/);
  }
});

test("a name beats a lower-precedence env workflow path", async () => {
  const named = await writeGraph(40);
  const fromEnv = await writeGraph(11);
  const config = await resolveComfyUIConfig({
    env: { ...ENV, TOONY_COMFYUI_WORKFLOW: fromEnv },
    workflows: new Map([["high-detail", named]]),
    workflowName: "high-detail",
  });
  assert.equal(config.workflow["3"]?.inputs.steps, 40);
});

test("an inline override graph still beats a requested name", async () => {
  const named = await writeGraph(40);
  const config = await resolveComfyUIConfig({
    env: ENV,
    overrides: { workflow: { "3": { class_type: "KSampler", inputs: { steps: 1 } } } },
    workflows: new Map([["high-detail", named]]),
    workflowName: "high-detail",
  });
  assert.equal(config.workflow["3"]?.inputs.steps, 1);
});

// --- The zero-pack path -----------------------------------------------------

test("with no name requested the resolved config is identical with or without a registry", async () => {
  const named = await writeGraph(40);
  const withoutRegistry = await resolveComfyUIConfig({ env: ENV });
  const withRegistry = await resolveComfyUIConfig({
    env: ENV,
    workflows: new Map([["high-detail", named]]),
  });
  assert.deepEqual(withRegistry, withoutRegistry);
  // And it is still the bundled default graph.
  assert.equal(withoutRegistry.workflow["3"]?.class_type, "KSampler");
  assert.equal(withoutRegistry.workflow["4"]?.class_type, "CheckpointLoaderSimple");
});

test("with no name requested an env workflow path still wins, exactly as before", async () => {
  const named = await writeGraph(40);
  const fromEnv = await writeGraph(11);
  const config = await resolveComfyUIConfig({
    env: { ...ENV, TOONY_COMFYUI_WORKFLOW: fromEnv },
    workflows: new Map([["high-detail", named]]),
  });
  assert.equal(config.workflow["3"]?.inputs.steps, 11);
});
