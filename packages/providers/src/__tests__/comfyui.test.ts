import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyCompleteResponse,
  historyErrorResponse,
  historyPendingResponse,
  promptAcceptedResponse,
  promptRejectedResponse,
} from "../__fixtures__/comfyui-responses.js";
import { pngWithMetadata } from "../__fixtures__/containers.js";
import { ComfyUIProvider, type FetchLike } from "../comfyui.js";
import type { ComfyUIConfig } from "../comfyui-config.js";
import { DEFAULT_INJECTION_MAP } from "../comfyui-workflow.js";
import { ProviderError } from "../errors.js";

const PROMPT_ID = "f1e2d3c4-0000-4000-8000-aaaabbbbcccc";

function testConfig(): ComfyUIConfig {
  return {
    url: "http://127.0.0.1:8188",
    workflow: {
      "3": { class_type: "KSampler", inputs: { seed: 0 } },
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    },
    injectionMap: DEFAULT_INJECTION_MAP,
    timeoutMs: 5_000,
    pollIntervalMs: 1,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
}

test("provider metadata reflects a remote-capable comfyui source", () => {
  const provider = new ComfyUIProvider(testConfig(), { fetch: async () => new Response() });
  assert.equal(provider.id, "comfyui");
  assert.equal(provider.kind, "comfyui");
  assert.equal(provider.transmitsRemotely, true);
});

test("produce submits, polls until complete, fetches bytes, and returns a result", async () => {
  const calls: string[] = [];
  let polls = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/prompt")) {
      // The submitted graph must carry the injected prompt.
      const body = JSON.parse(String(init?.body));
      assert.equal(body.prompt["6"].inputs.text, "a webtoon hero");
      assert.equal(body.prompt["7"].inputs.text, "blurry");
      assert.equal(body.prompt["5"].inputs.width, 832);
      assert.equal(typeof body.client_id, "string");
      return jsonResponse(promptAcceptedResponse());
    }
    if (url.includes("/history/")) {
      polls += 1;
      return jsonResponse(
        polls < 2 ? historyPendingResponse() : historyCompleteResponse(PROMPT_ID),
      );
    }
    if (url.includes("/view")) {
      assert.match(url, /filename=toony_00001_\.png/);
      return bytesResponse(pngWithMetadata());
    }
    throw new Error(`unexpected url ${url}`);
  };

  const provider = new ComfyUIProvider(testConfig(), { fetch, sleep: async () => {} });
  const result = await provider.produce({
    prompt: "a webtoon hero",
    options: { negativePrompt: "blurry", width: 832, height: 1216, seed: 5 },
  });

  assert.equal(result.format, "png");
  assert.deepEqual(result.provenance, {
    source: "comfyui",
    providerId: "comfyui",
    contentType: "image/png",
  });
  assert.deepEqual(result.bytes, pngWithMetadata());
  assert.ok(polls >= 2, "should have polled /history more than once");
});

test("produce requires a non-empty prompt", async () => {
  const provider = new ComfyUIProvider(testConfig(), { fetch: async () => new Response() });
  await assert.rejects(() => provider.produce({ prompt: "   " }), ProviderError);
});

test("produce surfaces a connection failure as an actionable error", async () => {
  const fetch: FetchLike = async () => {
    throw new TypeError("fetch failed");
  };
  const provider = new ComfyUIProvider(testConfig(), { fetch });
  try {
    await provider.produce({ prompt: "x" });
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "comfyui.connect");
  }
});

test("produce surfaces a rejected workflow", async () => {
  const fetch: FetchLike = async (url) => {
    if (url.endsWith("/prompt")) return jsonResponse(promptRejectedResponse(), 400);
    throw new Error("unexpected");
  };
  const provider = new ComfyUIProvider(testConfig(), { fetch });
  await assert.rejects(
    () => provider.produce({ prompt: "x" }),
    (e: unknown) => {
      return e instanceof ProviderError && e.code === "comfyui.prompt-rejected";
    },
  );
});

test("produce surfaces a server-side execution error", async () => {
  const fetch: FetchLike = async (url) => {
    if (url.endsWith("/prompt")) return jsonResponse(promptAcceptedResponse());
    if (url.includes("/history/")) return jsonResponse(historyErrorResponse(PROMPT_ID));
    throw new Error("unexpected");
  };
  const provider = new ComfyUIProvider(testConfig(), { fetch, sleep: async () => {} });
  await assert.rejects(
    () => provider.produce({ prompt: "x" }),
    (e: unknown) => {
      return e instanceof ProviderError && e.code === "comfyui.execution";
    },
  );
});

test("produce times out when no image appears in time", async () => {
  let clock = 0;
  const fetch: FetchLike = async (url) => {
    if (url.endsWith("/prompt")) return jsonResponse(promptAcceptedResponse());
    if (url.includes("/history/")) return jsonResponse(historyPendingResponse());
    throw new Error("unexpected");
  };
  const provider = new ComfyUIProvider(
    { ...testConfig(), timeoutMs: 10, pollIntervalMs: 5 },
    {
      fetch,
      sleep: async () => {
        clock += 1000; // each poll advances the clock past the deadline
      },
      now: () => clock,
    },
  );
  await assert.rejects(
    () => provider.produce({ prompt: "x" }),
    (e: unknown) => {
      return e instanceof ProviderError && e.code === "comfyui.timeout";
    },
  );
});
