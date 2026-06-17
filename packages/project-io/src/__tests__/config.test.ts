// Tests for the shared workspace config (.toony/config.json).

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  CONFIG_DIR,
  configPath,
  defaultConfig,
  ProjectIoError,
  readConfig,
  type ToonyConfig,
  writeConfig,
} from "../index.js";

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-config-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("missing config returns sane defaults (nothing connected)", async () => {
  const config = await readConfig(workdir);
  assert.deepEqual(config, defaultConfig());
  assert.deepEqual(config, {
    comfyui: { endpoint: null, checkpoint: null, workflow: null },
  });
});

test("write then read round-trips the config", async () => {
  const config: ToonyConfig = {
    comfyui: {
      endpoint: "http://localhost:8188",
      checkpoint: "sd_xl_base_1.0.safetensors",
      workflow: "txt2img",
    },
  };
  await writeConfig(workdir, config);
  assert.deepEqual(await readConfig(workdir), config);
});

test("writeConfig persists to <root>/.toony/config.json", async () => {
  await writeConfig(workdir, defaultConfig());
  const onDisk = JSON.parse(await readFile(configPath(workdir), "utf8"));
  assert.deepEqual(onDisk, defaultConfig());
  assert.match(configPath(workdir), /\.toony[/\\]config\.json$/);
});

test("a partial config fills the remaining fields with defaults", async () => {
  await mkdir(join(workdir, CONFIG_DIR), { recursive: true });
  await writeFile(
    configPath(workdir),
    JSON.stringify({ comfyui: { endpoint: "http://localhost:8188" } }),
    "utf8",
  );
  const config = await readConfig(workdir);
  assert.equal(config.comfyui.endpoint, "http://localhost:8188");
  assert.equal(config.comfyui.checkpoint, null);
  assert.equal(config.comfyui.workflow, null);
});

test("empty-string fields normalize to null on read", async () => {
  await mkdir(join(workdir, CONFIG_DIR), { recursive: true });
  await writeFile(
    configPath(workdir),
    JSON.stringify({ comfyui: { endpoint: "", checkpoint: "", workflow: "" } }),
    "utf8",
  );
  assert.deepEqual(await readConfig(workdir), defaultConfig());
});

test("unknown/extra keys are dropped, not preserved (normalized shape)", async () => {
  await mkdir(join(workdir, CONFIG_DIR), { recursive: true });
  await writeFile(
    configPath(workdir),
    JSON.stringify({ comfyui: { endpoint: "http://localhost:8188", extra: 1 }, stray: true }),
    "utf8",
  );
  const config = await readConfig(workdir);
  assert.deepEqual(config, {
    comfyui: { endpoint: "http://localhost:8188", checkpoint: null, workflow: null },
  });
});

test("malformed config JSON throws an actionable IO error", async () => {
  await mkdir(join(workdir, CONFIG_DIR), { recursive: true });
  await writeFile(configPath(workdir), "{ not valid json", "utf8");
  await assert.rejects(readConfig(workdir), (error: unknown) => {
    assert.ok(error instanceof ProjectIoError);
    assert.match(error.message, /invalid JSON in config/);
    assert.match(error.file, /config\.json$/);
    return true;
  });
});

test("writeConfig output is deterministic (sorted keys, byte-stable)", async () => {
  const config: ToonyConfig = {
    comfyui: { endpoint: "http://localhost:8188", checkpoint: "model", workflow: "txt2img" },
  };
  await writeConfig(workdir, config);
  const first = await readFile(configPath(workdir), "utf8");
  await writeConfig(workdir, config);
  const second = await readFile(configPath(workdir), "utf8");
  assert.equal(first, second);
  // Sorted keys within comfyui: "checkpoint" < "endpoint" < "workflow".
  assert.ok(first.indexOf('"checkpoint"') < first.indexOf('"endpoint"'));
  assert.ok(first.indexOf('"endpoint"') < first.indexOf('"workflow"'));
  assert.ok(first.endsWith("\n"));
});
