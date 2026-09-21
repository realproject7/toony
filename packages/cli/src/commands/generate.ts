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
// A finished CLEAN render writes what produced it back onto the cut (#240): the
// prompt, the negative prompt, the seed, and the workflow's name when the run
// named one. The seed and the workflow fall back to those recorded values the
// same way the prompt already fell back to `cut.imagePrompt`, so re-running a
// cut with no flags at all returns the image the operator accepted instead of
// rolling a fresh seed, and an agent's converged prompt survives the shell it
// was typed into. An explicit flag still wins for the run it is given on.
//
// A cut has ONE such record and TWO images, so the record describes the clean
// plate and a `--slot final` run neither writes nor reads it. The ingest log
// covers both: the same inputs reach it for every render, composed exactly as
// submitted and keyed by asset path, so any panel can answer what produced it.
// Generation is the one step here that costs minutes and is not deterministic;
// before this it was also the only one that wrote down nothing about its inputs.
//
// The log is read back, too. Size is the one input a cut does not record, so a
// run that pins none takes the workflow's latent — and if that is not the size
// the image on disk was rendered at, the run would REPLACE an accepted plate
// while reading as a repeat of it. `assertRepeatable` refuses that before the
// first request.
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
  readStoryBible,
  recordedRenderInputs,
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
import { type Character, type Cut, type EpisodeBundle, REVIEW_STATUSES } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { passesAuthoringGate } from "../generate-gate.js";
import { discoverPackContent } from "../packs.js";
import { appendPaletteClause } from "../palette.js";
import { latentHeightFor } from "../panel-shape.js";
import { shellQuote } from "../shell.js";

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
  "--review-status",
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
  "usage: toony generate [path] --episode <id> ([--cut <id> ...] --review-status draft|human-edited|final | --cut <id> [--cut <id> ...] | --transition <id>) [--slot clean|final] --prompt <text> [--negative <text>] [--width <px>] [--height <px>] [--seed <n>] [--workflow <name>] [--provider comfyui] [--allow-remote]";

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
 * The size the resolved workflow generates at: the dimensions its own latent
 * declares, read through the same injection map the provider writes sizes
 * through. The width is the number a cut's declared shape (#237) is a multiple
 * of; both are what a run that resolves no size of its own will actually render
 * at, which is how a repeat of a render is told from a replacement of it (#240).
 *
 * Either is `undefined` when the mapped node carries no usable value — a mapping
 * that points at nothing is the operator's to fix, not something to guess for.
 */
function workflowLatentSize(config: {
  workflow: Record<string, { inputs: Record<string, unknown> }>;
  injectionMap: { widthNode: string; widthInput: string; heightNode: string; heightInput: string };
}): { width?: number; height?: number } {
  const read = (node: string, input: string): number | undefined => {
    const raw = config.workflow[node]?.inputs?.[input];
    return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
  };
  const width = read(config.injectionMap.widthNode, config.injectionMap.widthInput);
  const height = read(config.injectionMap.heightNode, config.injectionMap.heightInput);
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

/** A built provider, with the size its workflow draws at where that is known. */
interface BuiltProvider {
  provider: ImageProvider;
  latent: { width?: number; height?: number };
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
      return { provider: new ComfyUIProvider(config), latent: workflowLatentSize(config) };
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
   * The cut's declared panel shape (#237), when it declared one. Carried rather
   * than resolved here because it needs the column the workflow draws at, and
   * the workflow is not resolved until after planning — planning exists to
   * reject a caller mistake before anything reaches a provider.
   */
  panelAspect?: number;
}

/** A planned job with the provider that will run it, and that provider's latent. */
interface ReadyJob {
  job: Job;
  provider: ImageProvider;
  latent: { width?: number; height?: number };
}

interface PlanInput {
  storyBible: string;
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
 *
 * `record` is the cut whose recorded inputs this job may replay, and it is
 * supplied ONLY for the slot those inputs describe — see `recordRenderInputs`.
 * A cut has one record and two images, so replaying it into the other slot would
 * hand one plate's seed to the other.
 */
function resolveInputs(
  prompt: string,
  basePrompt: string,
  negativePrompt: string,
  shared: Readonly<Record<string, string | number>>,
  workflow: string | undefined,
  record: Cut | undefined,
): RenderInputs {
  const resolvedWorkflow = workflow ?? record?.imageWorkflow;
  return {
    prompt: prompt.trim(),
    basePrompt,
    negativePrompt,
    seed: typeof shared.seed === "number" ? shared.seed : (record?.imageSeed ?? randomSeed()),
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

/** Compose once for both new requests and repeat-instruction verification. */
function composePrompt(
  basePrompt: string,
  cut: Cut | undefined,
  registry: readonly Character[],
  storyBible: string,
): string {
  const scene = appendPaletteClause(
    injectCharacterLockstrings(basePrompt, cut?.characters, registry),
    cut?.palette,
  );
  return storyBible === "" ? scene : `Story context:\n${storyBible}\n\nScene:\n${scene}`;
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
  const { episodeId, cutIds, transitionId, slot, prompt, negative, workflow, shared, storyBible } =
    input;
  const NO_PROMPT = "generation requires --prompt <text> (or a non-empty cut imagePrompt)";
  if (transitionId !== undefined) {
    if (prompt === undefined || prompt.trim().length === 0)
      return { error: NO_PROMPT, usage: true };
    // A transition record has no prompt or seed fields, so nothing is written
    // back for it; its inputs are recorded in the ingest log like a cut's.
    const inputs = resolveInputs(
      composePrompt(prompt, undefined, [], storyBible),
      prompt,
      negative ?? "",
      shared,
      workflow,
      undefined,
    );
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
    const composed = composePrompt(cutPrompt, cut, registry, storyBible);
    // The cut's recorded inputs describe its clean plate, so only a clean run
    // replays them. The PROMPT still falls back for either slot, as it has since
    // #38: `imagePrompt` is authored text a cut has always shared between its
    // two images, and it is read above, before this.
    const inputs = resolveInputs(
      composed,
      cutPrompt,
      cutNegative ?? "",
      shared,
      workflow,
      slot === "clean" ? cut : undefined,
    );
    jobs.push({
      id: cutId,
      label: `cut ${cutId} (${slot})`,
      target: { kind: "cut", episodeId, cutId, slot },
      request: requestFor(inputs),
      inputs,
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
    const column = typeof shared.width === "number" ? shared.width : entry.latent.width;
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
 * repeats it from the project alone. Returns the reason it could not, or `null`.
 *
 * ONLY FOR THE CLEAN SLOT. A cut carries one `imagePrompt`/`imageSeed` pair and
 * two images, so a record written by a `--slot final` run replaces the one the
 * clean plate needs — and the next clean run, reading it back, redraws the plate
 * the operator accepted from the final pass's inputs. One record cannot describe
 * two renders, so it describes the clean one. A final render's inputs are in the
 * episode's ingest log, whose entries are per asset path.
 *
 * The project is re-read rather than reusing the copy this command loaded: the
 * ingest that just ran rewrote `cuts.yaml` with the new image reference, and
 * writing back a copy read before that would undo it. `writeCuts` validates the
 * whole set and touches only this episode's cuts file.
 *
 * Ordering is deliberate. The image and its reference are already on disk when
 * this runs, so an interrupted run leaves an image whose inputs went unrecorded
 * — the same direction an interrupted ingest already fails in, and the one a
 * re-run fixes. What the CALLER must not do is report that state as a failed
 * generation, which would send an operator to redo a render that succeeded.
 */
async function recordRenderInputs(
  root: string,
  target: CutAssetTarget,
  job: Job,
): Promise<string | null> {
  try {
    const loaded = await loadProject(root);
    // The ingest a moment ago located this episode and refused without it, so a
    // miss here means it was removed mid-run: write nothing rather than guess.
    const bundle = loaded.project.episodes.find((b) => b.episode.id === target.episodeId);
    if (bundle === undefined) return null;
    const cuts = bundle.cuts.map((cut) =>
      cut.id === target.cutId
        ? {
            ...cut,
            imagePrompt: job.inputs.basePrompt,
            negativePrompt: job.inputs.negativePrompt,
            imageSeed: job.inputs.seed,
            ...(job.inputs.workflow === undefined ? {} : { imageWorkflow: job.inputs.workflow }),
          }
        : cut,
    );
    await writeCuts(root, target.episodeId, cuts);
    return null;
  } catch (cause) {
    // A project-level IO or validation problem is the recordable failure this
    // reports. Anything else is a bug here and must not be disguised as one.
    if (cause instanceof ProjectIoError) return cause.message;
    throw cause;
  }
}

/** What one job would submit, for comparison against what a record holds. */
interface RepeatContext {
  job: Job;
  latent: { width?: number; height?: number };
  /**
   * What this run would SUBMIT for a given base prompt: the same composition
   * `planJobs` applies, over the cut as it stands now. A base prompt is an
   * ingredient, not an input the model ever saw, so the only way to know whether
   * asking for one restores a recorded render is to compose it and look.
   */
  recompose: (basePrompt: string) => string;
}

/**
 * No answer, as distinct from an answer of `undefined`.
 *
 * `undefined` is a VALUE this run would submit: it names no workflow, so the
 * local config resolves one, and that is a real difference from a recorded name.
 * `UNKNOWABLE` is the absence of an answer — the workflow's latent declares no
 * width at the mapped node, so nothing can be said about what this run would
 * render at, and a difference must not be claimed. Reading the first as the
 * second is how the workflow fell out of the instruction on the one slot that
 * never replays it.
 */
const UNKNOWABLE = Symbol("unknowable");

/**
 * The record says nothing about this input, and its silence is silence — the
 * size was never recorded, so there is nothing to differ from.
 *
 * Which fields get this is a per-field decision, not the loop's: an absent
 * `workflow` is NOT silence. It says the run that produced the image named no
 * workflow, so the local config resolved one, and that is as comparable as a
 * name. Reading it as silence let a run with `--workflow` replace a plate
 * rendered without one, and record the wrong graph as what produced it.
 */
const UNRECORDED = Symbol("unrecorded");

/**
 * This input is asked for by ANOTHER entry's flag — a decision, unlike `null`,
 * which is the answer of an entry that cannot say how to restore its value and
 * is named in the refusal so it cannot vanish from the instruction.
 *
 * It names the carrier because it is a claim about a different entry, and the
 * claim is checked: an entry whose carrier contributed nothing is named like any
 * other that nothing can ask for. Deferring to an entry that never ran is how a
 * value sitting in the record goes unprinted — an entry that has not decided
 * cannot borrow the silence of one that has, one level out.
 */
/** How one recorded input is compared against this run, and asked for again. */
interface RepeatInput {
  /**
   * What the RECORD holds for that input, or `UNRECORDED` when its absence says
   * nothing. Raw: `instruct` is where a value is type-checked, because that is
   * where one is printed.
   */
  recorded: (record: RenderInputs) => string | number | undefined | typeof UNRECORDED;
  /**
   * What THIS run would use for that input, or `UNKNOWABLE` when there is no
   * answer to compare. `undefined` is an answer: see the symbol's own note.
   */
  submitted: (ctx: RepeatContext) => string | number | undefined | typeof UNKNOWABLE;
  /**
   * Whether a difference here REFUSES the run. Size only, and only where the run
   * left the dimension for the workflow to decide: a record edited on purpose is
   * not a mistake, and refusing on the rest would turn every deliberate edit
   * into a usage error whose only answer is retyping the value just written.
   */
  refuses: (ctx: RepeatContext) => boolean;
  /**
   * The flag that asks for the recorded value, or `null` when nothing can ask
   * for it — which is reported, not skipped, so an entry that decides nothing
   * says so out loud instead of vanishing from the instruction.
   */
  instruct: (
    value: string | number | undefined,
    record: RenderInputs,
    ctx: RepeatContext,
  ) => string | null;
}

/**
 * How a repeat of a recorded render gets each input back — one entry per field
 * of `RenderInputs`, and the whole of what `assertRepeatable` knows.
 *
 * Keyed by `keyof RenderInputs`, so a field added to the record and not decided
 * here does not compile. That is the entire point of the shape. The instruction
 * this table builds has shipped incomplete three times — first without the seed,
 * then without the workflow, then without the prompts — and every omission was
 * silent, because the fields were enumerated by hand and the list was shorter
 * than the record. An operator who follows an incomplete instruction destroys
 * the plate they were trying to keep, having done exactly what the tool said.
 *
 * A field is named only when this run would NOT arrive at the recorded value by
 * itself, which is the same question for every field and is asked the same way:
 * compare `submitted` against the record. That covers the slot asymmetry without
 * knowing about it — a cut's record describes its clean plate, so a `--slot
 * final` run replays none of the prompt, the negative prompt, the seed or the
 * workflow, and each of them differs and is named.
 */
const REPEAT_INPUTS: Record<keyof RenderInputs, RepeatInput> = {
  // A dimension the run pinned is deliberate, so it does not refuse — but it is
  // still NAMED when it differs, because the operator's own `--width` stays in
  // the command and an instruction that leaves it out is false.
  width: {
    recorded: (record) => record.width ?? UNRECORDED,
    submitted: ({ job, latent }) => job.inputs.width ?? latent.width ?? UNKNOWABLE,
    refuses: ({ job }) => job.inputs.width === undefined,
    instruct: (value) => (typeof value === "number" ? `--width ${shellQuote(value)}` : null),
  },
  height: {
    recorded: (record) => record.height ?? UNRECORDED,
    submitted: ({ job, latent }) => job.inputs.height ?? latent.height ?? UNKNOWABLE,
    refuses: ({ job }) => job.inputs.height === undefined,
    instruct: (value) => (typeof value === "number" ? `--height ${shellQuote(value)}` : null),
  },
  seed: {
    recorded: (record) => record.seed ?? UNRECORDED,
    submitted: ({ job }) => job.inputs.seed,
    refuses: () => false,
    instruct: (value) => (typeof value === "number" ? `--seed ${shellQuote(value)}` : null),
  },
  // The ONLY field whose absence in the record is an answer rather than silence:
  // it says the producing run named no workflow, and `--workflow ""` is how a
  // run says that too.
  workflow: {
    recorded: (record) => record.workflow,
    submitted: ({ job }) => job.inputs.workflow,
    refuses: () => false,
    instruct: (value) => {
      if (value === undefined) return `--workflow ${shellQuote("")}`;
      return typeof value === "string" ? `--workflow ${shellQuote(value)}` : null;
    },
  },
  // Two entries, two questions, and neither can answer both.
  //
  // WHETHER a `--prompt` is needed is this entry's question, because the
  // submitted prompt is the only string the model ever saw. WHAT it should say
  // is the base prompt, because `planJobs` composes the lockstrings (#92) and
  // the palette clause (#207) again on the way in.
  //
  // Asking the base prompt's own question instead prints a flag whenever an
  // ingredient MOVED — the #92 migration takes a lockstring out of an authored
  // prompt and into the registry, leaving the submitted prompt identical — and
  // that flag composes the lockstring in a second time.
  //
  // The value is only an instruction if composing it NOW still produces what
  // was submitted. When the cut's own characters or palette changed under the
  // record, nothing a flag can say restores that prompt, and this returns null
  // so the field is named rather than guessed at.
  prompt: {
    // Older logs stored whitespace that the provider trimmed before submission.
    // Compare their original wire meaning without rewriting the historical log.
    recorded: (record) => (typeof record.prompt === "string" ? record.prompt.trim() : UNRECORDED),
    submitted: ({ job }) => job.inputs.prompt,
    refuses: () => false,
    instruct: (_value, record, ctx) => {
      if (typeof record.basePrompt !== "string") return null;
      return ctx.recompose(record.basePrompt) === record.prompt?.trim()
        ? `--prompt ${shellQuote(record.basePrompt)}`
        : null;
    },
  },
  // This entry does NOT decide whether a prompt is needed — the entry above
  // does, from the string the model saw. It speaks only when that one cannot: a
  // record whose submitted prompt is unreadable still holds the value that
  // would restore the render, and dropping it prints nothing while the answer
  // sits in the log. Nothing here can be verified against a submitted prompt
  // that is not there, so this is the best available answer rather than a
  // checked one.
  basePrompt: {
    recorded: (record) =>
      typeof record.prompt === "string" ? UNRECORDED : (record.basePrompt ?? UNRECORDED),
    submitted: ({ job }) => job.inputs.basePrompt,
    refuses: () => false,
    instruct: (value) => (typeof value === "string" ? `--prompt ${shellQuote(value)}` : null),
  },
  negativePrompt: {
    recorded: (record) => record.negativePrompt ?? UNRECORDED,
    submitted: ({ job }) => job.inputs.negativePrompt,
    refuses: () => false,
    instruct: (value) => (typeof value === "string" ? `--negative ${shellQuote(value)}` : null),
  },
};

/** The project-relative image a record currently points at, for either kind. */
function associatedAsset(bundle: EpisodeBundle | undefined, target: AssetTarget): string | null {
  if (target.kind === "cut") {
    return bundle?.cuts.find((cut) => cut.id === target.cutId)?.image?.[target.slot] ?? null;
  }
  return bundle?.transitions.find((t) => t.id === target.transitionId)?.image ?? null;
}

/**
 * Refuse a run that would REPLACE an accepted image with a different render
 * while reading as a repeat of it (#240).
 *
 * Size is the one generation input a cut does not record. A cut that declares a
 * shape (#237) says both of its dimensions, and a run says whichever of them it
 * pins — but an UNPINNED dimension takes the workflow's latent, which is not
 * what produced the image on disk if that image was rendered at another size.
 * Everything else replays, so the run looks like a faithful repeat, overwrites
 * the plate the operator approved, and says nothing.
 *
 * That is the only thing it refuses over, and the check is narrow by
 * construction: an asset with nothing recorded is no claim to repeat, and a
 * dimension the run pinned is deliberate. What it then PRINTS is a different
 * question, and `REPEAT_INPUTS` answers it for every field of the record rather
 * than for the ones anybody remembered: an instruction that repeats the render
 * is the reason this refusal exists.
 *
 * It refuses rather than warning, and refuses the whole run before the first
 * request: the damage is destructive and the alternative — a warning above a
 * replaced plate — is the silence this exists to remove.
 */
async function assertRepeatable(
  root: string,
  ready: readonly ReadyJob[],
  bundle: EpisodeBundle | undefined,
  registry: readonly Character[],
  storyBible: string,
): Promise<{ error: string; exit: number } | null> {
  for (const { job, latent } of ready) {
    const target = job.target;
    // The path the RECORD holds, matched whole: an id may contain a dot, so a
    // name-prefix lookup lets a sibling record's asset answer for this one.
    const assetPath = associatedAsset(bundle, target);
    if (assetPath === null) continue;
    const recorded = await recordedRenderInputs(root, target.episodeId, assetPath);
    if (recorded === undefined) continue;

    // The cut as it stands NOW, which is what a re-run would compose against.
    const cut = target.kind === "cut" ? bundle?.cuts.find((c) => c.id === target.cutId) : undefined;
    const ctx: RepeatContext = {
      job,
      latent,
      recompose: (basePrompt) => composePrompt(basePrompt, cut, registry, storyBible).trim(),
    };
    const differences: string[] = [];
    const instructions: string[] = [];
    const unaskable: string[] = [];
    for (const key of Object.keys(REPEAT_INPUTS) as (keyof RenderInputs)[]) {
      const input = REPEAT_INPUTS[key];
      const was = input.recorded(recorded);
      if (was === UNRECORDED) continue; // the record's silence is silence here
      const now = input.submitted(ctx);
      if (now === UNKNOWABLE || now === was) continue; // no answer, or already right
      if (input.refuses(ctx)) differences.push(`${key} ${now} instead of ${was}`);
      const flag = input.instruct(was, recorded, ctx);
      // A field nothing can ask for is NAMED, whichever field it is. Reporting
      // only the one field somebody thought of is how an entry that decides
      // nothing contributes nothing and says nothing.
      if (flag === null) unaskable.push(key);
      else instructions.push(flag);
    }
    if (differences.length === 0) continue;

    const lines = [
      `${job.label.split(" at ")[0]}: this run would render at ${differences.join(", ")}, so it would replace the image on disk rather than repeat it — ` +
        `the workflow's own latent stands for a dimension a run does not pin, and that image was not rendered at it. Nothing was generated.`,
      "to repeat that image, add these to the command (replacing any it already passes):",
      `  ${instructions.join(" ")}`,
    ];
    if (unaskable.length > 0) {
      lines.push(
        `  (no flag restores ${unaskable.join(", ")}: what was recorded is in the ingest log for ${assetPath})`,
      );
    }
    return { error: lines.join("\n"), exit: EXIT_USAGE };
  }
  return null;
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
  let cutIds = [...new Set(parsed.lists.get("--cut") ?? [])];
  const reviewStatusFlag = parsed.values.get("--review-status");
  const reviewStatus = REVIEW_STATUSES.find((status) => status === reviewStatusFlag);
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
  if (reviewStatusFlag !== undefined && reviewStatus === undefined) {
    io.err(`--review-status must be one of: ${REVIEW_STATUSES.join(", ")}`);
    return EXIT_USAGE;
  }
  if ((cutIds.length === 0 && reviewStatus === undefined) === (transitionId === undefined)) {
    io.err("specify --cut <id>, --review-status <status>, or exactly one --transition <id>");
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
  // `../generate-gate.ts` shares this rule and report with manual import.
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
  if (!passesAuthoringGate(root, loaded, "generate", io.err)) {
    return EXIT_VALIDATION;
  }
  let storyBible: string;
  try {
    storyBible = await readStoryBible(root);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    io.err(cause.message);
    return EXIT_USAGE;
  }

  // Filter only after the project's validation gate. A status alone selects the
  // episode; explicit cut ids narrow that scope. Unknown ids must not disappear
  // silently into an empty match. No match is a successful, provider-free no-op.
  if (reviewStatus !== undefined) {
    const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
    if (!bundle) {
      io.err(`episode not found: ${episodeId}`);
      return EXIT_USAGE;
    }
    const byId = new Map(bundle.cuts.map((cut) => [cut.id, cut]));
    for (const id of cutIds) {
      if (!byId.has(id)) {
        io.err(`cut not found: ${id}`);
        return EXIT_USAGE;
      }
    }
    cutIds = (cutIds.length > 0 ? cutIds : bundle.cuts.map((cut) => cut.id)).filter(
      (id) => (byId.get(id)?.reviewStatus ?? "draft") === reviewStatus,
    );
    if (cutIds.length === 0) {
      io.out(`No cuts with review status "${reviewStatus}" in episode ${episodeId}.`);
      return EXIT_OK;
    }
  }

  // Plan every job BEFORE the first request. Usage problems (an unusable prompt)
  // abort the whole run here, so a multi-cut run never spends GPU minutes on
  // cut-001 only to discover cut-007 was never going to work. Only GENERATION
  // failures are per-cut, and those are what the summary below reports.
  // An empty `--workflow` is what `--workflow "$WF"` sends when the variable is
  // unset, and it already means "no workflow" to the provider, which drops it
  // and resolves the configured one. Reading it as a NAME here spent the render
  // and then refused to record `imageWorkflow: ""`, which the schema rejects —
  // a run that exits 2 with the image already on disk. Empty is absent, exactly
  // as the provider and the provider cache below both read it. Not trimmed: a
  // name of spaces is a name the provider will fail to find, and inventing a
  // second rule here is how the two drift.
  const workflowFlag = parsed.values.get("--workflow") || undefined;
  const jobs = planJobs(loaded, {
    storyBible,
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
    ready.push({ job, provider: built.provider, latent: built.latent });
  }

  // The declared shapes need the resolved workflow's column, so this is the
  // first point they CAN be resolved — and it is still before the first request,
  // so an unresolvable shape costs nothing.
  const shapes = applyPanelShapes(ready, shared, io);
  if (shapes !== null) {
    io.err(shapes.error);
    return shapes.exit;
  }

  // Sizes are final here, so this is the first point a run can tell a repeat of
  // an accepted image from a replacement of it — and it is still before the
  // first request, so refusing costs nothing.
  const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
  const repeatable = await assertRepeatable(
    root,
    ready,
    bundle,
    loaded.project.webtoon.characters ?? [],
    storyBible,
  );
  if (repeatable !== null) {
    io.err(repeatable.error);
    return repeatable.exit;
  }

  const generated: string[] = [];
  const failed: string[] = [];
  /** Cuts whose image is on disk but whose inputs could not be recorded (#240). */
  const unrecorded: string[] = [];
  // The run reports the code the FIRST failed job would have returned alone, so
  // a single-job run keeps exactly the exit code it has always had.
  let failureCode: number | null = null;

  for (const { job, provider } of ready) {
    const target = job.target;
    try {
      const result = await provider.produce(job.request);
      const ingested = await ingestImageAsset(root, target, result, job.inputs);
      // Write-back precedes the success line: a run that says "generated" has
      // left the project able to generate it again. When it is the write-back
      // that fails, the image and its reference ARE on disk — a different state
      // from a failed generation, and reporting it as one sends the operator to
      // redo a render that succeeded.
      if (target.kind === "cut" && target.slot === "clean") {
        const failure = await recordRenderInputs(root, target, job);
        if (failure !== null) {
          io.err(
            `generated ${ingested.assetPath} for ${job.label}, but recording what produced it failed: ${failure}`,
          );
          io.err(
            `${job.id}: the image and its reference are on disk — do NOT re-render it, a re-run would draw a different one. Fix the problem above and re-record with --seed ${shellQuote(job.inputs.seed)}.`,
          );
          failureCode ??= EXIT_USAGE;
          unrecorded.push(job.id);
          continue;
        }
      }
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
    const named = failed.length === 0 ? counts : `${counts}: ${failed.join(", ")}`;
    // The third state is named only when it happens, so a run that never hits it
    // reports exactly the two counts it always has.
    io.out(
      unrecorded.length === 0
        ? named
        : `${named} (${unrecorded.length} generated but unrecorded: ${unrecorded.join(", ")})`,
    );
  }
  if (generated.length > 0 || unrecorded.length > 0) io.out("next: toony validate");
  return failureCode ?? EXIT_OK;
}
