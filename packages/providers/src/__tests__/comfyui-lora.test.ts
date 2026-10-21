// Character LoRAs reach the engine as LoraLoader nodes: on the whole picture
// for one person (before the references attach, so the adapter takes the LoRA's
// model), and in a two-person picture drawn side by side each in its own half,
// with every LoRA at a low strength on the pass that joins the halves.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ComfyUIProvider, type FetchLike } from "../comfyui.js";
import type { ComfyUIConfig } from "../comfyui-config.js";
import {
  type ComfyWorkflowGraph,
  DEFAULT_INJECTION_MAP,
  HALF_LORA_NODE,
  HALF_TEXT_NODE,
  LORA_NODE,
  REFERENCE_ADAPTER_NODE,
  REFERENCE_APPLY_NODE,
  REFERENCE_STRONG,
  SIDE_BY_SIDE_LORA_WHOLE,
  withLoras,
} from "../comfyui-workflow.js";
import { ProviderError } from "../errors.js";

type Node = { class_type: string; inputs: Record<string, unknown> };
const PROMPT_ID = "a1b2c3d4-0000-4000-8000-aaaabbbbcccc";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function graph(): ComfyWorkflowGraph {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
        denoise: 1,
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  };
}

function provider(seen: { graphs: Record<string, Node>[] }): ComfyUIProvider {
  const fetch: FetchLike = async (url, init) => {
    const target = String(url);
    if (target.includes("/object_info/")) {
      const node = target.split("/object_info/")[1] ?? "";
      return new Response(JSON.stringify({ [node]: { input: {} } }));
    }
    if (target.endsWith("/upload/image")) {
      return new Response(JSON.stringify({ name: "up.png", subfolder: "", type: "input" }));
    }
    if (target.endsWith("/prompt")) {
      seen.graphs.push(JSON.parse(String(init?.body)).prompt);
      return new Response(JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }));
    }
    if (target.includes("/history/")) {
      return new Response(
        JSON.stringify({
          [PROMPT_ID]: {
            outputs: { "9": { images: [{ filename: "o.png", subfolder: "", type: "output" }] } },
            status: { status_str: "success", completed: true },
          },
        }),
      );
    }
    if (target.includes("/view")) return new Response(PNG);
    return new Response("", { status: 404 });
  };
  const config: ComfyUIConfig = {
    url: "http://127.0.0.1:8188",
    workflow: graph(),
    injectionMap: DEFAULT_INJECTION_MAP,
    timeoutMs: 1000,
    pollIntervalMs: 1,
  };
  return new ComfyUIProvider(config, { fetch, sleep: async () => {} });
}

test("withLoras chains LoRAs off the checkpoint and moves every consumer onto the last", () => {
  const out = withLoras(graph(), DEFAULT_INJECTION_MAP, [
    { name: "mina.safetensors", strength: 0.7 },
    { name: "jun.safetensors", strength: 0.3 },
  ]);
  const first = out[`${LORA_NODE}_1`] as Node;
  const second = out[`${LORA_NODE}_2`] as Node;
  assert.deepEqual(
    [first.inputs.model, first.inputs.clip],
    [
      ["4", 0],
      ["4", 1],
    ],
  );
  assert.equal(first.inputs.lora_name, "mina.safetensors");
  assert.equal(first.inputs.strength_clip, 0.7);
  assert.deepEqual(second.inputs.model, [`${LORA_NODE}_1`, 0]);
  assert.deepEqual(out["3"]?.inputs.model, [`${LORA_NODE}_2`, 0]);
  assert.deepEqual(out["6"]?.inputs.clip, [`${LORA_NODE}_2`, 1]);
  assert.deepEqual(out["8"]?.inputs.vae, ["4", 2], "the VAE stays the checkpoint's");
  // A node named in keep holds on to the checkpoint; nothing changes without LoRAs.
  const kept = withLoras(graph(), DEFAULT_INJECTION_MAP, [{ name: "a", strength: 1 }], ["7"]);
  assert.deepEqual(kept["7"]?.inputs.clip, ["4", 1]);
  assert.deepEqual(withLoras(graph(), DEFAULT_INJECTION_MAP, []), graph());
  const { checkpointNode: _, ...noCheckpoint } = DEFAULT_INJECTION_MAP;
  assert.throws(
    () => withLoras(graph(), noCheckpoint, [{ name: "a", strength: 1 }]),
    (error: unknown) => error instanceof ProviderError && error.code === "comfyui.no-lora-input",
  );
});

