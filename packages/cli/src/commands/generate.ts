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
// stays on-model across cuts, and the cut's declared `palette` is appended as a
// colour clause (#207) so the colour a cut asks for reaches the only lever the
// provider has. When the endpoint is unset or unreachable the command fails with
// a clear, actionable message — it never fabricates a result.
//
// `--cut` REPEATS, so this command owns the multi-cut loop instead of leaving
// every caller to write a shell loop and invent its own error handling (#204).
// Generation is slow and flaky against a local GPU, so a failed cut must not
// scroll past unnoticed: the run reports a per-cut summary and exits non-zero
// when any cut failed. Nothing is rolled back, so cuts that did generate stay.

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
import { discoverPackContent } from "../packs.js";
import { appendPaletteClause } from "../palette.js";

export interface GenerateIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
}

interface Flags {
  positional: string[];
  values: Map<string, string>;
  /** Values of flags that may be repeated, in the order they were given. */
  lists: Map<string, string[]>;
  booleans: Set<string>;
}

const VALUE_FLAGS = new Set([
  "--episode",
  "--transition",
  "--slot",
  "--provider",
  "--prompt",
  "--negative",
  "--width",
  "--height",
  "--seed",
  "--workflow",
]);
/** `--cut` repeats so one run covers a whole episode (#204). */
const LIST_FLAGS = new Set(["--cut"]);
const BOOLEAN_FLAGS = new Set(["--allow-remote"]);

function parseFlags(args: string[]): Flags | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const booleans = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg) || LIST_FLAGS.has(arg)) {
      const value = args[i + 1];
      // Reject a following flag as a value (e.g. `--episode --cut x`), matching
      // export.ts / import-image.ts (#156).
      if (value === undefined || value.startsWith("-")) return { error: `${arg} requires a value` };
      if (LIST_FLAGS.has(arg)) lists.set(arg, [...(lists.get(arg) ?? []), value]);
      else values.set(arg, value);
      i++;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
    } else if (arg.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, lists, booleans };
}

const USAGE =
  "usage: toony generate [path] --episode <id> (--cut <id> [--cut <id> ...] [--slot clean|final] | --transition <id>) --prompt <text> [--negative <text>] [--width <px>] [--height <px>] [--seed <n>] [--workflow <name>] [--provider comfyui] [--allow-remote]";

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
  workflows: ReadonlyMap<string, string>,
  workflowName: string | undefined,
): Promise<ImageProvider | { error: string }> {
  if (id === "comfyui") {
    try {
      const toonyConfig = await readWorkspaceComfyConfig(root);
      // `workflows` is the named-workflow registry contributed by installed
      // packs (#192), injected as plain data so `@toony/providers` resolves a
      // workflow by name without depending on the pack loader.
      const config = await resolveComfyUIConfig({
        env: io.env ?? {},
        toonyConfig,
        workflows,
        ...(workflowName === undefined ? {} : { workflowName }),
      });
      return new ComfyUIProvider(config);
    } catch (cause) {
      if (cause instanceof ProviderError) return { error: cause.message };
      throw cause;
    }
  }
  // Only providers with a real generation implementation are offered.
  return { error: `unknown provider "${id}"; only "comfyui" is available for generation` };
}

/** One image to produce: where it goes, what to ask for, and how to name it. */
interface Job {
  /** Cut or transition id, as it appears in the run summary. */
  id: string;
  /** How the target reads in the success line. */
  label: string;
  target: AssetTarget;
  request: ImageRequest;
}

interface PlanInput {
  episodeId: string;
  cutIds: readonly string[];
  transitionId?: string;
  slot: "clean" | "final";
  prompt?: string;
  negative?: string;
  /** Size and seed flags, which apply to every job in the run. */
  shared: Readonly<Record<string, string | number>>;
}

function optionsFor(
  shared: Readonly<Record<string, string | number>>,
  negative: string | undefined,
): Record<string, string | number> {
  return negative === undefined ? { ...shared } : { negativePrompt: negative, ...shared };
}

/**
 * Resolve every requested job's prompt BEFORE any of them runs.
 *
 * An explicit `--prompt` wins; otherwise a cut falls back to its stored
 * `imagePrompt`/`negativePrompt` (#38). Transitions carry no stored prompt, so
 * `--prompt` stays required for them. The project is loaded ONCE, even when
 * `--prompt` is given, to read each cut's `characters` refs, its `palette`, and
 * the project registry, so lockstrings (#92) and the palette clause (#207)
 * inject for both prompt sources. Generation writes only image refs, which
 * nothing here reads, so one load serves the whole run.
 *
 * `usage` separates a caller mistake, which reprints the usage line, from a
 * project that could not be loaded.
 */
