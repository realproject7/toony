// A reference sheet reaches ComfyUI by upload (#327): the provider posts the
// bytes to /upload/image, writes the returned name into the declared node, and
// refuses a reference for a workflow that declares no input rather than
// dropping it. A request without a reference is submitted exactly as before.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ComfyUIProvider, type FetchLike } from "../comfyui.js";
import type { ComfyUIConfig } from "../comfyui-config.js";
import {
  buildWorkflow,
  type ComfyWorkflowGraph,
  DEFAULT_INJECTION_MAP,
  HALF_SAMPLER_NODE,
  HALF_TEXT_NODE,
  HALVES_JOINED_NODE,
  REFERENCE_ADAPTER_NODE,
  REFERENCE_APPLY_NODE,
  REFERENCE_LOAD_NODE,
  REFERENCE_WEIGHT,
  REFERENCE_WEIGHT_TYPE,
  SIDE_BY_SIDE_BLEND,
} from "../comfyui-workflow.js";

const PROMPT_ID = "f1e2d3c4-0000-4000-8000-aaaabbbbcccc";

function graph(): ComfyWorkflowGraph {
  return {
    "3": { class_type: "KSampler", inputs: { seed: 1 } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "10": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
  };
}

function config(withReference: boolean): ComfyUIConfig {
  return {
    url: "http://127.0.0.1:8188",
    workflow: graph(),
    injectionMap: {
      ...DEFAULT_INJECTION_MAP,
      ...(withReference ? { referenceNode: "10", referenceInput: "image" } : {}),
    },
    timeoutMs: 1000,
    pollIntervalMs: 1,
  };
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function fakeFetch(seen: { uploads: number; graphs: unknown[]; uploadBody?: unknown }): FetchLike {
  return async (url, init) => {
    const target = String(url);
    if (target.endsWith("/upload/image")) {
      seen.uploads += 1;
      seen.uploadBody = init?.body;
      return new Response(JSON.stringify({ name: "sheet-7.png", subfolder: "", type: "input" }), {
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

test("buildWorkflow writes the reference name only when the map names a node", () => {
  const withRef = buildWorkflow(
    graph(),
    { positivePrompt: "p", negativePrompt: "", seed: 1, referenceImage: "sheet.png" },
    { ...DEFAULT_INJECTION_MAP, referenceNode: "10", referenceInput: "image" },
  );
  assert.equal(withRef["10"]?.inputs.image, "sheet.png");
  const without = buildWorkflow(
    graph(),
    { positivePrompt: "p", negativePrompt: "", seed: 1, referenceImage: "sheet.png" },
    DEFAULT_INJECTION_MAP,
  );
  assert.equal(without["10"]?.inputs.image, "placeholder.png");
});

test("produce uploads the reference and injects the returned name", async () => {
  const seen: { uploads: number; graphs: unknown[]; uploadBody?: unknown } = {
    uploads: 0,
    graphs: [],
  };
  const provider = new ComfyUIProvider(config(true), {
    fetch: fakeFetch(seen),
    sleep: async () => {},
  });
  const result = await provider.produce({
    prompt: "a pier",
    options: { seed: 4 },
    reference: { bytes: PNG, name: "sheet.png" },
  });
  assert.equal(result.format, "png");
  assert.equal(seen.uploads, 1);
  assert.ok(seen.uploadBody instanceof FormData, "the upload is a multipart form");
  const file = (seen.uploadBody as FormData).get("image");
  assert.ok(file instanceof Blob);
  assert.equal(file.size, PNG.length);
  const graphSent = seen.graphs[0] as Record<string, { inputs: Record<string, unknown> }>;
  assert.equal(graphSent["10"]?.inputs.image, "sheet-7.png");
});

test("a request without a reference uploads nothing and leaves the node as the graph had it", async () => {
  const seen = { uploads: 0, graphs: [] as unknown[] };
  const provider = new ComfyUIProvider(config(true), {
    fetch: fakeFetch(seen),
    sleep: async () => {},
  });
  await provider.produce({ prompt: "a pier", options: { seed: 4 } });
  assert.equal(seen.uploads, 0);
  const graphSent = seen.graphs[0] as Record<string, { inputs: Record<string, unknown> }>;
  assert.equal(graphSent["10"]?.inputs.image, "placeholder.png");
});

test("a reference for a workflow with no reference input is refused when the engine has no IP-Adapter nodes", async () => {
  const seen = { uploads: 0, graphs: [] as unknown[] };
  const provider = new ComfyUIProvider(config(false), {
    fetch: fakeFetch(seen),
    sleep: async () => {},
  });
  assert.equal(await provider.supportsReferenceInjection(), false);
  await assert.rejects(
    provider.produce({ prompt: "a pier", reference: { bytes: PNG, name: "sheet.png" } }),
    /no IP-Adapter nodes/,
  );
  assert.equal(seen.uploads, 0);
  assert.equal(seen.graphs.length, 0);
});

/** The fake engine with the IP-Adapter nodes installed. */
function fakeFetchWithAdapter(seen: { uploads: number; graphs: unknown[] }): FetchLike {
  const base = fakeFetch(seen);
  return async (url, init) => {
    const target = String(url);
    const node = /\/object_info\/(IPAdapterUnifiedLoader|IPAdapter)$/.exec(target)?.[1];
    if (node !== undefined) {
      return new Response(JSON.stringify({ [node]: { input: {} } }), {
        headers: { "content-type": "application/json" },
      });
    }
    return base(url, init);
  };
}

test("with the IP-Adapter nodes, a reference is attached to any workflow's model", async () => {
  const seen = { uploads: 0, graphs: [] as unknown[] };
  const provider = new ComfyUIProvider(config(false), {
    fetch: fakeFetchWithAdapter(seen),
    sleep: async () => {},
  });
  assert.equal(await provider.supportsReferenceInjection(), true);
  const withModel = config(false);
  withModel.workflow["3"] = { class_type: "KSampler", inputs: { seed: 1, model: ["4", 0] } };
  const adapted = new ComfyUIProvider(withModel, {
    fetch: fakeFetchWithAdapter(seen),
    sleep: async () => {},
  });
  await adapted.produce({ prompt: "a pier", reference: { bytes: PNG, name: "sheet.png" } });
  assert.equal(seen.uploads, 1);
  const graph = seen.graphs[0] as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  assert.deepEqual(graph["3"]?.inputs.model, [REFERENCE_APPLY_NODE, 0]);
  assert.equal(graph[REFERENCE_LOAD_NODE]?.inputs.image, "sheet-7.png");
  assert.deepEqual(
    graph[REFERENCE_ADAPTER_NODE]?.inputs.model,
    ["4", 0],
    "the adapter takes the model the sampler used",
  );
  assert.equal(graph[REFERENCE_APPLY_NODE]?.class_type, "IPAdapter");
  assert.equal(graph[REFERENCE_APPLY_NODE]?.inputs.weight, REFERENCE_WEIGHT);
  assert.equal(graph["10"]?.inputs.image, "placeholder.png", "the declared node is untouched");

  // A sampler with no linked model cannot take one; refused before any upload.
  const seenPlain = { uploads: 0, graphs: [] as unknown[] };
  await assert.rejects(
    new ComfyUIProvider(config(false), {
      fetch: fakeFetchWithAdapter(seenPlain),
      sleep: async () => {},
    }).produce({
      prompt: "a pier",
      reference: { bytes: PNG, name: "sheet.png" },
    }),
    /no linked model input/,
  );
  assert.equal(seenPlain.uploads, 0);
});

test("an upload that fails or returns no name is a provider error, not a silent drop", async () => {
  const failing: FetchLike = async (url) =>
    String(url).endsWith("/upload/image") ? new Response("", { status: 500 }) : new Response("");
  await assert.rejects(
    new ComfyUIProvider(config(true), { fetch: failing }).produce({
      prompt: "p",
      reference: { bytes: PNG, name: "s.png" },
    }),
    /upload\/image failed/,
  );
  const nameless: FetchLike = async (url) =>
    String(url).endsWith("/upload/image")
      ? new Response(JSON.stringify({ subfolder: "" }), {
          headers: { "content-type": "application/json" },
        })
      : new Response("");
  await assert.rejects(
    new ComfyUIProvider(config(true), { fetch: nameless }).produce({
      prompt: "p",
      reference: { bytes: PNG, name: "s.png" },
    }),
    /no file name/,
  );
});

test("two people get one reference each, masked to their side of the frame", async () => {
  const seen = { uploads: 0, graphs: [] as unknown[] };
  const withModel = config(false);
  withModel.workflow["3"] = { class_type: "KSampler", inputs: { seed: 1, model: ["4", 0] } };
  const provider = new ComfyUIProvider(withModel, {
    fetch: fakeFetchWithAdapter(seen),
    sleep: async () => {},
  });
  await provider.produce({
    prompt: "two people at a table",
    references: [
      { bytes: PNG, name: "mara.png", side: "left" },
      { bytes: PNG, name: "ren.png", side: "right" },
    ],
  });
  assert.equal(seen.uploads, 2);
  type Node = { class_type: string; inputs: Record<string, unknown> };
  const graph = seen.graphs[0] as Record<string, Node>;
  const first = graph[REFERENCE_APPLY_NODE];
  const second = graph[`${REFERENCE_APPLY_NODE}_2`];
  assert.ok(first && second);
  assert.deepEqual(first.inputs.model, [REFERENCE_ADAPTER_NODE, 0]);
  assert.deepEqual(second.inputs.model, [REFERENCE_APPLY_NODE, 0], "the adapters chain");
  assert.deepEqual(graph["3"]?.inputs.model, [`${REFERENCE_APPLY_NODE}_2`, 0]);
  assert.equal(first.inputs.weight_type, REFERENCE_WEIGHT_TYPE);
  const maskOf = (node: Node) => graph[(node.inputs.attn_mask as [string, number])[0]];
  const leftMask = maskOf(first);
  const rightMask = maskOf(second);
  assert.equal(leftMask?.class_type, "MaskComposite");
  assert.equal(leftMask?.inputs.x, 0, "the left mask starts at the left edge");
  assert.ok(
    Number(rightMask?.inputs.x) > 0 && Number(rightMask?.inputs.x) < 512 / 2,
    "the right mask starts just left of centre",
  );
  const bandOf = (mask: Node | undefined) => graph[(mask?.inputs.source as [string, number])[0]];
  assert.ok(
    Number(bandOf(leftMask)?.inputs.width) > 256,
    "each band covers a little more than half",
  );
  assert.equal(graph[REFERENCE_LOAD_NODE]?.inputs.image, "sheet-7.png");
});

test("two people with their own prompts are drawn side by side, then together", async () => {
  const seen = { uploads: 0, graphs: [] as unknown[] };
  const withModel = config(false);
  withModel.workflow["3"] = {
    class_type: "KSampler",
    inputs: { seed: 1, model: ["4", 0], latent_image: ["5", 0], denoise: 1, steps: 25 },
  };
  withModel.workflow["6"] = { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } };
  withModel.workflow["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["3", 0], vae: ["4", 2] },
  };
  const provider = new ComfyUIProvider(withModel, {
    fetch: fakeFetchWithAdapter(seen),
    sleep: async () => {},
  });
  await provider.produce({
    prompt: "two people at a table",
    options: { seed: 40 },
    references: [
      { bytes: PNG, name: "mara.png", side: "left", prompt: "one person, mara, facing right" },
      { bytes: PNG, name: "ren.png", side: "right", prompt: "one person, ren, facing left" },
    ],
  });
  type Node = { class_type: string; inputs: Record<string, unknown> };
  const graph = seen.graphs[0] as Record<string, Node>;
  const left = graph[`${HALF_SAMPLER_NODE}_left`];
  const right = graph[`${HALF_SAMPLER_NODE}_right`];
  assert.ok(left && right, "each person has a half of their own");
  assert.equal(graph[`${HALF_TEXT_NODE}_left`]?.inputs.text, "one person, mara, facing right");
  assert.equal(graph[`${HALF_TEXT_NODE}_right`]?.inputs.text, "one person, ren, facing left");
  assert.deepEqual([left.inputs.seed, right.inputs.seed], [41, 42]);
  assert.equal(left.inputs.steps, 25, "a half samples the way the picture does");
  const halfLatent = graph[(left.inputs.latent_image as [string, number])[0]];
  assert.deepEqual([halfLatent?.inputs.width, halfLatent?.inputs.height], [512, 1216]);
  const joined = graph[HALVES_JOINED_NODE];
  assert.equal(joined?.inputs.x, 832 - 512, "the right half ends at the right edge");
  assert.ok(Number(joined?.inputs.feather) > 0, "the seam is soft");
  assert.deepEqual(graph["3"]?.inputs.latent_image, [HALVES_JOINED_NODE, 0]);
  assert.equal(graph["3"]?.inputs.denoise, SIDE_BY_SIDE_BLEND);
  assert.deepEqual(
    graph["3"]?.inputs.model,
    [`${REFERENCE_APPLY_NODE}_2`, 0],
    "the whole picture keeps both references on their sides",
  );

  // An edit keeps the people where its source has them: masks only, no halves.
  await provider.produce({
    prompt: "two people at a table",
    references: [
      { bytes: PNG, name: "mara.png", side: "left", prompt: "one person, mara" },
      { bytes: PNG, name: "ren.png", side: "right", prompt: "one person, ren" },
    ],
    source: { bytes: PNG, name: "cut.png", strength: 0.5 },
  });
  const edited = seen.graphs[1] as Record<string, Node>;
  assert.equal(edited[`${HALF_SAMPLER_NODE}_left`], undefined);
  assert.ok(edited[`${REFERENCE_APPLY_NODE}_2`]);
});
