// The ComfyUI generation provider: a real HTTP client against ComfyUI's
// documented stable API, conforming to the provider-neutral ImageProvider
// contract. It submits a parameterized workflow graph, polls /history until the
// prompt produces an output image, fetches the bytes via /view, and returns them
// as a ProviderResult the existing ingestion path consumes.
//
// `transmitsRemotely` is derived from the configured endpoint, per the
// ImageProvider contract: false when the endpoint is loopback (the prompt never
// leaves the machine), true for anything else so callers gate it behind an
// explicit opt-in. Anything that is not provably loopback counts as remote —
// a LAN address is still another machine.
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

// Non-workflow FALLBACK latent dims used when a request omits width/height. These
// intentionally stay INDEPENDENT of the bundled default-txt2img.workflow.json's
// own EmptyLatentImage defaults (#154 item 4, dropped): the JSON is the graph's
// own defaults, this is the request fallback — coupling them would mean parsing a
// JSON asset for constants, not worth it. They may match today; that's fine.

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

/** A caller-supplied size, or undefined to leave the workflow's own value alone. */
function explicitSize(options: ImageRequest["options"], key: string): number | undefined {
  const raw = readOption(options, key);
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

/**
 * Whether `endpoint` addresses this machine, so prompt content sent to it never
 * leaves. Only provable loopback counts: an unparseable URL, a LAN address, or
 * a wildcard bind like `0.0.0.0` all read as remote, because the safe failure
 * for a privacy gate is to demand the opt-in.
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  // URL keeps IPv6 hosts in brackets.
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "localhost" || bare === "::1") return true;
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  return octets[0] === 127;
}

export class ComfyUIProvider implements ImageProvider {
  readonly id = "comfyui";
  readonly kind = "comfyui" as const;

  /**
   * True when prompt content would leave this machine. A loopback endpoint keeps
   * everything local, so requiring `--allow-remote` for it would train users to
   * pass the remote opt-in by reflex — the opposite of what the gate is for.
   */
  get transmitsRemotely(): boolean {
    return !isLoopbackEndpoint(this.config.url);
  }

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
      // Only pass a size when one was explicitly requested. Absent, the
      // workflow's own dimensions stand — a pack ships a graph sized for its
      // genre, and overwriting that with a portrait default made every pack
      // render at 832x1216 no matter what it declared (#202).
      width: explicitSize(request.options, "width"),
      height: explicitSize(request.options, "height"),
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
