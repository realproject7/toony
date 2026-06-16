import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildWorkflow,
  type ComfyWorkflowGraph,
  DEFAULT_INJECTION_MAP,
  parseWorkflowGraph,
  type WorkflowInjectionMap,
} from "../comfyui-workflow.js";
import { ProviderError } from "../errors.js";

// A minimal but structurally faithful API-format graph matching the default map.
function templateGraph(): ComfyWorkflowGraph {
  return {
    "3": {
      class_type: "KSampler",
      inputs: { seed: 0, model: ["4", 0], positive: ["6", 0], negative: ["7", 0] },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
  };
}

test("buildWorkflow injects prompts, size, seed, and checkpoint at mapped nodes", () => {
  const graph = buildWorkflow(templateGraph(), {
    positivePrompt: "a hero on a rooftop, webtoon style",
    negativePrompt: "lowres, watermark",
    width: 832,
    height: 1216,
    seed: 42,
    checkpoint: "operatorModel.safetensors",
  });

  assert.equal(graph["6"]?.inputs.text, "a hero on a rooftop, webtoon style");
  assert.equal(graph["7"]?.inputs.text, "lowres, watermark");
  assert.equal(graph["5"]?.inputs.width, 832);
  assert.equal(graph["5"]?.inputs.height, 1216);
  assert.equal(graph["3"]?.inputs.seed, 42);
  assert.equal(graph["4"]?.inputs.ckpt_name, "operatorModel.safetensors");
});

test("buildWorkflow does not mutate the template", () => {
  const template = templateGraph();
  buildWorkflow(template, {
    positivePrompt: "x",
    negativePrompt: "y",
    width: 100,
    height: 200,
    seed: 7,
  });
  assert.equal(template["6"]?.inputs.text, "");
  assert.equal(template["5"]?.inputs.width, 512);
});

test("buildWorkflow leaves the checkpoint untouched when none is provided", () => {
  const graph = buildWorkflow(templateGraph(), {
    positivePrompt: "x",
    negativePrompt: "",
    width: 100,
    height: 200,
    seed: 7,
  });
  assert.equal(graph["4"]?.inputs.ckpt_name, "model.safetensors");
});

test("buildWorkflow supports an operator's custom node mapping", () => {
  const custom: WorkflowInjectionMap = {
    ...DEFAULT_INJECTION_MAP,
    positiveNode: "100",
    positiveInput: "prompt",
    negativeNode: "100",
    negativeInput: "neg",
    widthNode: "200",
    heightNode: "200",
    seedNode: "300",
    checkpointNode: undefined,
    checkpointInput: undefined,
  };
  const graph: ComfyWorkflowGraph = {
    "100": { class_type: "CustomPromptNode", inputs: { prompt: "", neg: "" } },
    "200": { class_type: "CustomSize", inputs: { width: 0, height: 0 } },
    "300": { class_type: "CustomSeed", inputs: { seed: 0 } },
  };
  const built = buildWorkflow(
    graph,
    {
      positivePrompt: "p",
      negativePrompt: "n",
      width: 640,
      height: 960,
      seed: 9,
    },
    custom,
  );
  assert.equal(built["100"]?.inputs.prompt, "p");
  assert.equal(built["100"]?.inputs.neg, "n");
  assert.equal(built["200"]?.inputs.width, 640);
  assert.equal(built["300"]?.inputs.seed, 9);
});

test("buildWorkflow throws an actionable error when a mapped node is missing", () => {
  const graph: ComfyWorkflowGraph = {
    "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  };
  try {
    buildWorkflow(graph, {
      positivePrompt: "p",
      negativePrompt: "n",
      width: 1,
      height: 1,
      seed: 1,
    });
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "comfyui.workflow-node-missing");
  }
});

test("parseWorkflowGraph accepts a valid API-format graph", () => {
  const text = JSON.stringify(templateGraph());
  const graph = parseWorkflowGraph(text);
  assert.equal(graph["3"]?.class_type, "KSampler");
});

test("parseWorkflowGraph rejects invalid JSON and wrong shapes", () => {
  assert.throws(() => parseWorkflowGraph("{not json"), ProviderError);
  assert.throws(() => parseWorkflowGraph("[]"), ProviderError);
  assert.throws(() => parseWorkflowGraph(JSON.stringify({ "1": { inputs: {} } })), ProviderError);
});