test("one person: the LoRA on the whole picture under the reference; a strong hold for variations", async () => {
  const seen = { graphs: [] as Record<string, Node>[] };
  await provider(seen).produce({
    prompt: "one woman at a door",
    reference: { bytes: PNG, name: "mina.png" },
    loras: [{ name: "mina.safetensors", strength: 0.7 }],
    referenceStrength: "strong",
  });
  const g = seen.graphs[0] as Record<string, Node>;
  assert.equal(g[`${LORA_NODE}_1`]?.inputs.lora_name, "mina.safetensors");
  assert.deepEqual(
    g[REFERENCE_ADAPTER_NODE]?.inputs.model,
    [`${LORA_NODE}_1`, 0],
    "the adapter takes the LoRA's model",
  );
  assert.deepEqual(g["3"]?.inputs.model, [REFERENCE_APPLY_NODE, 0]);
  assert.deepEqual(g["6"]?.inputs.clip, [`${LORA_NODE}_1`, 1]);
  const apply = g[REFERENCE_APPLY_NODE] as Node;
  assert.deepEqual(
    [apply.inputs.weight, apply.inputs.start_at, apply.inputs.weight_type],
    [REFERENCE_STRONG.weight, REFERENCE_STRONG.start, REFERENCE_STRONG.weightType],
  );
});

test("two people side by side: each LoRA in its own half, both lightly on the joining pass", async () => {
  const seen = { graphs: [] as Record<string, Node>[] };
  await provider(seen).produce({
    prompt: "two people on a pier",
    references: [
      { bytes: PNG, name: "mina.png", side: "left", prompt: "one person, mina" },
      { bytes: PNG, name: "jun.png", side: "right", prompt: "one person, jun" },
    ],
    loras: [
      { name: "mina.safetensors", strength: 0.7, side: "left" },
      { name: "jun.safetensors", strength: 0.6, side: "right" },
    ],
  });
  const g = seen.graphs[0] as Record<string, Node>;
  for (const [side, name, strength] of [
    ["left", "mina.safetensors", 0.7],
    ["right", "jun.safetensors", 0.6],
  ] as const) {
    const lora = g[`${HALF_LORA_NODE}_${side}`] as Node;
    assert.equal(lora.inputs.lora_name, name);
    assert.equal(lora.inputs.strength_model, strength);
    assert.deepEqual(lora.inputs.model, ["4", 0], "a half's LoRA sits on the checkpoint itself");
    assert.deepEqual(g[`${HALF_TEXT_NODE}_${side}`]?.inputs.clip, [`${HALF_LORA_NODE}_${side}`, 1]);
    assert.deepEqual(g[`toony_half_adapter_${side}`]?.inputs.model, [
      `${HALF_LORA_NODE}_${side}`,
      0,
    ]);
    assert.deepEqual(g[`toony_half_apply_${side}`]?.inputs.model, [
      `toony_half_adapter_${side}`,
      0,
    ]);
  }
  const whole = [g[`${LORA_NODE}_1`], g[`${LORA_NODE}_2`]] as Node[];
  assert.deepEqual(
    whole.map((node) => [node.inputs.lora_name, node.inputs.strength_model]),
    [
      ["mina.safetensors", SIDE_BY_SIDE_LORA_WHOLE],
      ["jun.safetensors", SIDE_BY_SIDE_LORA_WHOLE],
    ],
  );
  assert.deepEqual(g[REFERENCE_ADAPTER_NODE]?.inputs.model, [`${LORA_NODE}_2`, 0]);
  assert.deepEqual(g["6"]?.inputs.clip, [`${LORA_NODE}_2`, 1]);
});
