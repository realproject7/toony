import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  COMFYUI_DEFAULT_LOCAL_URL,
  COMFYUI_DEFAULT_TIMEOUT_MS,
  resolveComfyUIConfig,
} from "../comfyui-config.js";
import { ProviderError } from "../errors.js";

test("resolveComfyUIConfig fails clearly when no endpoint is configured", async () => {
  try {
    await resolveComfyUIConfig({ env: {} });
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "comfyui.no-endpoint");
    assert.match(error.message, /TOONY_COMFYUI_URL/);
  }
});

test("resolveComfyUIConfig reads the endpoint from env and ships the default workflow", async () => {
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_URL: COMFYUI_DEFAULT_LOCAL_URL },
  });
  assert.equal(config.url, COMFYUI_DEFAULT_LOCAL_URL);
  assert.equal(config.timeoutMs, COMFYUI_DEFAULT_TIMEOUT_MS);
  // The bundled default graph is a real ComfyUI API-format workflow.
  assert.equal(config.workflow["3"]?.class_type, "KSampler");
  assert.equal(config.workflow["4"]?.class_type, "CheckpointLoaderSimple");
  assert.equal(config.injectionMap.positiveNode, "6");
});

test("resolveComfyUIConfig normalizes a trailing slash on the URL", async () => {
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_URL: "http://127.0.0.1:8188/" },
  });
  assert.equal(config.url, "http://127.0.0.1:8188");
});

test("resolveComfyUIConfig rejects a malformed endpoint", async () => {
  await assert.rejects(
    () => resolveComfyUIConfig({ env: { TOONY_COMFYUI_URL: "not a url" } }),
    (e: unknown) => e instanceof ProviderError && e.code === "comfyui.bad-endpoint",
  );
});

test("resolveComfyUIConfig loads a workflow template and checkpoint from env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-cfg-"));
  const workflowPath = join(dir, "custom.json");
  await writeFile(
    workflowPath,
    JSON.stringify({ "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } }),
  );
  const config = await resolveComfyUIConfig({
    env: {
      TOONY_COMFYUI_URL: COMFYUI_DEFAULT_LOCAL_URL,
      TOONY_COMFYUI_WORKFLOW: workflowPath,
      TOONY_COMFYUI_CHECKPOINT: "myModel.safetensors",
    },
  });
  assert.equal(config.workflow["6"]?.class_type, "CLIPTextEncode");
  assert.equal(config.checkpoint, "myModel.safetensors");
});

test("resolveComfyUIConfig reads a JSON config file and merges the injection map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-cfg-"));
  const configPath = join(dir, "comfyui.json");
  await writeFile(
    configPath,
    JSON.stringify({
      url: COMFYUI_DEFAULT_LOCAL_URL,
      timeoutMs: 60000,
      injectionMap: { positiveNode: "42", positiveInput: "prompt" },
    }),
  );
  const config = await resolveComfyUIConfig({ env: { TOONY_COMFYUI_CONFIG: configPath } });
  assert.equal(config.url, COMFYUI_DEFAULT_LOCAL_URL);
  assert.equal(config.timeoutMs, 60000);
  assert.equal(config.injectionMap.positiveNode, "42");
  assert.equal(config.injectionMap.positiveInput, "prompt");
  // Unspecified map fields fall back to defaults.
  assert.equal(config.injectionMap.seedNode, "3");
});

test("env overrides the config file for the endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-cfg-"));
  const configPath = join(dir, "comfyui.json");
  await writeFile(configPath, JSON.stringify({ url: "http://127.0.0.1:9999" }));
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_CONFIG: configPath, TOONY_COMFYUI_URL: COMFYUI_DEFAULT_LOCAL_URL },
  });
  assert.equal(config.url, COMFYUI_DEFAULT_LOCAL_URL);
});
