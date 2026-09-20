// Pure parsing/encoding for ComfyUI's documented stable HTTP API. Kept free of
// network I/O so request building, /history parsing, and /view URL construction
// are unit-testable against named fixtures without a live server.
//
// API shapes used:
//   POST /prompt            { prompt: <graph>, client_id }  -> { prompt_id }
//     rejected (HTTP 400)   { error: { message }, node_errors: { <nodeId>: {
//                             class_type, errors: [{ message, extra_info }] } } }
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
      const nodeErrors = (response as { node_errors?: unknown }).node_errors;
      throw new ProviderError(
        "comfyui.prompt-rejected",
        `ComfyUI rejected the workflow: ${describeError(error)}${describeNodeErrors(nodeErrors)}`,
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

/**
 * Render ComfyUI's per-node validation failures as indented lines appended to
 * the rejection message: one line per reported error, carrying the node id, its
 * class, the offending field and value, and the valid values when the server
 * listed them. `error.message` alone is a fixed string ("Prompt outputs failed
 * validation") for a whole class of rejections, so these lines are the only
 * part that says which node to fix.
 *
 * Returns "" when the rejection carries no per-node detail (ComfyUI sends
 * `node_errors: {}` for whole-graph refusals such as an uninstalled node type,
 * whose own `error.message` already names the problem), leaving those messages
 * exactly as they were.
 */
function describeNodeErrors(nodeErrors: unknown): string {
  if (typeof nodeErrors !== "object" || nodeErrors === null) return "";
  const lines: string[] = [];
  for (const [nodeId, entry] of Object.entries(nodeErrors as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const classType = readString(entry, "class_type");
    const label = classType === null ? `node ${nodeId}` : `node ${nodeId} (${classType})`;
    const errors = (entry as { errors?: unknown }).errors;
    const reported = Array.isArray(errors) ? errors : [];
    if (reported.length === 0) {
      lines.push(`  ${label}: rejected, no detail given.`);
      continue;
    }
    for (const nodeError of reported) {
      lines.push(`  ${label} ${describeNodeError(nodeError)}`);
    }
  }
  return lines.length === 0 ? "" : `\n${lines.join("\n")}`;
}

/**
 * One reported error as `<field>: <message> (got <value>, valid: a, b)`. A node
 * error is { message, details, extra_info: { input_name, received_value,
 * input_config } }; `details` is not used because its shape varies by error
 * type (a bare field name for a missing input, a full sentence for a rejected
 * value), while `extra_info` is uniform.
 */
function describeNodeError(nodeError: unknown): string {
  const message = readString(nodeError, "message") ?? "rejected";
  const extra =
    typeof nodeError === "object" && nodeError !== null
      ? (nodeError as { extra_info?: unknown }).extra_info
      : undefined;
  const field = readString(extra, "input_name");
  const notes: string[] = [];
  if (typeof extra === "object" && extra !== null && "received_value" in extra) {
    notes.push(`got ${JSON.stringify((extra as { received_value: unknown }).received_value)}`);
  }
  const valid = readValidValues(extra);
  if (valid !== null) notes.push(`valid: ${valid}`);
  const head = field === null ? "" : `${field}: `;
  const tail = notes.length === 0 ? "" : ` (${notes.join(", ")})`;
  return `${head}${message}${tail}`;
}

/**
 * The valid values for a rejected input, comma-joined, or null when the server
 * did not list them. `extra_info.input_config` is [<options>, <ui hints>] for a
 * legacy combo or ["COMBO", { options }] for a V3 combo. Other input types,
 * including ["INT", { min, max }], do not carry a valid-values list. ComfyUI
 * replaces input_config with null for lists longer than 20 entries.
 */
function readValidValues(extra: unknown): string | null {
  if (typeof extra !== "object" || extra === null) return null;
  const config = (extra as { input_config?: unknown }).input_config;
  if (!Array.isArray(config)) return null;
  let options = config[0];
  if (options === "COMBO") {
    const metadata = config[1];
    if (typeof metadata !== "object" || metadata === null) return null;
    options = (metadata as { options?: unknown }).options;
  }
  if (!Array.isArray(options) || options.length === 0) return null;
  return options.map((option) => String(option)).join(", ");
}

/** Read a non-empty string property, or null if absent or another type. */
function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" && found.length > 0 ? found : null;
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
