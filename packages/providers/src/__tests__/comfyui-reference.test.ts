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

test("a reference for a workflow with no reference input is refused before any call", async () => {
  const seen = { uploads: 0, graphs: [] as unknown[] };
  const provider = new ComfyUIProvider(config(false), {
    fetch: fakeFetch(seen),
    sleep: async () => {},
  });
  await assert.rejects(
    provider.produce({ prompt: "a pier", reference: { bytes: PNG, name: "sheet.png" } }),
    /declares no reference input/,
  );
  assert.equal(seen.uploads, 0);
  assert.equal(seen.graphs.length, 0);
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
