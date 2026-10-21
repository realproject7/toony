// The artwork engine: the person's ComfyUI server, which the agent draws with.
// Its address resolves the way the generate run resolves it: TOONY_COMFYUI_URL
// first, then the workspace settings. Toony draws only with an engine on this
// computer, so prompts and images never leave it. Only a verdict and a plain
// message leave the server; the address stays in the person's settings.

import { readConfig } from "@toony/project-io";
import { isLoopbackEndpoint } from "@toony/providers";
import { probeComfyui } from "../comfyui-probe.js";

export interface ArtEngineStatus {
  ready: boolean;
  state: "ready" | "unconfigured" | "unreachable" | "remote";
  /** What to tell the person, in plain words. */
  message: string;
  /** A ready engine: whether it can draw with character portraits (the IP-Adapter nodes). */
  portraits?: boolean;
  /** Whether this computer can train a character's LoRA (a training command is set up). */
  training?: boolean;
}

/** The command that trains a character LoRA, from the person's settings; null when none is set up. */
export function trainingCommand(env: Readonly<Record<string, string | undefined>>): string | null {
  return env.TOONY_LORA_TRAIN_COMMAND?.trim() || null;
}

const NODE_TIMEOUT_MS = 4_000;

/** Whether the engine has the IP-Adapter community nodes the portraits go through. */
async function hasPortraitNodes(endpoint: string): Promise<boolean> {
  try {
    const answers = await Promise.all(
      ["IPAdapterUnifiedLoader", "IPAdapter"].map(async (node) => {
        const response = await fetch(new URL(`/object_info/${node}`, endpoint), {
          signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const info = (await response.json()) as Record<string, unknown>;
        return typeof info[node] === "object" && info[node] !== null;
      }),
    );
    return answers.every(Boolean);
  } catch {
    return false;
  }
}

/** Probes are cached briefly so a status call per turn does not wait on the network. */
const CACHE_MS = 15_000;
const cache = globalThis as typeof globalThis & {
  toonyArtEngine?: { key: string; at: number; status: ArtEngineStatus };
};

async function configuredEndpoint(
  workspace: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const fromEnv = env.TOONY_COMFYUI_URL?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await readConfig(workspace)).comfyui.endpoint;
  } catch {
    return null;
  }
}

/** Whether the agent can draw right now, and what to say when it cannot. */
export async function artEngineStatus(
  workspace: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { fresh?: boolean } = {},
): Promise<ArtEngineStatus> {
  const endpoint = await configuredEndpoint(workspace, env);
  const key = `${workspace}\n${endpoint ?? ""}`;
  const cached = cache.toonyArtEngine;
  if (!options.fresh && cached && cached.key === key && Date.now() - cached.at < CACHE_MS) {
    return cached.status;
  }
  let status: ArtEngineStatus;
  if (endpoint === null) {
    status = {
      ready: false,
      state: "unconfigured",
      message:
        "The artwork engine is not set up. Start ComfyUI on this computer and add its address in Settings, Artwork engine.",
    };
  } else if (!isLoopbackEndpoint(endpoint)) {
    status = {
      ready: false,
      state: "remote",
      message:
        "The artwork engine points at another computer. Toony draws only with an engine on this computer; use its local address (for example 127.0.0.1) in Settings, Artwork engine.",
    };
  } else {
    const probe = await probeComfyui(endpoint);
    const portraits = probe.state === "reachable" && (await hasPortraitNodes(endpoint));
    status =
      probe.state === "reachable"
        ? {
            ready: true,
            state: "ready",
            portraits,
            training: trainingCommand(env) !== null,
            message: portraits
              ? "The artwork engine is ready and draws characters with their portraits."
              : "The artwork engine is ready, but it cannot draw with character portraits (the IP-Adapter nodes are not installed), so cuts keep characters on model by their look text only.",
          }
        : {
            ready: false,
            state: "unreachable",
            message:
              "The artwork engine is not answering. Start ComfyUI on this computer, then ask again.",
          };
  }
  cache.toonyArtEngine = { key, at: Date.now(), status };
  return status;
}
