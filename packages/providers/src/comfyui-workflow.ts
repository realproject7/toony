// ComfyUI workflow-graph templating: inject a cut's prompt, target size, and
// seed into a ComfyUI "API format" workflow graph WITHOUT hard-coding the graph.
//
// A ComfyUI workflow (API format) is a JSON object keyed by node id, where each
// node is `{ class_type, inputs }`. Inputs are either literal values or a wire
// `[sourceNodeId, outputIndex]`. Toony treats the graph as opaque DATA: the
// operator ships any graph that matches their install, and a small node/param
// MAPPING says which node input receives the positive prompt, negative prompt,
// width, height, and seed. This keeps Toony provider-neutral — no model,
// checkpoint, sampler, or node layout is baked into the code.

import { ProviderError } from "./errors.js";

/** A ComfyUI node in API format: a class plus its named inputs. */
export interface ComfyWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  [extra: string]: unknown;
}

/** A ComfyUI workflow graph in API format, keyed by node id. */
export type ComfyWorkflowGraph = Record<string, ComfyWorkflowNode>;

/**
 * Where each generated value is written in the graph. Each entry names a node id
 * and the input key on that node to overwrite. Optional entries are skipped when
 * absent, so a graph without (say) a separate negative node still works.
 *
 * `checkpointNode`/`checkpointInput` let the operator point the loader at the
 * checkpoint file their install actually has, without editing the graph file.
 */
export interface WorkflowInjectionMap {
  positiveNode: string;
  positiveInput: string;
  negativeNode: string;
  negativeInput: string;
  widthNode: string;
  widthInput: string;
  heightNode: string;
  heightInput: string;
  seedNode: string;
  seedInput: string;
  checkpointNode?: string;
  checkpointInput?: string;
  /**
   * Where an uploaded reference image is named (#327): a LoadImage-style node
   * and its input. Absent means the graph takes no reference and none is sent.
   */
  referenceNode?: string;
  referenceInput?: string;
}

/**
 * The default injection map for the shipped `default-txt2img.workflow.json`
 * graph. Node ids/keys match that file; an operator overriding the workflow also
 * overrides this map to match their own graph.
 */
export const DEFAULT_INJECTION_MAP: WorkflowInjectionMap = {
  positiveNode: "6",
  positiveInput: "text",
  negativeNode: "7",
  negativeInput: "text",
  widthNode: "5",
  widthInput: "width",
  heightNode: "5",
  heightInput: "height",
  seedNode: "3",
  seedInput: "seed",
  checkpointNode: "4",
  checkpointInput: "ckpt_name",
};

/** The values injected into a workflow graph for one image. */
export interface WorkflowParams {
  positivePrompt: string;
  negativePrompt: string;
  /**
   * Image size, in px. OPTIONAL on purpose: when absent the workflow graph's own
   * dimensions stand. Injecting a default here would silently overwrite what a
   * pack's workflow declares, and cut aspect is the largest single lever a style
   * pack has over whether generated art sits in its genre's rhythm.
   */
  width?: number;
  height?: number;
  seed: number;
  /** Optional checkpoint filename, applied only when the map names a node. */
  checkpoint?: string;
  /**
   * The server-side name of an uploaded reference image, applied only when the
   * map names a reference node (#327). The caller uploads first and passes the
   * name ComfyUI returned.
   */
  referenceImage?: string;
}

function setInput(
  graph: ComfyWorkflowGraph,
  nodeId: string,
  inputKey: string,
  value: unknown,
  label: string,
): void {
  const node = graph[nodeId];
  if (node === undefined) {
    throw new ProviderError(
      "comfyui.workflow-node-missing",
      `workflow has no node "${nodeId}" for ${label}; fix the workflow or its node mapping.`,
    );
  }
  if (typeof node.inputs !== "object" || node.inputs === null) {
    throw new ProviderError(
      "comfyui.workflow-node-invalid",
      `workflow node "${nodeId}" has no inputs object for ${label}.`,
    );
  }
  node.inputs[inputKey] = value;
}

