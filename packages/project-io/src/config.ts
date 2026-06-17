// Shared workspace configuration: `<root>/.toony/config.json`.
//
// A workspace's runtime settings live here, NOT in any committed project file:
// the ComfyUI endpoint/checkpoint/workflow (per the v2 proposal §4.7) and any
// future app settings. The CLI, the Studio settings page (#52), and agents all
// read/write this single file so a generation endpoint is configured once per
// workspace. It is LOCAL runtime data — gitignored (`.toony/`) and never a place
// for secrets in the repo; `readConfig` of a missing file returns sane defaults.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectIoError } from "./errors.js";
import { decodeJson, encodeJson } from "./format.js";

/** Config directory under the workspace root. */
export const CONFIG_DIR = ".toony";

/** Config file name within `CONFIG_DIR`. */
export const CONFIG_FILE = "config.json";

/** ComfyUI connection settings; each is null until the workspace configures it. */
export interface ComfyUiConfig {
  /** Base URL of the ComfyUI server (e.g. a local endpoint). Null when unset. */
  endpoint: string | null;
  /** Checkpoint/model name to request. Null when unset. */
  checkpoint: string | null;
  /** Named workflow to drive generation. Null when unset. */
  workflow: string | null;
}

/** Provider-neutral workspace configuration persisted to `.toony/config.json`. */
export interface ToonyConfig {
  comfyui: ComfyUiConfig;
}

/** Absolute path to a workspace's config file. */
export function configPath(root: string): string {
  return join(root, CONFIG_DIR, CONFIG_FILE);
}

/** Defaults for an unconfigured workspace: nothing connected yet. */
export function defaultConfig(): ToonyConfig {
  return { comfyui: { endpoint: null, checkpoint: null, workflow: null } };
}

/** A non-empty string passes through; anything else (incl. "") becomes null. */
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Coerce an untrusted parsed value into a well-formed `ToonyConfig`, filling
 * defaults for missing/!string fields. Applied on both read and write so the
 * on-disk shape is always normalized and deterministic.
 */
function normalizeConfig(value: unknown): ToonyConfig {
  const base = defaultConfig();
  if (typeof value !== "object" || value === null) return base;
  const obj = value as Record<string, unknown>;
  const comfy =
    typeof obj.comfyui === "object" && obj.comfyui !== null
      ? (obj.comfyui as Record<string, unknown>)
      : {};
  return {
    comfyui: {
      endpoint: stringOrNull(comfy.endpoint),
      checkpoint: stringOrNull(comfy.checkpoint),
      workflow: stringOrNull(comfy.workflow),
    },
  };
}

/**
 * Read `<root>/.toony/config.json`. A missing file returns `defaultConfig()`;
 * a present-but-malformed file throws `ProjectIoError` (the caller maps this to
 * an IO exit), matching how the project reader treats corrupt JSON.
 */
export async function readConfig(root: string): Promise<ToonyConfig> {
  const file = configPath(root);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return defaultConfig();
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not read config: ${reason}`, file);
  }
  try {
    return normalizeConfig(decodeJson(text));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`invalid JSON in config: ${reason}`, file);
  }
}

/**
 * Write `<root>/.toony/config.json`, creating `.toony/` if needed. The value is
 * normalized first, so output is deterministic (sorted keys, trailing newline)
 * and a write→read round-trip is stable.
 */
export async function writeConfig(root: string, config: ToonyConfig): Promise<void> {
  const file = configPath(root);
  try {
    await mkdir(join(root, CONFIG_DIR), { recursive: true });
    await writeFile(file, encodeJson(normalizeConfig(config)), "utf8");
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not write config: ${reason}`, file);
  }
}
