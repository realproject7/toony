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
// A finished CUT render writes what produced it back onto the cut (#240): the
// prompt, the negative prompt, the seed, and the workflow's name when the run
// named one. The seed and the workflow fall back to those recorded values the
// same way the prompt already fell back to `cut.imagePrompt`, so re-running a
// cut with no flags at all returns the image the operator accepted instead of
// rolling a fresh seed, and an agent's converged prompt survives the shell it
// was typed into. An explicit flag still wins for the run it is given on.
//
// The same inputs reach the episode's ingest log, composed exactly as submitted,
// so any panel can answer what produced it. Generation is the one step here that
// costs minutes and is not deterministic; before this it was also the only one
// that wrote down nothing about its own inputs.
//
// A cut's declared panel shape (`panelAspect`, #237) reaches the provider the
// same way: it is a height in column widths, so it is resolved against the
// column the workflow's own latent declares (or `--width`) and injected as this
// cut's latent size. A cut that declares no shape has NO size injected, so the
// workflow's latent stands exactly as it did before the field existed.
//
// A project that does not validate is REFUSED before anything is sent (#261).
// Every input above — the prompt, the lockstrings, the palette, the shape — is
// read out of records this command does not otherwise check, so generating from
// an unvalidated project spends GPU minutes on data nobody has looked at and
// then writes art into the project. The one exception is a project that is
// merely half-wired — a record written but not yet sequenced, or a sequence
// entry whose record is not written yet — which warns loudly and proceeds,
// because refusing it makes the whole project unreachable while any one part of
// it is mid-edit. `../generate-gate.ts` owns that line and the reasoning for it;
// `docs/ARCHITECTURE.md` ("Generation and validation") has the operator view.
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
  type CutAssetTarget,
  ingestImageAsset,
  type LoadedProject,
  loadProject,
  ProjectIoError,
  type RenderInputs,
  readConfig,
  writeCuts,
} from "@toony/project-io";
import {
  ComfyUIProvider,
  type ImageProvider,
  type ImageRequest,
  ProviderError,
  randomSeed,
  resolveComfyUIConfig,
  type ToonyWorkspaceComfyConfig,
} from "@toony/providers";
import type { Character, Cut } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { authoredValueLines, partitionIssues } from "../generate-gate.js";
import { discoverPackContent } from "../packs.js";
import { appendPaletteClause } from "../palette.js";
import { latentHeightFor } from "../panel-shape.js";
import { textReport } from "../report.js";

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

/**
 * The column the resolved workflow generates at: the width its own latent
 * declares, read through the same injection map the provider writes sizes
 * through, so it is the number a cut's declared shape (#237) is a multiple of.
 * `undefined` when the mapped node carries no usable width — a mapping that
 * points at nothing is the operator's to fix, not something to guess a column
 * for.
 */
