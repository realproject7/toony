// `toony generate` — generate a cut or transition image with a configured
// provider and ingest it into the project (metadata stripped, project-relative).
//
// The provider-neutral contract produces the bytes; the project-io ingest path
// places and associates them, exactly like `import-image`. The ComfyUI provider
// is configured from LOCAL runtime config/env only (TOONY_COMFYUI_URL etc.) —
// `webtoon.json` provider entries stay neutral and never carry an endpoint/key.
//
// Prompts come from `--prompt`/`--negative` or, for a cut, fall back to the
// stored `cut.imagePrompt`/`negativePrompt` (#38). For BOTH sources, the
// referenced characters' lockstrings (#92) are prepended VERBATIM so a character
// stays on-model across cuts. When the endpoint is unset or unreachable the
// command fails with a clear, actionable message — it never fabricates a result.

import { dirname, resolve } from "node:path";
import {
  type AssetTarget,
  type ComfyUiConfig,
  ingestImageAsset,
  loadProject,
  ProjectIoError,
  readConfig,
} from "@toony/project-io";
import {
  ComfyUIProvider,
  type ImageProvider,
  type ImageRequest,
  ProviderError,
  resolveComfyUIConfig,
  type ToonyWorkspaceComfyConfig,
} from "@toony/providers";
import type { Character } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

export interface GenerateIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
}

interface Flags {
  positional: string[];
  values: Map<string, string>;
  booleans: Set<string>;
}

const VALUE_FLAGS = new Set([
  "--episode",
  "--cut",
  "--transition",
  "--slot",
  "--provider",
  "--prompt",
  "--negative",
  "--width",
  "--height",
  "--seed",
]);
const BOOLEAN_FLAGS = new Set(["--allow-remote"]);

function parseFlags(args: string[]): Flags | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      values.set(arg, value);
      i++;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
    } else if (arg.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, booleans };
}

const USAGE =
  "usage: toony generate [path] --episode <id> (--cut <id> [--slot clean|final] | --transition <id>) --prompt <text> [--negative <text>] [--width <px>] [--height <px>] [--seed <n>] [--provider comfyui] [--allow-remote]";

function parsePositiveInt(raw: string, name: string): number | { error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { error: `${name} must be a positive integer` };
  return n;
}

/**
 * Prepend the referenced characters' lockstrings VERBATIM to `basePrompt` (#92),
 * so a character stays on-model across cuts. Order follows `characterIds` (the
 * cut's order), deduplicated; ids not in the registry are skipped (lint flags
 * them via `character/unknown-ref`), as are characters with a blank lockstring.
 * Pure and deterministic: same inputs → same string, so it is unit-tested by
 * asserting the composed prompt without a live provider.
 */
export function injectCharacterLockstrings(
  basePrompt: string,
  characterIds: readonly string[] | undefined,
  registry: readonly Character[],
): string {
  if (characterIds === undefined || characterIds.length === 0) return basePrompt;
  const byId = new Map(registry.map((character) => [character.id, character]));
  const seen = new Set<string>();
  const lockstrings: string[] = [];
  for (const id of characterIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const lockstring = byId.get(id)?.lockstring.trim();
    if (lockstring) lockstrings.push(lockstring);
  }
  if (lockstrings.length === 0) return basePrompt;
  return `${lockstrings.join(", ")}, ${basePrompt}`;
}

/**
 * Resolve the shared workspace ComfyUI settings for this project, with env-first
 * precedence preserved by `resolveComfyUIConfig` (this is the lowest-priority
 * source). The file is looked up at `<root>/.toony/config.json` and, if that one
 * does not configure an endpoint, at the PARENT directory `<root>/../.toony/...`
 * — because Studio v2 is workspace-scoped and writes the config at the workspace
 * root (the parent of each work). A missing file yields all-null defaults. This
 * read never fails the command on a malformed file: it is best-effort runtime
 * config, so we fall back to env-only resolution if it cannot be read.
 */
async function readWorkspaceComfyConfig(root: string): Promise<ToonyWorkspaceComfyConfig> {
  const pick = (cfg: ComfyUiConfig): ToonyWorkspaceComfyConfig => ({
    endpoint: cfg.endpoint,
    checkpoint: cfg.checkpoint,
    workflow: cfg.workflow,
  });
  try {
    const own = await readConfig(root);
    if (own.comfyui.endpoint !== null) return pick(own.comfyui);
    // No endpoint at the project root: try the workspace root (its parent).
    const parent = dirname(root);
    if (parent !== root) {
      const workspace = await readConfig(parent);
      if (workspace.comfyui.endpoint !== null) return pick(workspace.comfyui);
    }
    // Neither configured an endpoint: surface the project-root values (so a
    // checkpoint/workflow set there without an endpoint still flows through).
    return pick(own.comfyui);
  } catch {
    return { endpoint: null, checkpoint: null, workflow: null };
  }
}