/** Parse a workflow graph from JSON text, validating the API-format shape. */
export function parseWorkflowGraph(text: string): ComfyWorkflowGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError("comfyui.workflow-parse", "workflow template is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError(
      "comfyui.workflow-shape",
      "workflow template must be a ComfyUI API-format object keyed by node id.",
    );
  }
  const graph = parsed as Record<string, unknown>;
  for (const [id, node] of Object.entries(graph)) {
    if (
      typeof node !== "object" ||
      node === null ||
      typeof (node as { class_type?: unknown }).class_type !== "string"
    ) {
      throw new ProviderError(
        "comfyui.workflow-node-shape",
        `workflow node "${id}" must have a string class_type and inputs (ComfyUI API format).`,
      );
    }
  }
  return graph as ComfyWorkflowGraph;
}

/**
 * Inject params into a COPY of the graph and return it ready to POST to
 * `/prompt`. The input graph is never mutated, so a template can be reused.
 */
export function buildWorkflow(
  template: ComfyWorkflowGraph,
  params: WorkflowParams,
  map: WorkflowInjectionMap = DEFAULT_INJECTION_MAP,
): ComfyWorkflowGraph {
  // Deep clone so reuse of the same template across cuts stays independent.
  const graph = structuredClone(template);

  setInput(
    graph,
    map.positiveNode,
    map.positiveInput,
    params.positivePrompt,
    "the positive prompt",
  );
  setInput(
    graph,
    map.negativeNode,
    map.negativeInput,
    params.negativePrompt,
    "the negative prompt",
  );
  if (params.width !== undefined) {
    setInput(graph, map.widthNode, map.widthInput, params.width, "the image width");
  }
  if (params.height !== undefined) {
    setInput(graph, map.heightNode, map.heightInput, params.height, "the image height");
  }
  setInput(graph, map.seedNode, map.seedInput, params.seed, "the sampler seed");

  if (
    params.checkpoint !== undefined &&
    map.checkpointNode !== undefined &&
    map.checkpointInput !== undefined
  ) {
    setInput(graph, map.checkpointNode, map.checkpointInput, params.checkpoint, "the checkpoint");
  }
  if (
    params.referenceImage !== undefined &&
    map.referenceNode !== undefined &&
    map.referenceInput !== undefined
  ) {
    setInput(
      graph,
      map.referenceNode,
      map.referenceInput,
      params.referenceImage,
      "the reference image",
    );
  }

  return graph;
}

/** The node ids Toony adds to a graph when a run edits an existing image. */
export const SOURCE_LOAD_NODE = "toony_source_load";
export const SOURCE_ENCODE_NODE = "toony_source_encode";
export const SOURCE_SCALE_NODE = "toony_source_scale";

/**
 * Turn a text-to-image graph into an image-to-image one, in a COPY: the
 * uploaded `image` is loaded and encoded with the graph's own VAE, the sampler
 * (the node the map sends the seed to) starts from it instead of its empty
 * latent, and its denoise becomes `strength`. The output keeps the source's
 * size, so the graph's latent size no longer applies, unless `size` is given:
 * the source is then scaled to cover that size and cropped to its centre.
 *
 * Works for the usual sampler graphs (a sampler with `latent_image` and
 * `denoise` inputs, and a `VAEDecode` whose VAE can encode). Any other graph is
 * refused with a clear message rather than guessed at.
 */
