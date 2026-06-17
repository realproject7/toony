// The ComfyUI generation provider: a real HTTP client against ComfyUI's
// documented stable API, conforming to the provider-neutral ImageProvider
// contract. It submits a parameterized workflow graph, polls /history until the
// prompt produces an output image, fetches the bytes via /view, and returns them
// as a ProviderResult the existing ingestion path consumes.
//
// `transmitsRemotely` is true: the provider sends prompt text to the configured
// ComfyUI server. For a localhost install that never leaves the machine, but the
// flag stays true so callers gate any non-local endpoint behind an explicit
// opt-in (Toony does not inspect the URL to relax this).
//
// Toony imposes NO content policy here; whatever the operator's ComfyUI install
// produces is ingested as-is.

import { randomUUID } from "node:crypto";
import type { ComfyUIConfig } from "./comfyui-config.js";
import {
  buildPromptRequest,
  buildViewUrl,
  type ComfyImageRef,
  parsePromptId,
  readHistory,
} from "./comfyui-protocol.js";
import { buildWorkflow, type WorkflowParams } from "./comfyui-workflow.js";
import { ProviderError } from "./errors.js";
import { contentTypeFor, detectImageFormat } from "./format.js";
import type { ImageProvider, ImageRequest, ProviderResult } from "./types.js";

/** A minimal fetch surface, so tests can drive the client without a server. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A clock/sleep surface, injectable so tests do not wait in real time. */
export interface ComfyUIClientDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_WIDTH = 832;
const DEFAULT_HEIGHT = 1216;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A non-negative 32-bit seed, as ComfyUI samplers expect. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

function readOption(
  options: ImageRequest["options"],
  key: string,
): string | number | boolean | undefined {
  return options?.[key];
}

function intOption(options: ImageRequest["options"], key: string, fallback: number): number {
  const raw = readOption(options, key);
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  return fallback;
}

export class ComfyUIProvider implements ImageProvider {
  readonly id = "comfyui";
  readonly kind = "comfyui" as const;
  // Sends prompt content to the configured server; gate non-local use upstream.
  readonly transmitsRemotely = true;

  private readonly config: ComfyUIConfig;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(config: ComfyUIConfig, deps: ComfyUIClientDeps = {}) {
    this.config = config;
    const f = deps.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (f === undefined) {
      throw new ProviderError(
        "comfyui.no-fetch",
        "no fetch implementation available (Node 20+ provides global fetch).",
      );
    }
    this.fetch = f;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
  }

  async produce(request: ImageRequest): Promise<ProviderResult> {
    const positivePrompt = (request.prompt ?? "").trim();
    if (positivePrompt.length === 0) {
      throw new ProviderError(
        "comfyui.no-prompt",
        "ComfyUI generation requires a non-empty prompt.",
      );
    }

    const negativeRaw = readOption(request.options, "negativePrompt");
    const seedRaw = readOption(request.options, "seed");
    const params: WorkflowParams = {
      positivePrompt,
      negativePrompt: typeof negativeRaw === "string" ? negativeRaw : "",
      width: intOption(request.options, "width", DEFAULT_WIDTH),
      height: intOption(request.options, "height", DEFAULT_HEIGHT),
      seed:
        typeof seedRaw === "number" && Number.isInteger(seedRaw) && seedRaw >= 0
          ? seedRaw
          : randomSeed(),
      checkpoint: this.config.checkpoint,
    };

    const graph = buildWorkflow(this.config.workflow, params, this.config.injectionMap);
    const clientId = randomUUID();

    const promptId = await this.submit(graph, clientId);
    const image = await this.waitForImage(promptId);
    const bytes = await this.fetchImage(image);

    const format = detectImageFormat(bytes);
    if (format === null) {
      throw new ProviderError(
        "comfyui.unknown-format",
        "ComfyUI returned data that is not a recognized image (PNG, JPEG, WebP, or GIF).",
      );
    }

    return {
      bytes,
      format,
      provenance: {
        source: "comfyui",
        providerId: this.id,
        contentType: contentTypeFor(format),
      },
    };
  }

  private async submit(graph: unknown, clientId: string): Promise<string> {
    const body = JSON.stringify(buildPromptRequest(graph, clientId));
    let response: Response;
    try {
      response = await this.fetch(`${this.config.url}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch {
      throw new ProviderError(
        "comfyui.connect",
        "could not reach the ComfyUI server (check that it is running and the endpoint is correct).",
      );
    }
    if (!response.ok) {
      // ComfyUI returns 400 with { error, node_errors } for a bad graph.
      const parsed = await safeJson(response);
      if (parsed !== undefined) parsePromptId(parsed); // throws an actionable error
      throw new ProviderError(
        "comfyui.prompt-http",
        `ComfyUI /prompt failed with HTTP ${response.status}.`,
      );
    }
    const parsed = await safeJson(response);
    return parsePromptId(parsed);
  }

  private async waitForImage(promptId: string): Promise<ComfyImageRef> {
    const deadline = this.now() + this.config.timeoutMs;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetch(`${this.config.url}/history/${encodeURIComponent(promptId)}`);
      } catch {
        throw new ProviderError(
          "comfyui.connect",
          "lost connection to the ComfyUI server while waiting for the result.",
        );
      }
      if (response.ok) {
        const status = readHistory(await safeJson(response), promptId);
        if (status.state === "complete") return status.image;
        if (status.state === "failed") {
          throw new ProviderError("comfyui.execution", status.message);
        }
      }
      if (this.now() >= deadline) {
        throw new ProviderError(
          "comfyui.timeout",
          `ComfyUI did not produce an image within ${Math.round(this.config.timeoutMs / 1000)}s.`,
        );
      }
      await this.sleep(this.config.pollIntervalMs);
    }
  }

  private async fetchImage(image: ComfyImageRef): Promise<Uint8Array> {
    const url = buildViewUrl(this.config.url, image);
    let response: Response;
    try {
      response = await this.fetch(url);
    } catch {
      throw new ProviderError(
        "comfyui.connect",
        "could not fetch the generated image from the ComfyUI server.",
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        "comfyui.view-http",
        `fetching the generated image failed with HTTP ${response.status}.`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
