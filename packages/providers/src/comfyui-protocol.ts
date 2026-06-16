// Pure parsing/encoding for ComfyUI's documented stable HTTP API. Kept free of
// network I/O so request building, /history parsing, and /view URL construction
// are unit-testable against named fixtures without a live server.
//
// API shapes used:
//   POST /prompt            { prompt: <graph>, client_id }  -> { prompt_id }
//   GET  /history/{id}      { [id]: { outputs: { <nodeId>: { images: [desc] } },
//                                     status?: { ... } } }
//   GET  /view?filename&subfolder&type   -> raw image bytes
//
// An image descriptor is { filename, subfolder, type } (type is usually
// "output"; "temp" for previews).

import { ProviderError } from "./errors.js";

/** A ComfyUI output image descriptor from /history. */
export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

/** Body POSTed to /prompt. */
export interface PromptRequestBody {
  prompt: unknown;
  client_id: string;
}

/** Build the JSON body for POST /prompt. */
export function buildPromptRequest(graph: unknown, clientId: string): PromptRequestBody {
  return { prompt: graph, client_id: clientId };
}

/** Parse the prompt_id out of a POST /prompt response object. */
export function parsePromptId(response: unknown): string {
  if (typeof response !== "object" || response === null) {
    throw new ProviderError(
      "comfyui.prompt-response",
      "ComfyUI /prompt returned an unexpected body.",
    );
  }
  const promptId = (response as { prompt_id?: unknown }).prompt_id;
  if (typeof promptId !== "string" || promptId.length === 0) {
    // ComfyUI returns { error, node_errors } when it rejects a graph.
    const error = (response as { error?: unknown }).error;
    if (error !== undefined) {
      throw new ProviderError(
        "comfyui.prompt-rejected",
        `ComfyUI rejected the workflow: ${describeError(error)}`,
      );
    }
    throw new ProviderError(
      "comfyui.prompt-response",
      "ComfyUI /prompt did not return a prompt_id.",
    );
  }
  return promptId;
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "see the ComfyUI server log for node errors.";
}

/** Result of inspecting a /history response for a prompt. */
export type HistoryStatus =
  | { state: "pending" }
  | { state: "failed"; message: string }
  | { state: "complete"; image: ComfyImageRef };

/**
 * Inspect a parsed GET /history/{id} response for the given prompt id and decide
 * whether the prompt is still pending, has failed, or has a ready output image.
 * Returns the FIRST output image found (history[id].outputs[node].images[0]).
 */
export function readHistory(response: unknown, promptId: string): HistoryStatus {
  if (typeof response !== "object" || response === null) {
    return { state: "pending" };
  }
  const entry = (response as Record<string, unknown>)[promptId];
  if (entry === undefined || typeof entry !== "object" || entry === null) {
    // Not in history yet: still queued/running.
    return { state: "pending" };
  }

  const status = (entry as { status?: unknown }).status;
  if (typeof status === "object" && status !== null) {
    const statusStr = (status as { status_str?: unknown }).status_str;
    if (statusStr === "error") {
      return { state: "failed", message: "ComfyUI reported an execution error for the prompt." };
    }
  }

  const outputs = (entry as { outputs?: unknown }).outputs;
  if (typeof outputs !== "object" || outputs === null) {
    return { state: "pending" };
  }

  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (typeof node !== "object" || node === null) continue;
    const images = (node as { images?: unknown }).images;
    if (!Array.isArray(images) || images.length === 0) continue;
    const first = images[0];
    const ref = toImageRef(first);
    if (ref !== null && ref.type !== "temp") {
      return { state: "complete", image: ref };
    }
  }

  // Outputs exist but no savable image yet (e.g. only temp previews): keep waiting.
  return { state: "pending" };
}

function toImageRef(value: unknown): ComfyImageRef | null {
  if (typeof value !== "object" || value === null) return null;
  const filename = (value as { filename?: unknown }).filename;
  if (typeof filename !== "string" || filename.length === 0) return null;
  const subfolder = (value as { subfolder?: unknown }).subfolder;
  const type = (value as { type?: unknown }).type;
  return {
    filename,
    subfolder: typeof subfolder === "string" ? subfolder : "",
    type: typeof type === "string" ? type : "output",
  };
}

/**
 * Build the GET /view URL that fetches an output image's bytes. `baseUrl` has no
 * trailing slash (config normalizes it).
 */
export function buildViewUrl(baseUrl: string, image: ComfyImageRef): string {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  return `${baseUrl}/view?${params.toString()}`;
}