export function withSourceImage(
  template: ComfyWorkflowGraph,
  map: WorkflowInjectionMap,
  image: string,
  strength: number,
  size?: { width: number; height: number },
): ComfyWorkflowGraph {
  if (!Number.isFinite(strength) || strength <= 0 || strength > 1) {
    throw new ProviderError(
      "comfyui.source-strength",
      "the edit strength must be greater than 0 and at most 1.",
    );
  }
  const graph = structuredClone(template);
  const sampler = graph[map.seedNode];
  if (
    sampler === undefined ||
    typeof sampler.inputs !== "object" ||
    sampler.inputs === null ||
    !Array.isArray(sampler.inputs.latent_image) ||
    !("denoise" in sampler.inputs)
  ) {
    throw new ProviderError(
      "comfyui.no-source-input",
      `this workflow cannot edit an existing image: its sampler node "${map.seedNode}" has no latent_image and denoise inputs. Redraw the cut instead, or use a workflow with a standard sampler.`,
    );
  }
  const decoders = Object.values(graph).filter(
    (node) => node.class_type === "VAEDecode" && Array.isArray(node.inputs?.vae),
  );
  const decoder =
    decoders.find(
      (node) => Array.isArray(node.inputs.samples) && node.inputs.samples[0] === map.seedNode,
    ) ?? decoders[0];
  if (decoder === undefined) {
    throw new ProviderError(
      "comfyui.no-source-vae",
      "this workflow cannot edit an existing image: it has no VAEDecode node whose VAE can encode the source. Redraw the cut instead.",
    );
  }
  graph[SOURCE_LOAD_NODE] = { class_type: "LoadImage", inputs: { image } };
  let pixels: unknown[] = [SOURCE_LOAD_NODE, 0];
  if (size !== undefined) {
    graph[SOURCE_SCALE_NODE] = {
      class_type: "ImageScale",
      inputs: {
        image: pixels,
        upscale_method: "lanczos",
        width: size.width,
        height: size.height,
        crop: "center",
      },
    };
    pixels = [SOURCE_SCALE_NODE, 0];
  }
  graph[SOURCE_ENCODE_NODE] = {
    class_type: "VAEEncode",
    inputs: { pixels, vae: structuredClone(decoder.inputs.vae) },
  };
  sampler.inputs.latent_image = [SOURCE_ENCODE_NODE, 0];
  sampler.inputs.denoise = strength;
  return graph;
}

/** The node ids Toony adds to a graph when a run conditions on a reference image. */
export const REFERENCE_LOAD_NODE = "toony_reference_load";
export const REFERENCE_ADAPTER_NODE = "toony_reference_adapter";
export const REFERENCE_APPLY_NODE = "toony_reference_apply";
/**
 * How the reference steers the picture. Chosen on same-seed renders with the
 * cast's look in the prompt: lower keeps only colours, higher copies the
 * reference's composition or breaks faces. The prompt sets the composition
 * first (the adapter starts a little into sampling) and wins where the two
 * disagree.
 */
export const REFERENCE_WEIGHT = 0.6;
export const REFERENCE_START = 0.15;
export const REFERENCE_WEIGHT_TYPE = "prompt is more important";
/** How references hold a picture: the default balance, or "strong" (one portrait's variations). */
export interface ReferenceSettings {
  weight: number;
  start: number;
  weightType: string;
}
export const REFERENCE_DEFAULT: ReferenceSettings = {
  weight: REFERENCE_WEIGHT,
  start: REFERENCE_START,
  weightType: REFERENCE_WEIGHT_TYPE,
};
export const REFERENCE_STRONG: ReferenceSettings = {
  weight: 0.75,
  start: 0,
  weightType: "standard",
};
/** Where a side's mask ends, as a fraction of the width; the halves overlap in the middle. */
const SIDE_SPLIT = { left: [0, 0.55], right: [0.45, 1] } as const;
/** The mask canvas: the adapter resizes masks to the picture, so only the fractions matter. */
const MASK_SIZE = 512;

export interface ReferenceImage {
  /** The uploaded image's name on the engine. */
  image: string;
  /** Keep this reference to one side of the frame (a two-person picture). Absent: the whole frame. */
  side?: "left" | "right";
  /** That person alone in the setting, for a picture drawn side by side. */
  prompt?: string;
}

/**
 * Condition a graph on characters' reference images, in a COPY: each image is
 * loaded, the IP-Adapter community nodes attach it to the model the sampler
 * draws with (one adapter after another), and the sampler's model input moves
 * to the adapted model. A reference with a side is masked to that side, so two
 * people keep their own looks. Works for any graph whose sampler (the node the
 * map sends the seed to) takes its model from a link, LoRA chains included.
 */