function workflowLatentWidth(config: {
  workflow: Record<string, { inputs: Record<string, unknown> }>;
  injectionMap: { widthNode: string; widthInput: string };
}): number | undefined {
  const raw =
    config.workflow[config.injectionMap.widthNode]?.inputs?.[config.injectionMap.widthInput];
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

/** A built provider, with the column its workflow draws at when one is known. */
interface BuiltProvider {
  provider: ImageProvider;
  latentWidth?: number;
}

async function buildProvider(
  id: string,
  root: string,
  io: GenerateIo,
  workflows: ReadonlyMap<string, string>,
  workflowName: string | undefined,
): Promise<BuiltProvider | { error: string }> {
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
      const latentWidth = workflowLatentWidth(config);
      return {
        provider: new ComfyUIProvider(config),
        ...(latentWidth === undefined ? {} : { latentWidth }),
      };
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
  /**
   * What this job generates with (#240), and the single source the request is
   * built from — so what is submitted and what is recorded cannot drift.
   */
  inputs: RenderInputs;
  /**
   * The prompt to write back onto the cut (#240): the cut's OWN prompt, before
   * the lockstrings and the palette clause compose into `inputs.prompt`, so a
   * later run composes once instead of compounding. Absent for a transition,
   * which has no prompt field to write back to.
   */
  basePrompt?: string;
  /**
   * The cut's declared panel shape (#237), when it declared one. Carried rather
   * than resolved here because it needs the column the workflow draws at, and
   * the workflow is not resolved until after planning — planning exists to
   * reject a caller mistake before anything reaches a provider.
   */
  panelAspect?: number;
}

/** A planned job with the provider that will run it, and that provider's column. */
interface ReadyJob {
  job: Job;
  provider: ImageProvider;
  latentWidth?: number;
}

interface PlanInput {
  episodeId: string;
  cutIds: readonly string[];
  transitionId?: string;
  slot: "clean" | "final";
  prompt?: string;
  negative?: string;
  /** `--workflow`, which overrides what a cut recorded for this run only. */
  workflow?: string;
  /** Size and seed flags, which apply to every job in the run. */
  shared: Readonly<Record<string, string | number>>;
}

/**
 * What one job generates with: this run's flags first, then what the cut
 * recorded the last time it generated (#240), then a fresh seed.
 *
 * The seed falls back rather than re-rolling because re-rolling is what made an
 * accepted panel unreproducible: the same cut, re-run with no flags, drew a
 * different image every time. A run that wants a new roll passes `--seed`.
 */
function resolveInputs(
  prompt: string,
  negativePrompt: string,
  shared: Readonly<Record<string, string | number>>,
  workflow: string | undefined,
  cut: Cut | undefined,
): RenderInputs {
  const resolvedWorkflow = workflow ?? cut?.imageWorkflow;
  return {
    prompt,
    negativePrompt,
    seed: typeof shared.seed === "number" ? shared.seed : (cut?.imageSeed ?? randomSeed()),
    ...(resolvedWorkflow === undefined ? {} : { workflow: resolvedWorkflow }),
    ...(typeof shared.width === "number" ? { width: shared.width } : {}),
    ...(typeof shared.height === "number" ? { height: shared.height } : {}),
  };
}

/**
 * The provider request for a set of inputs.
 *
 * The seed is always sent, which it was not before #240: a seed the provider
 * rolls for itself is gone by the time the result comes back, and a seed nobody
 * recorded is a render nobody can repeat. Size is still sent only when the run
 * resolved one, so a workflow's own latent stands exactly as it did (#202).
 */
function requestFor(inputs: RenderInputs): ImageRequest {
  return {
    prompt: inputs.prompt,
    options: {
      negativePrompt: inputs.negativePrompt,
      seed: inputs.seed,
      ...(inputs.width === undefined ? {} : { width: inputs.width }),
      ...(inputs.height === undefined ? {} : { height: inputs.height }),
    },
  };
}

/**
 * Resolve every requested job's prompt BEFORE any of them runs.
 *
 * An explicit `--prompt` wins; otherwise a cut falls back to its stored
 * `imagePrompt`/`negativePrompt` (#38). Transitions carry no stored prompt, so
 * `--prompt` stays required for them. The already-loaded project supplies each
 * cut's `characters` refs, its `palette`, and the project registry, so
 * lockstrings (#92) and the palette clause (#207) inject for both prompt
 * sources. Generation writes only image refs, which nothing here reads, so the
 * caller's one load serves the whole run.
 *
 * `usage` marks a caller mistake, which reprints the usage line.
 */
function planJobs(
  loaded: LoadedProject,
  input: PlanInput,
): { jobs: Job[] } | { error: string; usage: boolean } {
  const { episodeId, cutIds, transitionId, slot, prompt, negative, workflow, shared } = input;
  const NO_PROMPT = "generation requires --prompt <text> (or a non-empty cut imagePrompt)";
  if (transitionId !== undefined) {
    if (prompt === undefined || prompt.trim().length === 0)
      return { error: NO_PROMPT, usage: true };
    // A transition record has no prompt or seed fields, so nothing is written
    // back for it; its inputs are recorded in the ingest log like a cut's.
    const inputs = resolveInputs(prompt, negative ?? "", shared, workflow, undefined);
    return {
      jobs: [
        {
          id: transitionId,
          label: `transition ${transitionId}`,
          target: { kind: "transition", episodeId, transitionId },
          request: requestFor(inputs),
          inputs,
        },
      ],
    };
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
    const inputs = resolveInputs(composed, cutNegative ?? "", shared, workflow, cut);
    jobs.push({
      id: cutId,
      label: `cut ${cutId} (${slot})`,
      target: { kind: "cut", episodeId, cutId, slot },
      request: requestFor(inputs),
      inputs,
      basePrompt: cutPrompt,
      ...(cut?.panelAspect === undefined ? {} : { panelAspect: cut.panelAspect }),
    });
  }
  return { jobs };
}

/**
 * Turn every job's declared panel shape (#237) into the latent size the provider
 * generates at, in place.
 *
 * The shape is a height in column widths, so it needs a column: `--width` when
 * the operator pinned one, otherwise the width the latent of THIS job's own
 * workflow declares — jobs in one run no longer share a workflow, because a cut
 * can record the one it was generated with (#240). An explicit `--height` is the
 * operator overriding the cut for this run and wins outright — but it is SAID,
 * because a shape that is silently dropped is the #207 failure in a new place.
 *
 * A job with no declared shape is left exactly as planned: no size is injected
 * for it, so the workflow's own latent stands, unchanged to the byte.
 *
 * The shape's own bounds are NOT re-checked here. #237 added that check because
 * this command ignored `loadProject`'s validation report, so a `panelAspect` the
 * schema rejects still reached this function; the run's validation gate (#261)
 * is what covers it now, and every cut in `bundle.cuts` goes through
 * `validateCutValue`, which applies `PANEL_ASPECT_MIN`/`MAX` and rejects a
 * non-finite or non-numeric value. `cut.panel-aspect` is not on the gate's
 * wiring allowlist, so it refuses rather than warns. Keeping a second copy of
 * the bounds would leave the CLI free to drift from the schema and refuse a
 * project `toony validate` calls valid.
 *
 * Returns an error instead of generating when a declared shape cannot be
 * RESOLVED — there is no column to size it against. Falling back to the
 * workflow's latent would render a page with the pack's pacing quietly removed,
 * and cost GPU minutes to discover.
 */
function applyPanelShapes(
  ready: readonly ReadyJob[],
  shared: Readonly<Record<string, string | number>>,
  io: GenerateIo,
): { error: string; exit: number } | null {
  const declared = ready.flatMap((entry) =>
    entry.job.panelAspect === undefined ? [] : [{ entry, panelAspect: entry.job.panelAspect }],
  );
  if (declared.length === 0) return null;

  if (typeof shared.height === "number") {
    io.err(
      `note: --height ${shared.height} overrides the declared panel shape on ${declared.length} cut(s): ${declared.map((d) => d.entry.job.id).join(", ")}`,
    );
    return null;
  }

  for (const { entry, panelAspect } of declared) {
    const column = typeof shared.width === "number" ? shared.width : entry.latentWidth;
    if (column === undefined) {
      return {
        error: `cut ${entry.job.id} declares a panel shape, but the column to size it against is unknown: the workflow's latent declares no width at the mapped node. Pass --width <px>, or point the workflow's node mapping at its latent.`,
        exit: EXIT_USAGE,
      };
    }
    const height = latentHeightFor(column, panelAspect);
    // The size goes through `inputs`, so the size that is recorded is the size
    // that is submitted.
    entry.job.inputs = { ...entry.job.inputs, width: column, height };
    entry.job.request = requestFor(entry.job.inputs);
    entry.job.label = `${entry.job.label} at ${column}x${height}`;
  }
  return null;
}

/**
 * Write what produced this image back onto the cut (#240), so the next run
 * reproduces it from the project alone.
 *
 * The project is re-read rather than reusing the copy this command loaded: the
 * ingest that just ran rewrote `cuts.yaml` with the new image reference, and
 * writing back a copy read before that would undo it. `writeCuts` validates the
 * whole set and touches only this episode's cuts file.
 *
 * Ordering is deliberate. The image and its reference are already on disk when
 * this runs, so an interrupted run leaves an image whose inputs went unrecorded
 * — the same direction an interrupted ingest already fails in, and the one a
 * re-run fixes.
 */
async function recordRenderInputs(root: string, target: CutAssetTarget, job: Job): Promise<void> {
  const loaded = await loadProject(root);
  // The ingest a moment ago located this episode and refused without it, so a
  // miss here means it was removed mid-run: write nothing rather than guess.
  const bundle = loaded.project.episodes.find((b) => b.episode.id === target.episodeId);
  if (bundle === undefined) return;
  const cuts = bundle.cuts.map((cut) =>
    cut.id === target.cutId
      ? {
          ...cut,
          imagePrompt: job.basePrompt ?? cut.imagePrompt,
          negativePrompt: job.inputs.negativePrompt,
          imageSeed: job.inputs.seed,
          ...(job.inputs.workflow === undefined ? {} : { imageWorkflow: job.inputs.workflow }),
        }
      : cut,
  );
  await writeCuts(root, target.episodeId, cuts);
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

  // Load the project ONCE and CONSULT the validation report it returns (#261).
  //
  // Every other command that loads a project consults it; this was the only one
  // that did not, and it is the one that spends generation time. The prompt, the
  // lockstrings, the palette and the panel shape are all read out of records
  // this command does not otherwise check, so a project `toony validate` rejects
  // used to generate anyway: art written into the project from data nobody had
  // looked at, and a run that exited 0.
  //
  // A transition run is covered too. It needs no cut data, but it still writes
  // into the project through the same ingest path, and on the tree before this
  // gate a `--transition` run against a project that could not even be LOADED
  // submitted its request first and failed afterwards.
  //
  // Placement is deliberate and pinned by test. It is BELOW the flag checks
  // above, so `--slot bogus` is still the usage error it has always been rather
  // than a validation report about an unrelated field. It is ABOVE `planJobs`
  // and `applyPanelShapes`, so an invalid project is named as invalid instead of
  // surfacing as whatever secondary complaint the run would have hit first.
  //
  // `@toony/generate-gate` owns what refuses and what only warns, and why.
  let loaded: LoadedProject;
  try {
    loaded = await loadProject(root);
  } catch (cause) {
    // Matches `validate.ts`: an IO/parse failure is a usage error; anything else
    // is a bug in the reader and must not be disguised as one.
    if (cause instanceof ProjectIoError) {
      io.err(cause.message);
      return EXIT_USAGE;
    }
    throw cause;
  }
  if (!loaded.validation.valid) {
    const { blocking, wiring } = partitionIssues(loaded.validation);
    if (blocking.length === 0) {
      // Half-wired, not malformed: every record generation reads is intact and
      // only the references between them are unfinished. Say so loudly — this
      // is the "loud warning" half of the ticket — and generate.
      io.err(`warning: ${wiring.length} unwired reference(s) in ${root}:`);
      for (const issue of wiring) io.err(`  - [${issue.code}] ${issue.path}`);
      io.err('generating anyway; run "toony validate" for the full report.');
    } else {
      // The SAME report `toony validate` prints, from the same function, so an
      // author reads one command's output instead of running two. Any blocking
      // issue refuses the whole run, even alongside wiring ones.
      io.err(textReport(root, loaded.validation));
      // ...then what the validator cannot say: the value that is actually there.
      // Without it, `panelAspect: "1.4"` answers "must be a number between 0.1
      // and 10" with a number between 0.1 and 10, and the quotes — the entire
      // defect — go unmentioned.
      for (const line of authoredValueLines(loaded.project, blocking)) io.err(line);
      io.err(
        'nothing was generated: "toony generate" does not generate from a project that does not validate. Fix the issue(s) above and re-run.',
      );
      return EXIT_VALIDATION;
    }
  }

  // Plan every job BEFORE the first request. Usage problems (an unusable prompt)
  // abort the whole run here, so a multi-cut run never spends GPU minutes on
  // cut-001 only to discover cut-007 was never going to work. Only GENERATION
  // failures are per-cut, and those are what the summary below reports.
  const workflowFlag = parsed.values.get("--workflow");
  const jobs = planJobs(loaded, {
    episodeId,
    cutIds,
    ...(transitionId === undefined ? {} : { transitionId }),
    slot,
    ...(prompt === undefined ? {} : { prompt }),
    ...(negative === undefined ? {} : { negative }),
    ...(workflowFlag === undefined ? {} : { workflow: workflowFlag }),
    shared,
  });
  if ("error" in jobs) {
    io.err(jobs.error);
    if (jobs.usage) io.err(USAGE);
    return EXIT_USAGE;
  }

  const packs = await discoverPackContent(root, io);

  // One provider per DISTINCT workflow the run needs, all built before the first
  // request so an unknown workflow name costs no GPU minutes. A run needs one
  // provider in the usual case and more only when its cuts recorded different
  // workflows (#240) — which is what re-rendering a batch looks like once cuts
  // remember what drew them.
  const ready: ReadyJob[] = [];
  const providers = new Map<string, BuiltProvider>();
  for (const job of jobs.jobs) {
    const workflow = job.inputs.workflow;
    let built = providers.get(workflow ?? "");
    if (built === undefined) {
      const result = await buildProvider(providerId, root, io, packs.workflows, workflow);
      if ("error" in result) {
        // Say WHOSE workflow failed when the name came off a cut rather than the
        // command line, or the operator reads it as a complaint about a flag
        // they did not pass.
        io.err(
          workflow === undefined || workflow === workflowFlag
            ? result.error
            : `${result.error} (cut ${job.id} records workflow "${workflow}")`,
        );
        return EXIT_USAGE;
      }
      built = result;
      if (built.provider.transmitsRemotely && !parsed.booleans.has("--allow-remote")) {
        io.err(
          `provider "${providerId}" would send prompt content to a non-local server; re-run with --allow-remote to opt in, or point it at a loopback endpoint (localhost or 127.0.0.1) to keep content on this machine`,
        );
        return EXIT_USAGE;
      }
      providers.set(workflow ?? "", built);
    }
    ready.push({
      job,
      provider: built.provider,
      ...(built.latentWidth === undefined ? {} : { latentWidth: built.latentWidth }),
    });
  }

  // The declared shapes need the resolved workflow's column, so this is the
  // first point they CAN be resolved — and it is still before the first request,
  // so an unresolvable shape costs nothing.
  const shapes = applyPanelShapes(ready, shared, io);
  if (shapes !== null) {
    io.err(shapes.error);
    return shapes.exit;
  }

  const generated: string[] = [];
  const failed: string[] = [];
  // The run reports the code the FIRST failed job would have returned alone, so
  // a single-job run keeps exactly the exit code it has always had.
  let failureCode: number | null = null;

  for (const { job, provider } of ready) {
    const target = job.target;
    try {
      const result = await provider.produce(job.request);
      const ingested = await ingestImageAsset(root, target, result, job.inputs);
      // Write-back precedes the success line: a run that says "generated" has
      // left the project able to generate it again.
      if (target.kind === "cut") await recordRenderInputs(root, target, job);
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
