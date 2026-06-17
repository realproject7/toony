// Runtime configuration for the ComfyUI provider.
//
// SECRETS AND ENDPOINTS ARE RUNTIME-ONLY. The project's `webtoon.json` provider
// entries stay neutral (kind/label) — they NEVER carry an endpoint or key. The
// operator points Toony at their own ComfyUI install through:
//
//   1. Environment variables (highest precedence):
//        TOONY_COMFYUI_URL          base URL of the operator's ComfyUI server
//        TOONY_COMFYUI_WORKFLOW     path to a workflow-graph JSON template
//        TOONY_COMFYUI_CHECKPOINT   checkpoint filename to load
//        TOONY_COMFYUI_CONFIG       path to a JSON config file (see below)
//        TOONY_COMFYUI_TIMEOUT_MS   overall generation timeout in ms
//   2. A local JSON config file (path from TOONY_COMFYUI_CONFIG), e.g.:
//        {
//          "url": "http://127.0.0.1:8188",
//          "workflowPath": "./my-workflow.json",
//          "checkpoint": "myModel.safetensors",
//          "timeoutMs": 180000,
//          "injectionMap": { ... node/param mapping ... }
//        }
//
// The example URL "http://127.0.0.1:8188" is the operator's OWN local instance
// (ComfyUI's documented default address). Nothing here is committed for a real
// server.

import { readFile } from "node:fs/promises";
import {
  type ComfyWorkflowGraph,
  DEFAULT_INJECTION_MAP,
  parseWorkflowGraph,
  type WorkflowInjectionMap,
} from "./comfyui-workflow.js";
import { ProviderError } from "./errors.js";

/** ComfyUI's documented default local address. Not a configured endpoint. */
export const COMFYUI_DEFAULT_LOCAL_URL = "http://127.0.0.1:8188";

/** Default overall timeout for a single generation (3 minutes). */
export const COMFYUI_DEFAULT_TIMEOUT_MS = 180_000;

/** Fully-resolved settings the ComfyUI client runs against. */
export interface ComfyUIConfig {
  url: string;
  workflow: ComfyWorkflowGraph;
  injectionMap: WorkflowInjectionMap;
  checkpoint?: string;
  timeoutMs: number;
  /** Polling interval for /history while waiting for completion. */
  pollIntervalMs: number;
}

/** Raw config-file shape before resolution. All fields optional. */
interface ComfyUIConfigFile {
  url?: string;
  workflowPath?: string;
  workflow?: ComfyWorkflowGraph;
  checkpoint?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  injectionMap?: Partial<WorkflowInjectionMap>;
}

/** Inputs that drive config resolution (env + an explicit override hook). */
export interface ComfyUIConfigSource {
  env?: Record<string, string | undefined>;
  /** Inline overrides (used by tests and callers that already hold values). */
  overrides?: ComfyUIConfigFile;
}

function readConfigFile(text: string, path: string): ComfyUIConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError(
      "comfyui.config-parse",
      `ComfyUI config file at "${path}" is not valid JSON.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError(
      "comfyui.config-shape",
      `ComfyUI config file at "${path}" must be a JSON object.`,
    );
  }
  return parsed as ComfyUIConfigFile;
}

async function loadDefaultWorkflow(): Promise<ComfyWorkflowGraph> {
  // The shipped default graph lives beside this module; resolve relative to it
  // so it works regardless of the consumer's working directory.
  const assetUrl = new URL("./assets/default-txt2img.workflow.json", import.meta.url);
  let text: string;
  try {
    text = await readFile(assetUrl, "utf8");
  } catch {
    throw new ProviderError(
      "comfyui.default-workflow-missing",
      "the bundled default ComfyUI workflow could not be read.",
    );
  }
  return parseWorkflowGraph(text);
}

async function loadWorkflowFromPath(path: string): Promise<ComfyWorkflowGraph> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new ProviderError(
      "comfyui.workflow-read",
      "could not read the ComfyUI workflow template (check the path).",
    );
  }
  return parseWorkflowGraph(text);
}

function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ProviderError("comfyui.config-value", `${label} must be a positive integer.`);
  }
  return n;
}

/**
 * Resolve a complete `ComfyUIConfig` from env, an optional config file, and
 * inline overrides. The ENDPOINT URL is REQUIRED to be configured — there is no
 * baked-in server. When it is missing, this throws an actionable error so the
 * CLI fails clearly instead of pretending to generate.
 */
export async function resolveComfyUIConfig(
  source: ComfyUIConfigSource = {},
): Promise<ComfyUIConfig> {
  const env = source.env ?? {};

  let fromFile: ComfyUIConfigFile = {};
  const configPath = env.TOONY_COMFYUI_CONFIG;
  if (configPath !== undefined && configPath.length > 0) {
    let text: string;
    try {
      text = await readFile(configPath, "utf8");
    } catch {
      throw new ProviderError(
        "comfyui.config-read",
        "could not read the ComfyUI config file named by TOONY_COMFYUI_CONFIG.",
      );
    }
    fromFile = readConfigFile(text, configPath);
  }

  const overrides = source.overrides ?? {};

  // Precedence: inline overrides > env > config file.
  const url = overrides.url ?? env.TOONY_COMFYUI_URL ?? fromFile.url;
  if (url === undefined || url.length === 0) {
    throw new ProviderError(
      "comfyui.no-endpoint",
      `no ComfyUI endpoint configured. Set TOONY_COMFYUI_URL (e.g. ${COMFYUI_DEFAULT_LOCAL_URL} for a local install) or provide it via TOONY_COMFYUI_CONFIG.`,
    );
  }
  try {
    // Validate it is a real URL; reject garbage early with a clear message.
    new URL(url);
  } catch {
    throw new ProviderError("comfyui.bad-endpoint", "the ComfyUI endpoint URL is not a valid URL.");
  }

  // Workflow: inline graph > env path > config path/inline > bundled default.
  let workflow: ComfyWorkflowGraph;
  const workflowPath = env.TOONY_COMFYUI_WORKFLOW ?? fromFile.workflowPath;
  if (overrides.workflow !== undefined) {
    workflow = overrides.workflow;
  } else if (workflowPath !== undefined && workflowPath.length > 0) {
    workflow = await loadWorkflowFromPath(workflowPath);
  } else if (fromFile.workflow !== undefined) {
    workflow = fromFile.workflow;
  } else {
    workflow = await loadDefaultWorkflow();
  }

  const injectionMap: WorkflowInjectionMap = {
    ...DEFAULT_INJECTION_MAP,
    ...fromFile.injectionMap,
    ...overrides.injectionMap,
  };

  const checkpoint =
    overrides.checkpoint ?? env.TOONY_COMFYUI_CHECKPOINT ?? fromFile.checkpoint ?? undefined;

  const timeoutMs =
    overrides.timeoutMs ??
    parsePositiveInt(env.TOONY_COMFYUI_TIMEOUT_MS, "TOONY_COMFYUI_TIMEOUT_MS") ??
    fromFile.timeoutMs ??
    COMFYUI_DEFAULT_TIMEOUT_MS;

  const pollIntervalMs = overrides.pollIntervalMs ?? fromFile.pollIntervalMs ?? 1_000;

  return {
    url: url.replace(/\/+$/, ""),
    workflow,
    injectionMap,
    checkpoint,
    timeoutMs,
    pollIntervalMs,
  };
}
