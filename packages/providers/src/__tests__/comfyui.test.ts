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

test("provider metadata identifies the comfyui source", () => {
  const provider = new ComfyUIProvider(testConfig(), { fetch: async () => new Response() });
  assert.equal(provider.id, "comfyui");
  assert.equal(provider.kind, "comfyui");
  // This test used to assert `transmitsRemotely === true` while testConfig()
  // points at 127.0.0.1, so it pinned the #180 defect rather than the contract:
  // ImageProvider documents the flag as "false for local sources
  // (manual/local/ComfyUI-on-localhost)". Remoteness is now derived from the
  // endpoint and is covered by the two tests at the end of this file.
  assert.equal(provider.transmitsRemotely, false, "testConfig() is loopback");
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
      // This call passes width: 832 explicitly, and an explicit size must still
      // win over the workflow's own value (#202).
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

// #180: the gate must reflect where content actually goes. The ImageProvider
// contract already said "false for local sources (manual/local/ComfyUI-on-
// localhost)"; the implementation ignored the endpoint and hardcoded true, so a
// purely local generate demanded the remote opt-in.

test("a loopback endpoint does not transmit remotely (#180)", () => {
  for (const url of [
    "http://127.0.0.1:8188",
    "http://localhost:8188",
    "http://[::1]:8188",
    // The whole 127.0.0.0/8 block is loopback, not just .0.1.
    "http://127.4.5.6:8188",
    "https://localhost:8443",
  ]) {
    const provider = new ComfyUIProvider({ ...testConfig(), url });
    assert.equal(provider.transmitsRemotely, false, `${url} should be local`);
  }
});

test("a non-loopback endpoint still requires the remote opt-in (#180)", () => {
  for (const url of [
    "http://192.168.1.50:8188",
    "http://10.0.0.7:8188",
    "https://comfy.example.com",
    // A wildcard bind is not provably this machine, so it reads as remote: the
    // safe failure for a privacy gate is to demand the opt-in.
    "http://0.0.0.0:8188",
    // 127 must be the FIRST octet; a look-alike elsewhere is a real host.
    "http://10.127.0.1:8188",
  ]) {
    const provider = new ComfyUIProvider({ ...testConfig(), url });
    assert.equal(provider.transmitsRemotely, true, `${url} should be remote`);
  }
});

test("an unparseable endpoint reads as remote rather than local (#180)", () => {
  const provider = new ComfyUIProvider({ ...testConfig(), url: "not a url" });
  assert.equal(provider.transmitsRemotely, true);
});

// #202: a pack ships a workflow sized for its genre, and cut aspect is the
// largest single lever it has. These assert the POSTed GRAPH, not that a call
// happened — the bug was invisible to any test that only checked the latter.

async function submittedGraph(
  options: Readonly<Record<string, string | number | boolean>>,
): Promise<Record<string, unknown>> {
  let graph: Record<string, { inputs: Record<string, unknown> }> = {};
  const fetch: FetchLike = async (url, init) => {
    if (url.endsWith("/prompt")) {
      graph = JSON.parse(String(init?.body)).prompt;
      return jsonResponse(promptAcceptedResponse());
    }
    if (url.includes("/history/")) return jsonResponse(historyCompleteResponse(PROMPT_ID));
    return new Response(pngWithMetadata(), { headers: { "content-type": "image/png" } });
  };
  const provider = new ComfyUIProvider(testConfig(), { fetch, sleep: async () => {} });
  await provider.produce({ prompt: "x", options });
  const latent = graph["5"];
  assert.ok(latent, "the submitted graph must carry the latent node");
  return latent.inputs;
}

test("without size options the workflow's own dimensions are kept (#202)", async () => {
  const latent = await submittedGraph({});
  assert.equal(latent.width, 512, "workflow width must survive");
  assert.equal(latent.height, 512, "workflow height must survive");
});

test("explicit size options still override the workflow (#202)", async () => {
  const latent = await submittedGraph({ width: 1024, height: 576 });
  assert.equal(latent.width, 1024);
  assert.equal(latent.height, 576);
});

test("one explicit dimension overrides only that dimension (#202)", async () => {
  const latent = await submittedGraph({ width: 1024 });
  assert.equal(latent.width, 1024, "explicit width wins");
  assert.equal(latent.height, 512, "unset height keeps the workflow value");
});
