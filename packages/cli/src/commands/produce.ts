// `toony produce <inspect|run>` — the controlled execution loop (#313).
//
// Generation is the one step that spends minutes per cut and can reset a
// reviewed cut to draft, so a run first states what it will touch and then
// runs on exactly that set. `inspect` resolves a target set exactly as
// `toony generate` would, through the same selectors, and prints what the run
// would touch: the ids, how many already carry an image, how many carry recorded
// render inputs, how many carry a non-draft review that the run would reset, and
// every reason the run would have to stop. It makes no provider call. `run`
// prints the same disclosure, checks that the caller named this exact target
// set (selectors that now resolve differently stop the run), records the
// planned run, and then drives the shipped `generate`
// (or `import-image`) in-process with explicit `--cut` ids. It writes no cut
// field, no review state and no ingest entry itself: those keep their one
// writer. It records what it resolved, what each target came back as, and why it
// stopped, in `episodes/<id>/logs/produce.json`.
//
// A revision is a run whose inputs differ from what the cuts recorded: a prompt,
// a negative prompt, a seed, a workflow, a size. It must state a reason, once,
// for the whole run. A run that changes no input is a repeat and is reported as
// one. The controller never invents a prompt, a character or a seed, and never
// re-issues a run with the flags a repeat refusal printed.
//
// Exit codes: 0 completed (for `inspect`, nothing would stop the run); 1 a stop
// or a domain error, including an unnamed target set and a failed cut; 2 usage or
// IO failure.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { episodeDir, loadProject, ProjectIoError, readDraft } from "@toony/project-io";
import { type Cut, type EpisodeBundle, REVIEW_STATUSES, type ReviewStatus } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { promptFindings } from "../generation-preflight.js";
import { FRESH_SEED, type GenerateEvent, runGenerate } from "./generate.js";
import { runImportImage } from "./import-image.js";
import { runLintEpisode } from "./lint.js";

export interface ProduceIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
}

const USAGE = `usage:
  toony produce inspect [path] --episode <id> ([--cut <id> ...] [--review-status <status>]) [--json]
  toony produce run [path] --episode <id> ([--cut <id> ...] [--review-status <status>]) --accept <target-set>
                   [--reason <text>] [--from <file>] [--prompt <text>] [--negative <text>] [--seed <n>|fresh]
                   [--workflow <name>] [--width <px>] [--height <px>] [--slot clean|final]
                   [--provider <id>] [--framing scene|detail] [--allow-remote] [--json]`;

/** The inputs a run may change. Any one present makes the run a revision. */
const INPUT_FLAGS = [
  "--prompt",
  "--negative",
  "--seed",
  "--workflow",
  "--width",
  "--height",
  "--framing",
] as const;

const VALUE_FLAGS = new Set([
  "--episode",
  "--review-status",
  "--accept",
  "--reason",
  "--from",
  "--slot",
  "--provider",
  ...INPUT_FLAGS,
]);
const LIST_FLAGS = new Set(["--cut"]);
const BOOLEAN_FLAGS = new Set(["--allow-remote", "--json"]);

/** The controller's own log, beside the ingest log. */
export const PRODUCE_LOG_FILE = "produce.json";

interface Parsed {
  positional: string[];
  values: Map<string, string>;
  lists: Map<string, string[]>;
  booleans: Set<string>;
}

