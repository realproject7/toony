import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyCompleteInSubfolderResponse,
  historyCompleteResponse,
  historyErrorResponse,
  historyPendingResponse,
  historyTempOnlyResponse,
  promptAcceptedResponse,
  promptRejectedResponse,
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

test("parsePromptId surfaces a rejected workflow as an actionable error", () => {
  try {
    parsePromptId(promptRejectedResponse());
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "comfyui.prompt-rejected");
    assert.match(error.message, /validation/i);
  }
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