async function buildProvider(
  id: string,
  root: string,
  io: GenerateIo,
): Promise<ImageProvider | { error: string }> {
  if (id === "comfyui") {
    try {
      const toonyConfig = await readWorkspaceComfyConfig(root);
      const config = await resolveComfyUIConfig({ env: io.env ?? {}, toonyConfig });
      return new ComfyUIProvider(config);
    } catch (cause) {
      if (cause instanceof ProviderError) return { error: cause.message };
      throw cause;
    }
  }
  // Only providers with a real generation implementation are offered.
  return { error: `unknown provider "${id}"; only "comfyui" is available for generation` };
}

/** Run `toony generate`. Returns the process exit code. */
export async function runGenerate(args: string[], io: GenerateIo): Promise<number> {
  const parsed = parseFlags(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const episodeId = parsed.values.get("--episode");
  const cutId = parsed.values.get("--cut");
  const transitionId = parsed.values.get("--transition");
  const slot = parsed.values.get("--slot") ?? "clean";
  const providerId = parsed.values.get("--provider") ?? "comfyui";
  const prompt = parsed.values.get("--prompt");
  const negative = parsed.values.get("--negative");

  if (episodeId === undefined) {
    io.err("missing required --episode <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if ((cutId === undefined) === (transitionId === undefined)) {
    io.err("specify exactly one of --cut <id> or --transition <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if (slot !== "clean" && slot !== "final") {
    io.err('--slot must be "clean" or "final"');
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");

  // Resolve the effective prompt: an explicit --prompt wins; otherwise a cut
  // falls back to its stored imagePrompt/negativePrompt (#38). Transitions carry
  // no stored prompt, so --prompt stays required for them. For a cut we load the
  // project regardless (even with --prompt) to read its `characters` refs and the
  // project registry, so lockstrings (#92) inject for both prompt sources.
  let effectivePrompt = prompt;
  let effectiveNegative = negative;
  let cutCharacters: readonly string[] | undefined;
  let registry: readonly Character[] = [];
  if (cutId !== undefined) {
    try {
      const loaded = await loadProject(root);
      registry = loaded.project.webtoon.characters ?? [];
      const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
      const cut = bundle?.cuts.find((c) => c.id === cutId);
      if (cut) {
        cutCharacters = cut.characters;
        if (
          (effectivePrompt === undefined || effectivePrompt.trim().length === 0) &&
          cut.imagePrompt.trim().length > 0
        ) {
          effectivePrompt = cut.imagePrompt;
        }
        if (effectiveNegative === undefined && cut.negativePrompt.trim().length > 0) {
          effectiveNegative = cut.negativePrompt;
        }
      }
    } catch (error) {
      io.err(error instanceof ProjectIoError ? error.message : String(error));
      return EXIT_USAGE;
    }
  }
  if (effectivePrompt === undefined || effectivePrompt.trim().length === 0) {
    io.err("generation requires --prompt <text> (or a non-empty cut imagePrompt)");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  // Prepend referenced characters' lockstrings verbatim (#92) for either source.
  effectivePrompt = injectCharacterLockstrings(effectivePrompt, cutCharacters, registry);

  const options: Record<string, string | number> = {};
  if (effectiveNegative !== undefined) options.negativePrompt = effectiveNegative;
  for (const [flag, key] of [
    ["--width", "width"],
    ["--height", "height"],
    ["--seed", "seed"],
  ] as const) {
    const raw = parsed.values.get(flag);
    if (raw === undefined) continue;
    if (flag === "--seed") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        io.err("--seed must be a non-negative integer");
        return EXIT_USAGE;
      }
      options.seed = n;
      continue;
    }
    const n = parsePositiveInt(raw, flag);
    if (typeof n === "object") {
      io.err(n.error);
      return EXIT_USAGE;
    }
    options[key] = n;
  }

  const provider = await buildProvider(providerId, root, io);
  if ("error" in provider) {
    io.err(provider.error);
    return EXIT_USAGE;
  }
  if (provider.transmitsRemotely && !parsed.booleans.has("--allow-remote")) {
    io.err(
      `provider "${providerId}" sends prompt content to the configured server; re-run with --allow-remote to opt in (use a local endpoint to keep content on this machine)`,
    );
    return EXIT_USAGE;
  }

  const target: AssetTarget =
    cutId !== undefined
      ? { kind: "cut", episodeId, cutId, slot }
      : { kind: "transition", episodeId, transitionId: transitionId as string };

  const request: ImageRequest = { prompt: effectivePrompt, options };

  try {
    const result = await provider.produce(request);
    const ingested = await ingestImageAsset(root, target, result);
    const where =
      target.kind === "cut"
        ? `cut ${target.cutId} (${target.slot})`
        : `transition ${target.transitionId}`;
    io.out(
      `generated ${ingested.assetPath} for ${where} in ${episodeId} — ${ingested.bytesWritten} bytes, sha256 ${ingested.sha256.slice(0, 12)}`,
    );
    io.out("next: toony validate");
    return EXIT_OK;
  } catch (cause) {
    if (cause instanceof ProviderError) {
      io.err(`generation failed: ${cause.message}`);
      // Generation/connection problems are domain errors, not CLI misuse.
      return EXIT_VALIDATION;
    }
    if (cause instanceof ProjectIoError) {
      io.err(`generation failed: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
}
