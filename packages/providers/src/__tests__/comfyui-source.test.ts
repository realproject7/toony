// Editing an existing image (image to image): the provider uploads the source,
// loads and encodes it with the graph's own VAE, starts the sampler from it and
// sets the sampler's denoise to the requested strength. A graph that cannot be
// rewired this way is refused before anything is uploaded.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ComfyUIProvider, type FetchLike } from "../comfyui.js";
import type { ComfyUIConfig } from "../comfyui-config.js";
import {
  type ComfyWorkflowGraph,
  DEFAULT_INJECTION_MAP,
  SOURCE_ENCODE_NODE,
  SOURCE_LOAD_NODE,
  withSourceImage,
} from "../comfyui-workflow.js";

const PROMPT_ID = "a1b2c3d4-0000-4000-8000-aaaabbbbcccc";

function graph(): ComfyWorkflowGraph {
  return {
    "3": {
      class_type: "KSampler",
      inputs: { seed: 1, denoise: 1, latent_image: ["5", 0], model: ["4", 0] },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
  };
}

test("withSourceImage starts the sampler from the encoded source at the given strength", () => {
  const template = graph();
  const edited = withSourceImage(template, DEFAULT_INJECTION_MAP, "cut-001.png", 0.4);
  assert.deepEqual(edited[SOURCE_LOAD_NODE], {
    class_type: "LoadImage",
    inputs: { image: "cut-001.png" },
  });
  assert.deepEqual(edited[SOURCE_ENCODE_NODE], {
    class_type: "VAEEncode",
    inputs: { pixels: [SOURCE_LOAD_NODE, 0], vae: ["4", 2] },
  });
  assert.deepEqual(edited["3"]?.inputs.latent_image, [SOURCE_ENCODE_NODE, 0]);
  assert.equal(edited["3"]?.inputs.denoise, 0.4);
  // The template is untouched, so it can be reused for the next cut.
  assert.deepEqual(template, graph());
});

test("withSourceImage refuses a graph it cannot rewire and a strength out of range", () => {
  const noSampler = graph();
  delete noSampler["3"]?.inputs.latent_image;
  assert.throws(
    () => withSourceImage(noSampler, DEFAULT_INJECTION_MAP, "x.png", 0.5),
    /cannot edit an existing image/,
  );
  const noDecoder = graph();
  delete noDecoder["8"];
  assert.throws(
    () => withSourceImage(noDecoder, DEFAULT_INJECTION_MAP, "x.png", 0.5),
    /no VAEDecode/,
  );
  for (const strength of [0, -0.1, 1.5, Number.NaN]) {
    assert.throws(
      () => withSourceImage(graph(), DEFAULT_INJECTION_MAP, "x.png", strength),
      /strength/,
      String(strength),
    );
  }
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);

function config(workflow: ComfyWorkflowGraph): ComfyUIConfig {
  return {
    url: "http://127.0.0.1:8188",
    workflow,
    injectionMap: DEFAULT_INJECTION_MAP,
    timeoutMs: 1000,
    pollIntervalMs: 1,
  };
}

function fakeFetch(seen: { uploads: unknown[]; graphs: ComfyWorkflowGraph[] }): FetchLike {
  return async (url, init) => {
    const target = String(url);
    if (target.endsWith("/upload/image")) {
      seen.uploads.push(init?.body);
      return new Response(JSON.stringify({ name: "source-1.png", subfolder: "", type: "input" }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/prompt")) {
      seen.graphs.push(JSON.parse(String(init?.body)).prompt);
      return new Response(JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (target.includes("/history/")) {
      return new Response(
        JSON.stringify({
          [PROMPT_ID]: {
            outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
            status: { status_str: "success", completed: true },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (target.includes("/view")) {
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    return new Response("", { status: 404 });
  };
}

test("a request with a source uploads it and submits the rewired graph", async () => {
  const seen = { uploads: [] as unknown[], graphs: [] as ComfyWorkflowGraph[] };
  const provider = new ComfyUIProvider(config(graph()), { fetch: fakeFetch(seen) });
  const result = await provider.produce({
    prompt: "the same pier, now at night",
    options: { seed: 5 },
    source: { bytes: PNG, name: "cut-001.png", strength: 0.6 },
  });
  assert.equal(result.format, "png");
  assert.equal(seen.uploads.length, 1);
  const submitted = seen.graphs[0];
  assert.ok(submitted);
  assert.equal(submitted[SOURCE_LOAD_NODE]?.inputs.image, "source-1.png");
  assert.deepEqual(submitted["3"]?.inputs.latent_image, [SOURCE_ENCODE_NODE, 0]);
  assert.equal(submitted["3"]?.inputs.denoise, 0.6);
  assert.equal(submitted["3"]?.inputs.seed, 5);
});

test("a source for a graph that cannot take one is refused before any upload", async () => {
  const seen = { uploads: [] as unknown[], graphs: [] as ComfyWorkflowGraph[] };
  const plain = graph();
  delete plain["8"];
  const provider = new ComfyUIProvider(config(plain), { fetch: fakeFetch(seen) });
  await assert.rejects(
    provider.produce({
      prompt: "p",
      options: { seed: 1 },
      source: { bytes: PNG, name: "cut-001.png", strength: 0.5 },
    }),
    /no VAEDecode/,
  );
  assert.equal(seen.uploads.length, 0);
  assert.equal(seen.graphs.length, 0);
});
