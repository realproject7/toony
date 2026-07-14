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

test("workspace config (.toony/config.json) supplies the endpoint when env is unset", async () => {
  const config = await resolveComfyUIConfig({
    env: {},
    toonyConfig: {
      endpoint: COMFYUI_DEFAULT_LOCAL_URL,
      checkpoint: "ws.safetensors",
      workflow: null,
    },
  });
  assert.equal(config.url, COMFYUI_DEFAULT_LOCAL_URL);
  assert.equal(config.checkpoint, "ws.safetensors");
});

test("env overrides the workspace config endpoint and checkpoint", async () => {
  const config = await resolveComfyUIConfig({
    env: {
      TOONY_COMFYUI_URL: "http://127.0.0.1:7777",
      TOONY_COMFYUI_CHECKPOINT: "env.safetensors",
    },
    toonyConfig: {
      endpoint: COMFYUI_DEFAULT_LOCAL_URL,
      checkpoint: "ws.safetensors",
      workflow: null,
    },
  });
  assert.equal(config.url, "http://127.0.0.1:7777");
  assert.equal(config.checkpoint, "env.safetensors");
});

test("per-field precedence: env url wins, workspace checkpoint still applies", async () => {
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_URL: "http://127.0.0.1:7777" },
    toonyConfig: {
      endpoint: COMFYUI_DEFAULT_LOCAL_URL,
      checkpoint: "ws.safetensors",
      workflow: null,
    },
  });
  assert.equal(config.url, "http://127.0.0.1:7777");
  assert.equal(config.checkpoint, "ws.safetensors");
});

test("the TOONY_COMFYUI_CONFIG file outranks the workspace config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-cfg-"));
  const configPath = join(dir, "comfyui.json");
  await writeFile(configPath, JSON.stringify({ url: "http://127.0.0.1:5555" }));
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_CONFIG: configPath },
    toonyConfig: {
      endpoint: COMFYUI_DEFAULT_LOCAL_URL,
      checkpoint: null,
      workflow: null,
    },
  });
  assert.equal(config.url, "http://127.0.0.1:5555");
});

test("workspace config workflow path is loaded when no env/file workflow is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-cfg-"));
  const workflowPath = join(dir, "ws.json");
  await writeFile(
    workflowPath,
    JSON.stringify({ "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } }),
  );
  const config = await resolveComfyUIConfig({
    env: {},
    toonyConfig: {
      endpoint: COMFYUI_DEFAULT_LOCAL_URL,
      checkpoint: null,
      workflow: workflowPath,
    },
  });
  assert.equal(config.workflow["6"]?.class_type, "CLIPTextEncode");
});

// --- Workflow precedence matrix (#155): override > env path > config-file
// (inline ?? path) > workspace path > bundled default. --------------------------

/** A workflow graph identifiable by a unique class_type marker. */
function graph(marker: string) {
  return { "1": { class_type: marker, inputs: {} } };
}
async function writeGraph(dir: string, name: string, marker: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, JSON.stringify(graph(marker)));
  return p;
}

/** Build a config-file + workspace scenario with all four workflow sources present. */
async function fourSourceScenario(opts: { configInline: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-prec-"));
  const envPath = await writeGraph(dir, "env.json", "ENV_PATH");
  const filePath = await writeGraph(dir, "file.json", "CONFIG_PATH");
  const wsPath = await writeGraph(dir, "ws.json", "WS_PATH");
  const configPath = join(dir, "cfg.json");
  await writeFile(
    configPath,
    JSON.stringify({
      url: COMFYUI_DEFAULT_LOCAL_URL,
      ...(opts.configInline ? { workflow: graph("CONFIG_INLINE") } : {}),
      workflowPath: filePath,
    }),
  );
  return { envPath, configPath, wsPath };
}

test("workflow precedence: inline override beats every lower source (#155)", async () => {
  const s = await fourSourceScenario({ configInline: true });
  const config = await resolveComfyUIConfig({
    env: {
      TOONY_COMFYUI_URL: COMFYUI_DEFAULT_LOCAL_URL,
      TOONY_COMFYUI_WORKFLOW: s.envPath,
      TOONY_COMFYUI_CONFIG: s.configPath,
    },
    toonyConfig: { endpoint: COMFYUI_DEFAULT_LOCAL_URL, checkpoint: null, workflow: s.wsPath },
    overrides: { workflow: graph("OVERRIDE") },
  });
  assert.equal(config.workflow["1"]?.class_type, "OVERRIDE");
});

test("workflow precedence: env path beats config-file and workspace (#155)", async () => {
  const s = await fourSourceScenario({ configInline: true });
  const config = await resolveComfyUIConfig({
    env: {
      TOONY_COMFYUI_URL: COMFYUI_DEFAULT_LOCAL_URL,
      TOONY_COMFYUI_WORKFLOW: s.envPath,
      TOONY_COMFYUI_CONFIG: s.configPath,
    },
    toonyConfig: { endpoint: COMFYUI_DEFAULT_LOCAL_URL, checkpoint: null, workflow: s.wsPath },
  });
  assert.equal(config.workflow["1"]?.class_type, "ENV_PATH");
});

test("workflow precedence: config-file INLINE graph beats a workspace path (#155 bug)", async () => {
  // The regression: a stale workspace `.toony/config.json` workflow PATH must NOT
  // beat the config file's inline graph (no override, no env path).
  const s = await fourSourceScenario({ configInline: true });
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_CONFIG: s.configPath },
    toonyConfig: { endpoint: COMFYUI_DEFAULT_LOCAL_URL, checkpoint: null, workflow: s.wsPath },
  });
  assert.equal(config.workflow["1"]?.class_type, "CONFIG_INLINE");
});

test("workflow precedence: config-file PATH beats a workspace path (#155)", async () => {
  // No config inline graph → the config-file workflowPath wins over the ws path.
  const s = await fourSourceScenario({ configInline: false });
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_CONFIG: s.configPath },
    toonyConfig: { endpoint: COMFYUI_DEFAULT_LOCAL_URL, checkpoint: null, workflow: s.wsPath },
  });
  assert.equal(config.workflow["1"]?.class_type, "CONFIG_PATH");
});

test("workflow precedence: workspace path is used when nothing higher is set (#155)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-prec-"));
  const wsPath = await writeGraph(dir, "ws.json", "WS_PATH");
  const config = await resolveComfyUIConfig({
    env: {},
    toonyConfig: { endpoint: COMFYUI_DEFAULT_LOCAL_URL, checkpoint: null, workflow: wsPath },
  });
  assert.equal(config.workflow["1"]?.class_type, "WS_PATH");
});

test("workflow precedence: config-file inline beats a stale workspace path (no config path) (#155 headline)", async () => {
  // The exact documented failure: config file pins an INLINE graph, no config
  // workflowPath, but the workspace has a stale workflow PATH. Pre-fix the ws path
  // silently won; now the inline graph does.
  const dir = await mkdtemp(join(tmpdir(), "toony-comfy-prec-"));
  const wsPath = await writeGraph(dir, "ws.json", "WS_PATH");
  const configPath = join(dir, "cfg.json");
  await writeFile(
    configPath,
    JSON.stringify({ url: COMFYUI_DEFAULT_LOCAL_URL, workflow: graph("CONFIG_INLINE") }),
  );
  const config = await resolveComfyUIConfig({
    env: { TOONY_COMFYUI_CONFIG: configPath },
    toonyConfig: { endpoint: COMFYUI_DEFAULT_LOCAL_URL, checkpoint: null, workflow: wsPath },
  });
  assert.equal(config.workflow["1"]?.class_type, "CONFIG_INLINE");
});