export function withReferenceImages(
  template: ComfyWorkflowGraph,
  map: WorkflowInjectionMap,
  references: readonly ReferenceImage[],
  settings: ReferenceSettings = REFERENCE_DEFAULT,
): ComfyWorkflowGraph {
  const graph = structuredClone(template);
  const sampler = graph[map.seedNode];
  if (
    sampler === undefined ||
    typeof sampler.inputs !== "object" ||
    sampler.inputs === null ||
    !Array.isArray(sampler.inputs.model)
  ) {
    throw new ProviderError(
      "comfyui.no-model-input",
      `this workflow cannot take a reference image: its sampler node "${map.seedNode}" has no linked model input.`,
    );
  }
  if (references.length === 0) return graph;
  graph[REFERENCE_ADAPTER_NODE] = {
    class_type: "IPAdapterUnifiedLoader",
    inputs: { model: structuredClone(sampler.inputs.model), preset: "PLUS (high strength)" },
  };
  let model: unknown[] = [REFERENCE_ADAPTER_NODE, 0];
  references.forEach((reference, index) => {
    const suffix = index === 0 ? "" : `_${index + 1}`;
    const load = `${REFERENCE_LOAD_NODE}${suffix}`;
    const apply = `${REFERENCE_APPLY_NODE}${suffix}`;
    graph[load] = { class_type: "LoadImage", inputs: { image: reference.image } };
    const inputs: Record<string, unknown> = {
      model,
      ipadapter: [REFERENCE_ADAPTER_NODE, 1],
      image: [load, 0],
      weight: settings.weight,
      start_at: settings.start,
      end_at: 1,
      weight_type: settings.weightType,
    };
    if (reference.side !== undefined) {
      const [from, to] = SIDE_SPLIT[reference.side];
      const blank = `toony_reference_mask_blank${suffix}`;
      const band = `toony_reference_mask_band${suffix}`;
      const mask = `toony_reference_mask${suffix}`;
      graph[blank] = {
        class_type: "SolidMask",
        inputs: { value: 0, width: MASK_SIZE, height: MASK_SIZE },
      };
      graph[band] = {
        class_type: "SolidMask",
        inputs: { value: 1, width: Math.round((to - from) * MASK_SIZE), height: MASK_SIZE },
      };
      graph[mask] = {
        class_type: "MaskComposite",
        inputs: {
          destination: [blank, 0],
          source: [band, 0],
          x: Math.round(from * MASK_SIZE),
          y: 0,
          operation: "add",
        },
      };
      inputs.attn_mask = [mask, 0];
    }
    graph[apply] = { class_type: "IPAdapter", inputs };
    model = [apply, 0];
  });
  sampler.inputs.model = model;
  return graph;
}

/** A LoRA to draw with: its file name on the engine and its strength. */
export interface LoraUse {
  name: string;
  strength: number;
}
/** The node ids Toony adds for LoRAs on the whole picture (numbered from 1). */
export const LORA_NODE = "toony_lora";
/**
 * Each person's LoRA strength on the pass that joins a side-by-side picture's
 * halves: enough to keep both looks in the light and colours of the whole,
 * little enough that neither look spreads to the other person.
 */
export const SIDE_BY_SIDE_LORA_WHOLE = 0.3;

const isLinkTo = (value: unknown, node: string, output: number): boolean =>
  Array.isArray(value) && value[0] === node && value[1] === output;

/**
 * Draw with LoRAs, in a COPY: LoraLoader nodes are chained off the checkpoint's
 * model and text encoder (the map's checkpoint node), and every node that took
 * the checkpoint's model or text encoder takes the last LoRA's instead, except
 * the nodes named in `keep` (a side-by-side picture's halves keep their own).
 */
