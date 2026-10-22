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
  REGION_BACK_NODE,
  REGION_CROP_NODE,
  REGION_MASK_NODE,
  REGION_PASTE_NODE,
  regionBoxes,
  SOURCE_ENCODE_NODE,
  SOURCE_LOAD_NODE,
  SOURCE_SCALE_NODE,
  withSourceImage,
} from "../comfyui-workflow.js";
import { readImageSize } from "../format.js";

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

test("withSourceImage scales another picture to the size asked for before encoding it", () => {
  const edited = withSourceImage(graph(), DEFAULT_INJECTION_MAP, "cut-002.png", 0.8, {
    width: 832,
    height: 1216,
  });
  assert.deepEqual(edited[SOURCE_SCALE_NODE], {
    class_type: "ImageScale",
    inputs: {
      image: [SOURCE_LOAD_NODE, 0],
      upscale_method: "lanczos",
      width: 832,
      height: 1216,
      crop: "center",
    },
  });
  assert.deepEqual(edited[SOURCE_ENCODE_NODE]?.inputs.pixels, [SOURCE_SCALE_NODE, 0]);
  assert.equal(edited["3"]?.inputs.denoise, 0.8);
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

/** A PNG header of the given size (signature and IHDR; enough for readImageSize). */
function pngOfSize(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("a picture's size is read from its PNG, JPEG or WebP header, and nothing else is guessed", () => {
  assert.deepEqual(readImageSize(pngOfSize(832, 1216)), { width: 832, height: 1216 });
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xc0, 0x03,
    0x40, 0x03,
  ]);
  assert.deepEqual(readImageSize(jpeg), { width: 832, height: 1216 });
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  webp.set([0x3f, 0x03, 0x00, 0xbf, 0x04, 0x00], 24);
  assert.deepEqual(readImageSize(webp), { width: 832, height: 1216 });
  assert.equal(readImageSize(PNG), null, "a PNG signature without its IHDR chunk");
  assert.equal(readImageSize(Uint8Array.from([1, 2, 3])), null);
});

test("a region's boxes: context to redraw, a smaller box to paste, a work size with a long side of 1024", () => {
  const { crop, paste, work, feather } = regionBoxes(
    { width: 832, height: 1216 },
    { x: 0.3, y: 0.35, w: 0.36, h: 0.2 },
  );
  // The region is 300 x 243 px at (250, 426); the crop grows it by 60%, the paste by 20%.
  assert.deepEqual(paste, { x: 219, y: 401, width: 361, height: 293 });
  assert.deepEqual(crop, { x: 159, y: 352, width: 480, height: 390 });
  assert.ok(paste.x >= crop.x && paste.x + paste.width <= crop.x + crop.width);
  assert.ok(paste.y >= crop.y && paste.y + paste.height <= crop.y + crop.height);
  assert.deepEqual(work, { width: 1024, height: 832 });
  assert.equal(feather, 35);
  // At a picture's edge the boxes stop at the edge.
  const corner = regionBoxes({ width: 832, height: 1216 }, { x: 0.9, y: 0.9, w: 0.2, h: 0.2 });
  assert.equal(corner.crop.x + corner.crop.width, 832);
  assert.equal(corner.crop.y + corner.crop.height, 1216);
});

test("a region edit redraws the crop at the work size and pastes back only the feathered paste box", () => {
  const source = { width: 832, height: 1216 };
  const region = { x: 0.3, y: 0.35, w: 0.36, h: 0.2 };
  const edited = withSourceImage(graph(), DEFAULT_INJECTION_MAP, "cut-003.png", 0.7, undefined, {
    source,
    region,
  });
  const { crop, paste, work, feather } = regionBoxes(source, region);
  assert.deepEqual(edited[REGION_CROP_NODE]?.inputs, {
    image: [SOURCE_LOAD_NODE, 0],
    width: crop.width,
    height: crop.height,
    x: crop.x,
    y: crop.y,
  });
  assert.deepEqual(edited[SOURCE_SCALE_NODE]?.inputs.image, [REGION_CROP_NODE, 0]);
  assert.equal(edited[SOURCE_SCALE_NODE]?.inputs.width, work.width);
  assert.deepEqual(edited[SOURCE_ENCODE_NODE]?.inputs.pixels, [SOURCE_SCALE_NODE, 0]);
  assert.equal(edited["3"]?.inputs.denoise, 0.7);
  assert.deepEqual(edited[REGION_BACK_NODE]?.inputs.image, ["8", 0]);
  assert.equal(edited[REGION_BACK_NODE]?.inputs.width, crop.width);
  assert.equal(edited[`${REGION_MASK_NODE}_soft`]?.inputs.left, feather);
  assert.deepEqual(
    [edited[REGION_MASK_NODE]?.inputs.x, edited[REGION_MASK_NODE]?.inputs.y],
    [paste.x - crop.x, paste.y - crop.y],
  );
  assert.deepEqual(edited[REGION_PASTE_NODE]?.inputs, {
    destination: [SOURCE_LOAD_NODE, 0],
    source: [REGION_BACK_NODE, 0],
    x: crop.x,
    y: crop.y,
    resize_source: false,
    mask: [REGION_MASK_NODE, 0],
  });
  assert.deepEqual(edited["9"]?.inputs.images, [REGION_PASTE_NODE, 0]);
});

test("a region request reads the source's size and submits the region graph; an unreadable size is refused", async () => {
  const seen = { uploads: [] as unknown[], graphs: [] as ComfyWorkflowGraph[] };
  const provider = new ComfyUIProvider(config(graph()), { fetch: fakeFetch(seen) });
  await provider.produce({
    prompt: "one woman, close-up, small relieved smile",
    options: { seed: 9 },
    source: {
      bytes: pngOfSize(832, 1216),
      name: "cut-002.png",
      strength: 0.7,
      region: { x: 0.3, y: 0.35, w: 0.36, h: 0.2 },
    },
  });
  const submitted = seen.graphs[0];
  assert.equal(submitted?.[REGION_CROP_NODE]?.inputs.x, 159);
  assert.deepEqual(submitted?.["9"]?.inputs.images, [REGION_PASTE_NODE, 0]);
  await assert.rejects(
    provider.produce({
      prompt: "p",
      options: { seed: 1 },
      source: { bytes: PNG, name: "x.png", strength: 0.7, region: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    }),
    /no readable size/,
  );
  assert.equal(seen.uploads.length, 1, "the unreadable source is never uploaded");
});