async function planJobs(
  root: string,
  input: PlanInput,
): Promise<{ jobs: Job[] } | { error: string; usage: boolean }> {
  const { episodeId, cutIds, transitionId, slot, prompt, negative, shared } = input;
  const NO_PROMPT = "generation requires --prompt <text> (or a non-empty cut imagePrompt)";
  if (transitionId !== undefined) {
    if (prompt === undefined || prompt.trim().length === 0)
      return { error: NO_PROMPT, usage: true };
    return {
      jobs: [
        {
          id: transitionId,
          label: `transition ${transitionId}`,
          target: { kind: "transition", episodeId, transitionId },
          request: { prompt, options: optionsFor(shared, negative) },
        },
      ],
    };
  }

  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(root);
  } catch (error) {
    return { error: error instanceof ProjectIoError ? error.message : String(error), usage: false };
  }
  const registry: readonly Character[] = loaded.project.webtoon.characters ?? [];
  const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);

  const jobs: Job[] = [];
  for (const cutId of cutIds) {
    const cut = bundle?.cuts.find((c) => c.id === cutId);
    let cutPrompt = prompt;
    let cutNegative = negative;
    if (cut) {
      if (
        (cutPrompt === undefined || cutPrompt.trim().length === 0) &&
        cut.imagePrompt.trim().length > 0
      ) {
        cutPrompt = cut.imagePrompt;
      }
      if (cutNegative === undefined && cut.negativePrompt.trim().length > 0) {
        cutNegative = cut.negativePrompt;
      }
    }
    if (cutPrompt === undefined || cutPrompt.trim().length === 0) {
      return { error: `${NO_PROMPT}; ${cutId} has neither`, usage: true };
    }
    // Lockstrings prepend (#92), then the palette clause appends (#207), so the
    // colour qualifies the whole scene rather than one character's description.
    const composed = appendPaletteClause(
      injectCharacterLockstrings(cutPrompt, cut?.characters, registry),
      cut?.palette,
    );
    jobs.push({
      id: cutId,
      label: `cut ${cutId} (${slot})`,
      target: { kind: "cut", episodeId, cutId, slot },
      request: { prompt: composed, options: optionsFor(shared, cutNegative) },
    });
  }
  return { jobs };
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
  // Repeats are collapsed in first-seen order: a duplicated id would otherwise
  // spend GPU minutes overwriting the cut it just produced.
  const cutIds = [...new Set(parsed.lists.get("--cut") ?? [])];
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
  if ((cutIds.length === 0) === (transitionId === undefined)) {
    io.err("specify one or more --cut <id>, or exactly one --transition <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if (slot !== "clean" && slot !== "final") {
    io.err('--slot must be "clean" or "final"');
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");

  const shared: Record<string, string | number> = {};
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
      shared.seed = n;
      continue;
    }
    const n = parsePositiveInt(raw, flag);
    if (typeof n === "object") {
      io.err(n.error);
      return EXIT_USAGE;
    }
    shared[key] = n;
  }

  // Plan every job BEFORE the first request. Usage problems (an unusable prompt)
  // abort the whole run here, so a multi-cut run never spends GPU minutes on
  // cut-001 only to discover cut-007 was never going to work. Only GENERATION
  // failures are per-cut, and those are what the summary below reports.
  const jobs = await planJobs(root, {
    episodeId,
    cutIds,
    ...(transitionId === undefined ? {} : { transitionId }),
    slot,
    ...(prompt === undefined ? {} : { prompt }),
    ...(negative === undefined ? {} : { negative }),
    shared,
  });
  if ("error" in jobs) {
    io.err(jobs.error);
    if (jobs.usage) io.err(USAGE);
    return EXIT_USAGE;
  }

  const packs = await discoverPackContent(root, io);
  const provider = await buildProvider(
    providerId,
    root,
    io,
    packs.workflows,
    parsed.values.get("--workflow"),
  );
  if ("error" in provider) {
    io.err(provider.error);
    return EXIT_USAGE;
  }
  if (provider.transmitsRemotely && !parsed.booleans.has("--allow-remote")) {
    io.err(
      `provider "${providerId}" would send prompt content to a non-local server; re-run with --allow-remote to opt in, or point it at a loopback endpoint (localhost or 127.0.0.1) to keep content on this machine`,
    );
    return EXIT_USAGE;
  }

  const generated: string[] = [];
  const failed: string[] = [];
  // The run reports the code the FIRST failed job would have returned alone, so
  // a single-job run keeps exactly the exit code it has always had.
  let failureCode: number | null = null;

  for (const job of jobs.jobs) {
    try {
      const result = await provider.produce(job.request);
      const ingested = await ingestImageAsset(root, job.target, result);
      io.out(
        `generated ${ingested.assetPath} for ${job.label} in ${episodeId} — ${ingested.bytesWritten} bytes, sha256 ${ingested.sha256.slice(0, 12)}`,
      );
      generated.push(job.id);
    } catch (cause) {
      // Generation/connection problems are domain errors, not CLI misuse.
      if (cause instanceof ProviderError) failureCode ??= EXIT_VALIDATION;
      else if (cause instanceof ProjectIoError) failureCode ??= EXIT_USAGE;
      else throw cause;
      io.err(`generation failed for ${job.id}: ${cause.message}`);
      failed.push(job.id);
    }
  }

  // Nothing already written is undone: a partial run leaves its finished cuts in
  // place, and the summary says which ones are still missing.
  if (jobs.jobs.length > 1) {
    const counts = `${generated.length} generated, ${failed.length} failed`;
    io.out(failed.length === 0 ? counts : `${counts}: ${failed.join(", ")}`);
  }
  if (generated.length > 0) io.out("next: toony validate");
  return failureCode ?? EXIT_OK;
}