export function withLoras(
  template: ComfyWorkflowGraph,
  map: WorkflowInjectionMap,
  loras: readonly LoraUse[],
  keep: readonly string[] = [],
): ComfyWorkflowGraph {
  const graph = structuredClone(template);
  if (loras.length === 0) return graph;
  const checkpoint = map.checkpointNode;
  if (checkpoint === undefined || graph[checkpoint] === undefined) {
    throw new ProviderError(
      "comfyui.no-lora-input",
      "this workflow cannot draw with a character LoRA: its injection map names no checkpoint node.",
    );
  }
  let model: unknown[] = [checkpoint, 0];
  let clip: unknown[] = [checkpoint, 1];
  const added: string[] = [];
  loras.forEach((lora, index) => {
    const id = `${LORA_NODE}_${index + 1}`;
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model,
        clip,
        lora_name: lora.name,
        strength_model: lora.strength,
        strength_clip: lora.strength,
      },
    };
    model = [id, 0];
    clip = [id, 1];
    added.push(id);
  });
  for (const [id, node] of Object.entries(graph)) {
    if (added.includes(id) || keep.includes(id)) continue;
    for (const [key, value] of Object.entries(node.inputs ?? {})) {
      if (isLinkTo(value, checkpoint, 0)) node.inputs[key] = model;
      else if (isLinkTo(value, checkpoint, 1)) node.inputs[key] = clip;
    }
  }
  return graph;
}

/** A two-person picture's halves: each person alone, drawn where they stand. */
export interface SideBySidePerson {
  /** The uploaded reference image's name on the engine. */
  image: string;
  side: "left" | "right";
  /** That person alone in the setting, the way the picture's own prompt is written. */
  prompt: string;
  /** That person's LoRA, drawn with in their half only. */
  lora?: LoraUse;
}

/** The node ids Toony adds for a side-by-side picture (suffixed with the side). */
export const HALF_TEXT_NODE = "toony_half_text";
export const HALF_LORA_NODE = "toony_half_lora";
export const HALF_SAMPLER_NODE = "toony_half_sampler";
export const HALVES_JOINED_NODE = "toony_halves_joined";
/** Each half is this share of the width, so the halves overlap in the middle. */
const HALF_SHARE = 0.62;
/**
 * How much the whole picture is redrawn over the joined halves: enough to
 * join them into one scene and light, little enough that each person stays
 * where their half put them. Chosen on same-seed renders.
 */
export const SIDE_BY_SIDE_BLEND = 0.5;

const round8 = (value: number) => Math.max(8, Math.floor(value / 8) * 8);

/**
 * Draw a two-person picture side by side, in a COPY: each person is drawn
 * alone in their own half of the frame (their prompt and reference), the two
 * halves are joined in latent space with a soft seam, and the graph's own
 * sampler then redraws the whole frame from the joined halves at
 * `SIDE_BY_SIDE_BLEND`, with both references kept to their sides. The picture's
 * prompt decides the scene; the halves decide who stands where, which the
 * prompt alone does not (the model put people on the wrong side in most
 * same-seed renders). Needs the graph's latent size, a sampler with a linked
 * model, `latent_image` and `denoise`, and a text encoder at the positive node.
 */
