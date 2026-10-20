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

/**
 * Turn a text-to-image graph into an image-to-image one, in a COPY: the
 * uploaded `image` is loaded and encoded with the graph's own VAE, the sampler
 * (the node the map sends the seed to) starts from it instead of its empty
 * latent, and its denoise becomes `strength`. The output keeps the source's
 * size, so the graph's latent size no longer applies.
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
  graph[SOURCE_ENCODE_NODE] = {
    class_type: "VAEEncode",
    inputs: { pixels: [SOURCE_LOAD_NODE, 0], vae: structuredClone(decoder.inputs.vae) },
  };
  sampler.inputs.latent_image = [SOURCE_ENCODE_NODE, 0];
  sampler.inputs.denoise = strength;
  return graph;
}
