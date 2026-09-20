import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyCompleteInSubfolderResponse,
  historyCompleteResponse,
  historyErrorResponse,
  historyPendingResponse,
  historyTempOnlyResponse,
  promptAcceptedResponse,
  promptRejectedMissingInputResponse,
  promptRejectedMultipleNodesResponse,
  promptRejectedResponse,
  promptRejectedWithoutNodeErrorsResponse,
} from "../__fixtures__/comfyui-responses.js";
import {
  buildPromptRequest,
  buildViewUrl,
  parsePromptId,
  readHistory,
} from "../comfyui-protocol.js";
import { ProviderError } from "../errors.js";

const PROMPT_ID = "f1e2d3c4-0000-4000-8000-aaaabbbbcccc";

test("buildPromptRequest wraps the graph with a client id", () => {
  const graph = { "3": { class_type: "KSampler", inputs: {} } };
  const body = buildPromptRequest(graph, "client-123");
  assert.deepEqual(body, { prompt: graph, client_id: "client-123" });
});

test("parsePromptId extracts prompt_id from an accepted response", () => {
  assert.equal(parsePromptId(promptAcceptedResponse()), PROMPT_ID);
});

/** Run parsePromptId expecting a rejection, and hand back the ProviderError. */
function rejectionOf(response: unknown): ProviderError {
  try {
    parsePromptId(response);
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    return error;
  }
}

test("parsePromptId surfaces a rejected workflow as an actionable error", () => {
  const error = rejectionOf(promptRejectedResponse());
  assert.equal(error.code, "comfyui.prompt-rejected");
  // The whole message, pinned: error.message alone ("Prompt outputs failed
  // validation") is the same string for every validation failure, so the node
  // line is the only part that tells the user what to change.
  assert.equal(
    error.message,
    "ComfyUI rejected the workflow: Prompt outputs failed validation\n" +
      '  node 4 (CheckpointLoaderSimple) ckpt_name: Value not in list (got "model.safetensors", ' +
      "valid: base-model-v1.safetensors)",
  );
});

test("parsePromptId reports every node and field ComfyUI rejected", () => {
  const error = rejectionOf(promptRejectedMultipleNodesResponse());
  assert.equal(error.code, "comfyui.prompt-rejected");
  const lines = error.message.split("\n");
  // One summary line plus exactly one line per reported error: an actionable
  // block, not a dump of the response.
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "ComfyUI rejected the workflow: Prompt outputs failed validation");
  assert.equal(
    lines[1],
    "  node 3 (KSampler) steps: Value 100000 bigger than max of 10000 (got 100000)",
  );
  // ComfyUI drops the option list for combos longer than 20 entries, so this
  // line carries the offending value but no valid values.
  assert.equal(
    lines[2],
    '  node 3 (KSampler) sampler_name: Value not in list (got "not_a_real_sampler")',
  );
  assert.equal(
    lines[3],
    '  node 4 (CheckpointLoaderSimple) ckpt_name: Value not in list (got "model.safetensors", ' +
      "valid: base-model-v1.safetensors)",
  );
});

test("parsePromptId names a missing required input without inventing a value", () => {
  const error = rejectionOf(promptRejectedMissingInputResponse());
  const lines = error.message.split("\n");
  assert.equal(lines.length, 3);
  // extra_info has input_name but no received_value, so no "(got ...)" is added.
  assert.equal(lines[2], "  node 6 (CLIPTextEncode) text: Required input is missing");
});

test("parsePromptId leaves a rejection without node_errors exactly as it was", () => {
  const error = rejectionOf(promptRejectedWithoutNodeErrorsResponse());
  assert.equal(error.code, "comfyui.prompt-rejected");
  // ComfyUI sends node_errors: {} when it refuses the graph as a whole; that
  // message is already actionable and must not grow a detail block.
  assert.equal(
    error.message,
    "ComfyUI rejected the workflow: Node 'ToonyNotARealNodeType' not found. " +
      "The custom node may not be installed.",
  );
  assert.ok(!error.message.includes("\n"));
});