export function withSideBySide(
  template: ComfyWorkflowGraph,
  map: WorkflowInjectionMap,
  people: readonly [SideBySidePerson, SideBySidePerson],
): ComfyWorkflowGraph {
  const width = template[map.widthNode]?.inputs[map.widthInput];
  const height = template[map.heightNode]?.inputs[map.heightInput];
  const encoder = template[map.positiveNode];
  const sampler = template[map.seedNode];
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    encoder === undefined ||
    !Array.isArray(encoder.inputs.clip) ||
    sampler === undefined ||
    !Array.isArray(sampler.inputs.latent_image) ||
    !("denoise" in sampler.inputs)
  ) {
    throw new ProviderError(
      "comfyui.no-side-by-side",
      "this workflow cannot draw two people side by side: it needs a numeric latent size, a text encoder at the positive node and a sampler with latent_image and denoise inputs.",
    );
  }
  const graph = withReferenceImages(
    template,
    map,
    people.map((person) => ({ image: person.image, side: person.side })),
  );
  const blend = graph[map.seedNode] as ComfyWorkflowNode;
  const seed = typeof blend.inputs.seed === "number" ? blend.inputs.seed : 0;
  const half = round8(width * HALF_SHARE);
  const overlap = Math.max(0, 2 * half - width);
  const halves = people.map((person, index) => {
    const id = (base: string) => `${base}_${person.side}`;
    graph[id("toony_half_load")] = { class_type: "LoadImage", inputs: { image: person.image } };
    // A person with a LoRA draws their half with it: a LoRA on the graph's own
    // model and text encoder, and an adapter loader of its own on top.
    let adapter = REFERENCE_ADAPTER_NODE;
    let clip: unknown = structuredClone(encoder.inputs.clip);
    if (person.lora !== undefined) {
      const lora = id(HALF_LORA_NODE);
      const shared = graph[REFERENCE_ADAPTER_NODE] as ComfyWorkflowNode;
      graph[lora] = {
        class_type: "LoraLoader",
        inputs: {
          model: structuredClone(shared.inputs.model),
          clip,
          lora_name: person.lora.name,
          strength_model: person.lora.strength,
          strength_clip: person.lora.strength,
        },
      };
      adapter = id("toony_half_adapter");
      graph[adapter] = {
        class_type: "IPAdapterUnifiedLoader",
        inputs: { model: [lora, 0], preset: structuredClone(shared.inputs.preset) },
      };
      clip = [lora, 1];
    }
    graph[id("toony_half_apply")] = {
      class_type: "IPAdapter",
      inputs: {
        model: [adapter, 0],
        ipadapter: [adapter, 1],
        image: [id("toony_half_load"), 0],
        weight: REFERENCE_WEIGHT,
        start_at: REFERENCE_START,
        end_at: 1,
        weight_type: REFERENCE_WEIGHT_TYPE,
      },
    };
    graph[id(HALF_TEXT_NODE)] = {
      class_type: "CLIPTextEncode",
      inputs: { text: person.prompt, clip },
    };
    graph[id("toony_half_latent")] = {
      class_type: "EmptyLatentImage",
      inputs: { width: half, height, batch_size: 1 },
    };
    graph[id(HALF_SAMPLER_NODE)] = {
      class_type: sampler.class_type,
      inputs: {
        ...structuredClone(sampler.inputs),
        model: [id("toony_half_apply"), 0],
        positive: [id(HALF_TEXT_NODE), 0],
        latent_image: [id("toony_half_latent"), 0],
        seed: seed + index + 1,
        denoise: 1,
      },
    };
    return { side: person.side, latent: [id(HALF_SAMPLER_NODE), 0] };
  });
  const left = halves.find((h) => h.side === "left") ?? halves[0];
  const right = halves.find((h) => h.side === "right") ?? halves[1];
  graph.toony_halves_canvas = {
    class_type: "EmptyLatentImage",
    inputs: { width, height, batch_size: 1 },
  };
  graph.toony_halves_left = {
    class_type: "LatentComposite",
    inputs: {
      samples_to: ["toony_halves_canvas", 0],
      samples_from: left?.latent,
      x: 0,
      y: 0,
      feather: 0,
    },
  };
  graph[HALVES_JOINED_NODE] = {
    class_type: "LatentComposite",
    inputs: {
      samples_to: ["toony_halves_left", 0],
      samples_from: right?.latent,
      x: width - half,
      y: 0,
      feather: Math.min(128, round8(overlap / 2)),
    },
  };
  blend.inputs.latent_image = [HALVES_JOINED_NODE, 0];
  blend.inputs.denoise = SIDE_BY_SIDE_BLEND;
  return graph;
}

/** One reference over the whole frame. */
export function withReferenceImage(
  template: ComfyWorkflowGraph,
  map: WorkflowInjectionMap,
  image: string,
): ComfyWorkflowGraph {
  return withReferenceImages(template, map, [{ image }]);
}
