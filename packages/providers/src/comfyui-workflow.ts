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
  width: number;
  height: number;
  seed: number;
  /** Optional checkpoint filename, applied only when the map names a node. */
  checkpoint?: string;
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
  setInput(graph, map.widthNode, map.widthInput, params.width, "the image width");
  setInput(graph, map.heightNode, map.heightInput, params.height, "the image height");
  setInput(graph, map.seedNode, map.seedInput, params.seed, "the sampler seed");

  if (
    params.checkpoint !== undefined &&
    map.checkpointNode !== undefined &&
    map.checkpointInput !== undefined
  ) {
    setInput(graph, map.checkpointNode, map.checkpointInput, params.checkpoint, "the checkpoint");
  }

  return graph;
}