test("parsePromptId lists EVERY valid value ComfyUI offered, in order", () => {
  // Synthetic because the recording machine has a single checkpoint, so every
  // recorded option list has one entry, and one entry cannot tell "join all"
  // apart from "first only", "last only" or "reversed". The plural case is the
  // one #222 exists for: a buyer with three checkpoints must see all three, or
  // they set TOONY_COMFYUI_CHECKPOINT from a truncated list and the choices
  // that would have worked stay invisible.
  const error = rejectionOf({
    error: { message: "Prompt outputs failed validation" },
    node_errors: {
      "4": {
        class_type: "CheckpointLoaderSimple",
        errors: [
          {
            message: "Value not in list",
            extra_info: {
              input_name: "ckpt_name",
              input_config: [
                ["a-model.safetensors", "b-model.safetensors", "c-model.safetensors"],
                { tooltip: "The name of the checkpoint (model) to load." },
              ],
              received_value: "model.safetensors",
            },
          },
        ],
      },
    },
  });
  assert.equal(
    error.message,
    "ComfyUI rejected the workflow: Prompt outputs failed validation\n" +
      '  node 4 (CheckpointLoaderSimple) ckpt_name: Value not in list (got "model.safetensors", ' +
      "valid: a-model.safetensors, b-model.safetensors, c-model.safetensors)",
  );
});

test("parsePromptId still names a reported node whose errors field is not a list", () => {
  // `errors` is read off an unknown-typed external body. ComfyUI always sends an
  // array today, but a node it explicitly named must not vanish from the message
  // if that ever arrives absent or another type.
  for (const errors of [undefined, null, "boom", 7, {}]) {
    const error = rejectionOf({
      error: { message: "Prompt outputs failed validation" },
      node_errors: { "4": { class_type: "CheckpointLoaderSimple", errors } },
    });
    assert.equal(
      error.message,
      "ComfyUI rejected the workflow: Prompt outputs failed validation\n" +
        "  node 4 (CheckpointLoaderSimple): rejected, no detail given.",
    );
  }
});

test("parsePromptId keeps the old rejection message when node_errors is absent or unusable", () => {
  const expected = "ComfyUI rejected the workflow: Prompt outputs failed validation";
  for (const nodeErrors of [undefined, null, {}, 5, "x", []]) {
    const error = rejectionOf({
      error: { message: "Prompt outputs failed validation" },
      node_errors: nodeErrors,
    });
    assert.equal(error.message, expected);
  }
  // An error with no message at all still falls back to the server-log hint.
  assert.match(rejectionOf({ error: { type: "x" } }).message, /see the ComfyUI server log/);
});

test("parsePromptId rejects a body with no prompt_id", () => {
  assert.throws(() => parsePromptId({ number: 1 }), ProviderError);
  assert.throws(() => parsePromptId(null), ProviderError);
});

test("readHistory reports pending before the prompt is in history", () => {
  assert.deepEqual(readHistory(historyPendingResponse(), PROMPT_ID), { state: "pending" });
});

test("readHistory extracts the first output image descriptor on completion", () => {
  const status = readHistory(historyCompleteResponse(PROMPT_ID), PROMPT_ID);
  assert.equal(status.state, "complete");
  assert.ok(status.state === "complete");
  assert.deepEqual(status.image, {
    filename: "toony_00001_.png",
    subfolder: "",
    type: "output",
  });
});

test("readHistory keeps a subfolder on the descriptor", () => {
  const status = readHistory(historyCompleteInSubfolderResponse(PROMPT_ID), PROMPT_ID);
  assert.ok(status.state === "complete");
  assert.equal(status.image.subfolder, "episode-1");
  assert.equal(status.image.filename, "panel.webp");
});

test("readHistory treats a temp-only output as still pending", () => {
  assert.deepEqual(readHistory(historyTempOnlyResponse(PROMPT_ID), PROMPT_ID), {
    state: "pending",
  });
});

test("readHistory reports an execution error", () => {
  const status = readHistory(historyErrorResponse(PROMPT_ID), PROMPT_ID);
  assert.equal(status.state, "failed");
});

test("buildViewUrl encodes filename, subfolder, and type as output query", () => {
  const url = buildViewUrl("http://127.0.0.1:8188", {
    filename: "toony_00001_.png",
    subfolder: "",
    type: "output",
  });
  assert.equal(url, "http://127.0.0.1:8188/view?filename=toony_00001_.png&subfolder=&type=output");
});

test("buildViewUrl percent-encodes a subfolder with spaces", () => {
  const url = buildViewUrl("http://127.0.0.1:8188", {
    filename: "a b.png",
    subfolder: "ep 1",
    type: "output",
  });
  assert.match(url, /filename=a\+b\.png/);
  assert.match(url, /subfolder=ep\+1/);
});