function parse(args: string[]): Parsed | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const booleans = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg) || LIST_FLAGS.has(arg)) {
      const value = args[i + 1];
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

// --- Disclosure -------------------------------------------------------------

/** One reason the run would stop, naming the target and what is undetermined. */
export interface Stop {
  target: string;
  reason:
    | "no-prompt"
    | "unknown-character"
    | "not-accepted"
    | "no-reason"
    | "refused"
    | "composition";
  message: string;
}

/** Everything shown before a provider is reached. */
export interface Disclosure {
  episodeId: string;
  selectors: { cuts: string[]; reviewStatus: ReviewStatus | null };
  targets: string[];
  /** Stable name of this exact target set; `--accept` must match it. */
  targetSet: string;
  withImage: number;
  withRecordedInputs: number;
  willResetReview: string[];
  valid: boolean;
  lintFindings: number;
  draft: { scriptRevision: string; briefRevision: string | null } | null;
  stops: Stop[];
}

function targetSetId(episodeId: string, targets: readonly string[]): string {
  return createHash("sha256")
    .update(`${episodeId}\n${[...targets].sort().join("\n")}`)
    .digest("hex")
    .slice(0, 16);
}

function hasImage(cut: Cut): boolean {
  return cut.image !== null && (cut.image.clean !== null || cut.image.final !== null);
}

type Resolved =
  | { kind: "targets"; bundle: EpisodeBundle; targets: Cut[] }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

/**
 * Resolve the target set the way `toony generate` does: explicit ids, or a
 * review status over the episode narrowed by any ids given. Unknown ids are an
 * error; a selector that matches nothing is an empty, successful set.
 */
function resolveTargets(
  bundle: EpisodeBundle,
  cutIds: readonly string[],
  reviewStatus: ReviewStatus | null,
): Resolved {
  const byId = new Map(bundle.cuts.map((cut) => [cut.id, cut]));
  for (const id of cutIds) {
    if (!byId.has(id)) return { kind: "error", message: `cut not found: ${id}` };
  }
  let ids = cutIds.length > 0 ? [...cutIds] : bundle.cuts.map((cut) => cut.id);
  if (reviewStatus !== null) {
    ids = ids.filter((id) => (byId.get(id)?.reviewStatus ?? "draft") === reviewStatus);
    if (ids.length === 0) {
      return {
        kind: "empty",
        message: `No cuts with review status "${reviewStatus}" in episode ${bundle.episode.id}.`,
      };
    }
  }
  return {
    kind: "targets",
    bundle,
    targets: ids.map((id) => byId.get(id)).filter((cut): cut is Cut => cut !== undefined),
  };
}

/** The shipped lint report for one episode, read as JSON. */
async function lintReport(
  root: string,
  episodeId: string,
): Promise<{ findings: Array<{ code: string; targetId: string; severity: string }> }> {
  const out: string[] = [];
  const err: string[] = [];
  await runLintEpisode([episodeId, root, "--json"], {
    cwd: root,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  try {
    const parsed = JSON.parse(out.join("\n")) as { findings?: unknown };
    return { findings: Array.isArray(parsed.findings) ? parsed.findings : [] };
  } catch {
    return { findings: [] };
  }
}

async function disclose(
  root: string,
  bundle: EpisodeBundle,
  targets: readonly Cut[],
  selectors: Disclosure["selectors"],
  valid: boolean,
  prompt: string | undefined,
  framing: string | undefined,
  checkComposition = true,
): Promise<Disclosure> {
  const episodeId = bundle.episode.id;
  const ids = targets.map((cut) => cut.id);
  const stops: Stop[] = [];
  for (const cut of targets) {
    if (checkComposition) {
      if (framing !== undefined && framing !== "scene" && framing !== "detail") {
        stops.push({
          target: cut.id,
          reason: "composition",
          message: "--framing must be scene or detail",
        });
      } else {
        for (const finding of promptFindings(
          cut,
          prompt ?? cut.imagePrompt,
          framing ?? cut.imageFraming ?? "scene",
        )) {
          stops.push({
            target: cut.id,
            reason: "composition",
            message: `[${finding.code}] ${finding.message}`,
          });
        }
      }
    }
    if ((prompt === undefined || prompt.trim() === "") && cut.imagePrompt.trim() === "") {
      stops.push({
        target: cut.id,
        reason: "no-prompt",
        message: `cut ${cut.id} has no usable prompt and the run names none; the controller does not write one`,
      });
    }
  }
  const lint = await lintReport(root, episodeId);
  const targetSet = new Set(ids);
  for (const finding of lint.findings) {
    if (finding.code === "character/unknown-ref" && targetSet.has(finding.targetId)) {
      stops.push({
        target: finding.targetId,
        reason: "unknown-character",
        message: `cut ${finding.targetId} names a character the registry does not define; the controller does not choose one`,
      });
    }
  }
  let draft: Disclosure["draft"] = null;
  try {
    const loaded = await readDraft(root, episodeId);
    if (loaded.draft !== null) {
      draft = {
        scriptRevision: loaded.draft.scriptRevision,
        briefRevision: loaded.draft.briefRevision,
      };
    }
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
  }
  return {
    episodeId,
    selectors,
    targets: ids,
    targetSet: targetSetId(episodeId, ids),
    withImage: targets.filter(hasImage).length,
    withRecordedInputs: targets.filter((cut) => cut.imageSeed !== undefined).length,
    willResetReview: targets
      .filter((cut) => cut.reviewStatus === "human-edited" || cut.reviewStatus === "final")
      .map((cut) => `${cut.id} (${cut.reviewStatus})`),
    valid,
    lintFindings: lint.findings.length,
    draft,
    stops,
  };
}

function disclosureLines(d: Disclosure): string[] {
  const lines = [
    `produce: ${d.targets.length} target(s) in ${d.episodeId}: ${d.targets.join(", ")}`,
    `  target set ${d.targetSet}`,
    `  with image: ${d.withImage}; with recorded render inputs: ${d.withRecordedInputs}; non-draft review the run resets: ${d.willResetReview.length}${d.willResetReview.length > 0 ? ` (${d.willResetReview.join(", ")})` : ""}`,
    `  project valid: ${d.valid ? "yes" : "no"}; lint findings on the episode: ${d.lintFindings}`,
    d.draft === null
      ? "  draft: none for this episode"
      : `  draft: script ${d.draft.scriptRevision.slice(0, 12)}, brief ${d.draft.briefRevision?.slice(0, 12) ?? "none"}`,
  ];
  for (const stop of d.stops) lines.push(`  stop [${stop.reason}] ${stop.target}: ${stop.message}`);
  return lines;
}

// --- The run log ------------------------------------------------------------

type Outcome = "generated" | "failed" | "unrecorded" | "imported" | "not-reached";

interface RunRecord {
  run: number;
  state: "planned" | "finished";
  kind: "render" | "repeat" | "revision" | "import";
  episodeId: string;
  targetSet: string;
  targets: string[];
  selectors: Disclosure["selectors"];
  changed: string[];
  reason: string | null;
  draft: Disclosure["draft"];
  disclosure: { withImage: number; withRecordedInputs: number; willResetReview: string[] };
  outcomes?: Record<string, Outcome>;
  rewrotePrompt?: string[];
  exit?: number;
  stopped?: string | null;
}

function logPath(root: string, episodeId: string): string {
  return join(episodeDir(root, episodeId), "logs", PRODUCE_LOG_FILE);
}

async function readLog(root: string, episodeId: string): Promise<RunRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(logPath(root, episodeId), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

async function appendLog(root: string, episodeId: string, record: RunRecord): Promise<void> {
  const entries = await readLog(root, episodeId);
  // The finished entry replaces the planned one for the same run, so the log
  // holds one entry per run and an interrupted run is the one still "planned".
  const index = entries.findIndex((e) => e.run === record.run);
  if (index >= 0) entries[index] = record;
  else entries.push(record);
  const file = logPath(root, episodeId);
  await mkdir(join(episodeDir(root, episodeId), "logs"), { recursive: true });
  await writeFile(file, `${JSON.stringify(entries, null, 2)}\n`);
}

// --- Shared front half ------------------------------------------------------

interface Front {
  root: string;
  episodeId: string;
  bundle: EpisodeBundle;
  valid: boolean;
  resolved: Resolved;
  selectors: Disclosure["selectors"];
}

async function front(parsed: Parsed, io: ProduceIo): Promise<Front | number> {
  const episodeId = parsed.values.get("--episode");
  if (episodeId === undefined) {
    io.err("missing required --episode <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const statusFlag = parsed.values.get("--review-status");
  const reviewStatus = REVIEW_STATUSES.find((s) => s === statusFlag) ?? null;
  if (statusFlag !== undefined && reviewStatus === null) {
    io.err(`--review-status must be one of: ${REVIEW_STATUSES.join(", ")}`);
    return EXIT_USAGE;
  }
  const cutIds = [...new Set(parsed.lists.get("--cut") ?? [])];
  if (cutIds.length === 0 && reviewStatus === null) {
    io.err("specify --cut <id> (repeatable) and/or --review-status <status>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(root);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      io.err(cause.message);
      return EXIT_USAGE;
    }
    throw cause;
  }
  const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
  if (bundle === undefined) {
    io.err(`episode not found: ${episodeId}`);
    return EXIT_USAGE;
  }
  return {
    root,
    episodeId,
    bundle,
    valid: loaded.validation.valid,
    resolved: resolveTargets(bundle, cutIds, reviewStatus),
    selectors: { cuts: cutIds, reviewStatus },
  };
}

// --- inspect ----------------------------------------------------------------

async function runInspect(parsed: Parsed, io: ProduceIo): Promise<number> {
  for (const flag of parsed.values.keys()) {
    if (flag !== "--episode" && flag !== "--review-status") {
      io.err(`${flag} is not an option of "toony produce inspect"`);
      return EXIT_USAGE;
    }
  }
  const f = await front(parsed, io);
  if (typeof f === "number") return f;
  if (f.resolved.kind === "error") {
    io.err(f.resolved.message);
    return EXIT_USAGE;
  }
  const json = parsed.booleans.has("--json");
  if (f.resolved.kind === "empty") {
    if (json) io.out(JSON.stringify({ episodeId: f.episodeId, targets: [], stops: [] }, null, 2));
    else io.out(f.resolved.message);
    return EXIT_OK;
  }
  const d = await disclose(
    f.root,
    f.bundle,
    f.resolved.targets,
    f.selectors,
    f.valid,
    parsed.values.get("--prompt"),
    parsed.values.get("--framing"),
  );
  if (json) io.out(JSON.stringify(d, null, 2));
  else {
    for (const line of disclosureLines(d)) io.out(line);
    io.out(
      d.stops.length === 0
        ? `next: toony produce run --episode ${d.episodeId} ${d.targets.map((id) => `--cut ${id}`).join(" ")} --accept ${d.targetSet}`
        : `${d.stops.length} stop(s); resolve them before running`,
    );
  }
  if (!d.valid) {
    io.err("the project does not pass validation; run `toony validate`");
    return EXIT_VALIDATION;
  }
  return d.stops.length === 0 ? EXIT_OK : EXIT_VALIDATION;
}

// --- run --------------------------------------------------------------------

async function runRun(parsed: Parsed, io: ProduceIo): Promise<number> {
  const f = await front(parsed, io);
  if (typeof f === "number") return f;
  if (f.resolved.kind === "error") {
    io.err(f.resolved.message);
    return EXIT_USAGE;
  }
  const json = parsed.booleans.has("--json");
  if (f.resolved.kind === "empty") {
    io.out(f.resolved.message);
    return EXIT_OK;
  }
  const { root, episodeId, bundle, resolved } = f;
  const prompt = parsed.values.get("--prompt");
  const d = await disclose(
    root,
    bundle,
    resolved.targets,
    f.selectors,
    f.valid,
    prompt,
    parsed.values.get("--framing"),
    !parsed.values.has("--from"),
  );

  const from = parsed.values.get("--from");
  const changed = INPUT_FLAGS.filter((flag) => parsed.values.has(flag)).map((flag) =>
    flag === "--seed" && parsed.values.get(flag) === FRESH_SEED ? "--seed fresh" : flag,
  );
  const reason = parsed.values.get("--reason") ?? null;
  const anyRecord = resolved.targets.some((cut) => cut.imageSeed !== undefined);
  let kind: RunRecord["kind"];
  if (from !== undefined) kind = "import";
  else if (changed.length > 0 && anyRecord) kind = "revision";
  else if (changed.length === 0 && anyRecord) kind = "repeat";
  else kind = "render";

  // The caller names THIS resolved set by its id, so a run never draws cuts
  // the inspect step did not list.
  const accept = parsed.values.get("--accept");
  if (accept === undefined) {
    d.stops.push({
      target: d.targets.join(", "),
      reason: "not-accepted",
      message: `target set ${d.targetSet} is not named; re-run with --accept ${d.targetSet} to run exactly this set`,
    });
  } else if (accept !== d.targetSet) {
    d.stops.push({
      target: d.targets.join(", "),
      reason: "not-accepted",
      message: `the resolved target set is ${d.targetSet}, not the accepted ${accept}; the selectors resolve differently now, review again`,
    });
  }
  if (kind === "revision" && (reason === null || reason.trim() === "")) {
    d.stops.push({
      target: d.targets.join(", "),
      reason: "no-reason",
      message: `this run changes ${changed.join(", ")} on cuts that recorded a render; state why with --reason, the controller does not invent one`,
    });
  }
  if (from !== undefined && resolved.targets.length !== 1) {
    io.err("--from imports one image into exactly one --cut");
    return EXIT_USAGE;
  }

  const kindLine =
    `  run kind: ${kind}` +
    (changed.length > 0 ? ` (changes ${changed.join(", ")})` : "") +
    (reason !== null ? `; reason: ${JSON.stringify(reason)}` : "");
  if (!json) {
    for (const line of disclosureLines(d)) io.out(line);
    io.out(kindLine);
  }
  if (!d.valid) {
    d.stops.push({
      target: d.targets.join(", "),
      reason: "refused",
      message: "the project does not pass validation; run `toony validate`",
    });
  }
  if (d.stops.length > 0) {
    if (json)
      io.out(JSON.stringify({ ...d, kind, changed, reason, exit: EXIT_VALIDATION }, null, 2));
    else
      for (const stop of d.stops) io.err(`stop [${stop.reason}] ${stop.target}: ${stop.message}`);
    return EXIT_VALIDATION;
  }

  // Planned, before the first provider call, so an interrupted run leaves a
  // record of what it was about to do.
  const previous = await readLog(root, episodeId);
  const record: RunRecord = {
    run: (previous.at(-1)?.run ?? 0) + 1,
    state: "planned",
    kind,
    episodeId,
    targetSet: d.targetSet,
    targets: d.targets,
    selectors: d.selectors,
    changed,
    reason,
    draft: d.draft,
    disclosure: {
      withImage: d.withImage,
      withRecordedInputs: d.withRecordedInputs,
      willResetReview: d.willResetReview,
    },
  };
  await appendLog(root, episodeId, record);

  // Drive the shipped command with explicit ids and the operator's own inputs.
  // Its lines are forwarded as printed; the per-target outcomes arrive as events.
  const outcomes: Record<string, Outcome> = Object.fromEntries(
    d.targets.map((id) => [id, "not-reached" as Outcome]),
  );
  const rewrote: string[] = [];
  const stderr: string[] = [];
  const child = {
    cwd: io.cwd,
    out: io.out,
    err: (line: string) => {
      stderr.push(line);
      io.err(line);
    },
    env: io.env,
    report: (event: GenerateEvent) => {
      if (event.kind === "started") return;
      if (event.kind === "rewrote-prompt") rewrote.push(event.id);
      else outcomes[event.id] = event.kind;
    },
  };
  let exit: number;
  if (from !== undefined) {
    const args = [root, "--episode", episodeId, "--cut", d.targets[0] ?? "", "--from", from];
    for (const flag of ["--slot", "--provider"] as const) {
      const value = parsed.values.get(flag);
      if (value !== undefined) args.push(flag, value);
    }
    if (parsed.booleans.has("--allow-remote")) args.push("--allow-remote");
    exit = await runImportImage(args, child);
    if (exit === EXIT_OK) outcomes[d.targets[0] ?? ""] = "imported";
  } else {
    const args = [root, "--episode", episodeId];
    for (const id of d.targets) args.push("--cut", id);
    for (const flag of [...INPUT_FLAGS, "--slot", "--provider"] as const) {
      const value = parsed.values.get(flag);
      if (value !== undefined) args.push(flag, value);
    }
    if (parsed.booleans.has("--allow-remote")) args.push("--allow-remote");
    exit = await runGenerate(args, child);
  }

  const reached = Object.values(outcomes).some((o) => o !== "not-reached");
  const finished: RunRecord = {
    ...record,
    state: "finished",
    outcomes,
    rewrotePrompt: rewrote,
    exit,
    // A run that reached no target stopped before its first provider call; the
    // shipped command's own refusal is the reason, kept as it printed it.
    stopped: exit !== EXIT_OK && !reached ? stderr.join("\n") : null,
  };
  await appendLog(root, episodeId, finished);

  if (json) {
    io.out(
      JSON.stringify(
        { ...d, kind, changed, reason, outcomes, rewrotePrompt: rewrote, exit },
        null,
        2,
      ),
    );
  } else {
    const counts = new Map<Outcome, string[]>();
    for (const [id, outcome] of Object.entries(outcomes)) {
      counts.set(outcome, [...(counts.get(outcome) ?? []), id]);
    }
    io.out(
      `produce run ${record.run} ${exit === EXIT_OK ? "completed" : "stopped"}: ${[
        ...counts.entries(),
      ]
        .map(([outcome, ids]) => `${ids.length} ${outcome} (${ids.join(", ")})`)
        .join("; ")}`,
    );
  }
  return exit;
}

/** Run `toony produce <inspect|run>`. Returns the process exit code. */
export async function runProduce(args: string[], io: ProduceIo): Promise<number> {
  const [sub, ...rest] = args;
  const parsed = parse(rest);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }
  switch (sub) {
    case "inspect":
      return runInspect(parsed, io);
    case "run":
      return runRun(parsed, io);
    default:
      io.err(sub === undefined ? "missing subcommand" : `unknown produce subcommand: ${sub}`);
      io.err(USAGE);
      return EXIT_USAGE;
  }
}
