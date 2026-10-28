// Drawing jobs: the agent's requests to draw or edit cut artwork, run in the
// background one at a time (the engine draws one image at a time). Each work
// keeps its recent jobs in `.toony/agent/art-jobs.json`, so a Studio restart
// shows a job it cut short as interrupted; nothing is drawn again by itself. Each cut is
// one run of the shared generate path (`@toony/generate`) in-process, exactly
// as `toony generate` draws it. The slow render happens outside the project
// lock; each finished image is written through Studio's write path, so it is
// journaled, undoable and shown on the left right away like any other change.
// Views never carry absolute paths.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type GenerateEvent, runGenerate } from "@toony/generate";
import { importedAssetPath, ProjectIoError } from "@toony/project-io";
import type { ArtJobCut, ArtJobView, ProjectChange } from "../agent/protocol.js";
import { readPrivateJson, writePrivateJson } from "../agent/storage.js";
import { DRAW_CUTS_MAX } from "../agent/tools/args.js";
import { isUuid } from "../agent/types.js";
import { liveBus } from "../live/bus.js";
import { OpError } from "../ops/errors.js";
import { cutLabel } from "../ops/labels.js";
import { episodeFiles } from "../ops/paths.js";
import { type OpContext, withProjectWrite } from "../ops/write.js";
import { redactPaths } from "../redact.js";

export interface ArtJobItem {
  cutId: string;
  /** How the cut reads to a person, for example "Cut 3". */
  label: string;
  /** The image prompt, in English. Absent: the cut's own prompt. */
  prompt?: string;
  negative?: string;
  framing?: "detail";
  /** "fresh" for a new take, a number to pin one. Absent: the cut's recorded seed. */
  seed?: number | "fresh";
  /** Draw from this cut's picture (a continuity source) instead of from noise. */
  fromCutId?: string;
  /** An edit that changes only this part of the picture (fractions of the source). */
  region?: { x: number; y: number; w: number; h: number };
}

export interface ArtJobParams {
  /** Who asks and for which work (actor "agent", with the conversation id). */
  ctx: OpContext;
  episodeId: string;
  kind: "draw" | "edit";
  items: ArtJobItem[];
  /** For an edit: how much of the current image may change, above 0 and at most 1. */
  strength?: number;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Replaces the generate run in tests; the real one draws with the engine. */
export type GenerateRunner = typeof runGenerate;

type Listener = (view: ArtJobView, changes: readonly ProjectChange[]) => void;

interface JobRecord {
  view: ArtJobView;
  params: ArtJobParams;
  listeners: Set<Listener>;
  changes: ProjectChange[];
  stop: boolean;
  done: Promise<ArtJobView>;
}

interface Registry {
  jobs: Map<string, JobRecord>;
  queue: Promise<unknown>;
  pending: number;
  runner: GenerateRunner;
  /** Work folders whose saved jobs were read back in this process. */
  restored: Set<string>;
  /** The last save per work root, so saves land in order. */
  saving: Map<string, Promise<void>>;
}

/** Where a work keeps its recent drawing jobs. */
export const ART_JOBS_FILE = ".toony/agent/art-jobs.json";
/** Jobs kept in that file per work, newest last. */
const SAVED_JOBS_KEPT = 20;

const FINISHED_JOBS_KEPT = 50;
/** A prompt or message longer than this is cut, so a view stays small. */
const MESSAGE_MAX = 400;

const state = globalThis as typeof globalThis & { toonyArtJobs?: Registry };
function registry(): Registry {
  state.toonyArtJobs ??= {
    jobs: new Map(),
    queue: Promise.resolve(),
    pending: 0,
    runner: runGenerate,
    restored: new Set(),
    saving: new Map(),
  };
  return state.toonyArtJobs;
}

/**
 * Run other engine work (a character's training) in the drawing queue, so it
 * never runs while cuts are drawn, and drawings queued after it wait for it.
 */
export function queueEngineWork<T>(work: () => Promise<T>): Promise<T> {
  const reg = registry();
  reg.pending++;
  const done = reg.queue.then(work).finally(() => {
    reg.pending--;
  });
  reg.queue = done.catch(() => undefined);
  return done;
}

/** Start a short portrait call only when the engine is free, without a long tool wait. */
export function tryEngineWork<T>(work: () => Promise<T>): Promise<T> | null {
  return registry().pending > 0 ? null : queueEngineWork(work);
}

/** Use another generate runner (tests). Returns the previous one. */
export function setGenerateRunner(runner: GenerateRunner): GenerateRunner {
  const previous = registry().runner;
  registry().runner = runner;
  return previous;
}

function finished(view: ArtJobView): boolean {
  return view.state === "finished" || view.state === "stopped" || view.state === "interrupted";
}

/** A work's jobs, oldest first. */
function jobsOf(workId: string): ArtJobView[] {
  return [...registry().jobs.values()]
    .filter((record) => record.view.workId === workId)
    .map((record) => record.view)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Save the work's recent jobs, after reading back the ones saved before a
 * restart so they are kept. Best effort: the live job stays authoritative.
 */
function save(workId: string, root: string): void {
  const reg = registry();
  const previous = reg.saving.get(root) ?? Promise.resolve();
  const next = previous
    .then(() => restoreArtJobs(workId, root))
    .then(() =>
      writePrivateJson(join(root, ART_JOBS_FILE), {
        version: 1,
        jobs: jobsOf(workId).slice(-SAVED_JOBS_KEPT),
      }),
    )
    .catch(() => {});
  reg.saving.set(root, next);
}

const SAVED_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const SAVED_TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]{8,15}Z$/;
const SAVED_LABEL = /^(Cut \d{1,4}|a cut)$/;
const JOB_STATES = new Set<ArtJobView["state"]>([
  "queued",
  "running",
  "finished",
  "stopped",
  "interrupted",
]);
const CUT_STATES = new Set<ArtJobCut["state"]>(["queued", "drawing", "done", "failed", "skipped"]);

function savedText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const clean = redactPaths(value);
  return clean.length > MESSAGE_MAX ? `${clean.slice(0, MESSAGE_MAX - 1)}…` : clean;
}

/**
 * A saved job, rebuilt field by field. The file travels with the project, so
 * nothing is taken as is: ids and times must have their shape, states their
 * known values, labels read "Cut N", messages are clipped and path free, and
 * the chat id is dropped (a restored job never posts to a chat).
 */
function savedJob(value: unknown, workId: string): ArtJobView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isUuid(v.id) || v.workId !== workId) return null;
  if (typeof v.episodeId !== "string" || !SAVED_ID.test(v.episodeId)) return null;
  if (v.kind !== "draw" && v.kind !== "edit") return null;
  if (!JOB_STATES.has(v.state as ArtJobView["state"])) return null;
  if (typeof v.createdAt !== "string" || !SAVED_TIME.test(v.createdAt)) return null;
  if (!Array.isArray(v.cuts) || v.cuts.length > DRAW_CUTS_MAX) return null;
  const cuts: ArtJobCut[] = [];
  for (const raw of v.cuts as unknown[]) {
    if (!raw || typeof raw !== "object") return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.cutId !== "string" || !SAVED_ID.test(c.cutId)) return null;
    if (!CUT_STATES.has(c.state as ArtJobCut["state"])) return null;
    const message = savedText(c.message);
    cuts.push({
      cutId: c.cutId,
      label: typeof c.label === "string" && SAVED_LABEL.test(c.label) ? c.label : "a cut",
      state: c.state as ArtJobCut["state"],
      ...(message ? { message } : {}),
      ...(isUuid(c.changeId) ? { changeId: c.changeId } : {}),
    });
  }
  const time = (key: "startedAt" | "finishedAt") =>
    typeof v[key] === "string" && SAVED_TIME.test(v[key] as string)
      ? { [key]: v[key] as string }
      : {};
  return {
    id: v.id,
    workId,
    episodeId: v.episodeId,
    kind: v.kind,
    state: v.state as ArtJobView["state"],
    cuts,
    createdAt: v.createdAt,
    ...time("startedAt"),
    ...time("finishedAt"),
  };
}

/**
 * Read a work's saved jobs once per process. A job that was queued or running
 * when Toony stopped becomes interrupted: its unfinished cuts say what
 * happened, and it is never started again by itself.
 */
export async function restoreArtJobs(workId: string, root: string): Promise<void> {
  const reg = registry();
  if (reg.restored.has(root)) return;
  reg.restored.add(root);
  let saved: unknown;
  try {
    saved = await readPrivateJson(join(root, ART_JOBS_FILE));
  } catch {
    return;
  }
  const jobs = (saved as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return;
  let changed = false;
  for (const value of jobs.slice(-SAVED_JOBS_KEPT)) {
    const view = savedJob(value, workId);
    if (!view || reg.jobs.has(view.id)) continue;
    if (!finished(view)) {
      changed = true;
      view.state = "interrupted";
      view.finishedAt = new Date().toISOString();
      for (const cut of view.cuts) {
        if (cut.state === "drawing") {
          cut.state = "failed";
          cut.message =
            "Toony stopped while this cut was being drawn. Look at the cut; draw it again if it did not change.";
        } else if (cut.state === "queued") {
          cut.state = "skipped";
          cut.message = "Toony stopped before this cut was drawn.";
        }
      }
    }
    reg.jobs.set(view.id, {
      view,
      params: {
        ctx: { workId, root, actor: "agent" },
        episodeId: view.episodeId,
        kind: view.kind,
        items: [],
      },
      listeners: new Set(),
      changes: [],
      stop: false,
      done: Promise.resolve(view),
    });
  }
  if (changed) save(workId, root);
}

function publish(record: JobRecord): void {
  const view = structuredClone(record.view);
  save(record.view.workId, record.params.ctx.root);
  try {
    liveBus().publish({ type: "art", job: view });
  } catch {
    // The live feed is a convenience; the job itself stays authoritative.
  }
  for (const listener of record.listeners) {
    try {
      listener(view, [...record.changes]);
    } catch {
      // A listener's failure never stops the drawing or other listeners.
    }
  }
}

function prune(jobs: Map<string, JobRecord>): void {
  const done = [...jobs.values()].filter((job) => finished(job.view));
  for (const job of done.slice(0, Math.max(0, done.length - FINISHED_JOBS_KEPT))) {
    jobs.delete(job.view.id);
  }
}

/** One line a person can read, from what the generate run said. */
export function plainFailure(lines: readonly string[], root: string): string {
  if (lines.some((line) => line.includes("[detail-character-context]"))) {
    return "This close-up needs detail framing to keep full character descriptions out of the picture.";
  }
  const useful = lines
    .filter((line) => !line.startsWith("usage:") && !line.startsWith("note:"))
    .map((line) => line.replace(/^generation failed for [^:]+: /, "").replace(/^error: /, ""));
  const text = (useful.join(" ").trim() || "The artwork engine could not draw this cut.")
    .split(root)
    .join("the project");
  const clean = redactPaths(text);
  return clean.length > MESSAGE_MAX ? `${clean.slice(0, MESSAGE_MAX - 1)}…` : clean;
}

/**
 * Asked of the engine on every agent drawing, after the agent's own negative:
 * one picture, not a comic page, and no lettering. In the first benchmark the
 * engine drew panel grids and fake-text bubbles on a third of the cuts; with
 * these words, same seed, it drew one clean picture.
 */
export const AGENT_NEGATIVE_BASE =
  "multiple panels, comic page, panel border, split screen, speech bubble, text, watermark";

/**
 * How much of the cut it continues from a drawing may change: enough for a new
 * pose and action, little enough that the place, light and colours carry over.
 */
export const CONTINUITY_STRENGTH = 0.8;

/** A prompt as one safe argument: the run reads a leading dash as a flag. */
function promptArg(text: string): string {
  return text.trim().replace(/^-+\s*/, "");
}

/** Messages after which drawing the rest would fail the same way. */
const ENGINE_DOWN =
  /could not reach|lost connection|no ComfyUI endpoint|not configured|non-local server|timed-out job could not be confirmed/i;

async function drawOne(record: JobRecord, cut: ArtJobCut, item: ArtJobItem): Promise<void> {
  const { params } = record;
  const { ctx, episodeId } = params;
  const args = [ctx.root, "--episode", episodeId, "--cut", item.cutId];
  const prompt = item.prompt === undefined ? "" : promptArg(item.prompt);
  if (prompt !== "") args.push("--prompt", prompt);
  const negative = [
    item.negative === undefined ? "" : promptArg(item.negative),
    AGENT_NEGATIVE_BASE,
  ]
    .filter((part) => part !== "")
    .join(", ");
  args.push("--negative", negative);
  if (item.framing !== undefined) args.push("--framing", item.framing);
  if (item.seed !== undefined) args.push("--seed", String(item.seed));
  if (params.kind === "edit") {
    args.push("--source", "current", "--strength", String(params.strength ?? 0.5));
    if (item.region !== undefined) {
      const { x, y, w, h } = item.region;
      args.push("--region", [x, y, w, h].map((n) => Number(n.toFixed(4))).join(","));
    }
  } else if (item.fromCutId !== undefined) {
    args.push("--source", `cut:${item.fromCutId}`, "--strength", String(CONTINUITY_STRENGTH));
  }
  const lines: string[] = [];
  // Written from the run's callbacks, so kept in an object TypeScript does not narrow.
  const heard: { outcome: GenerateEvent["kind"] | null; failure: string | null } = {
    outcome: null,
    failure: null,
  };
  const exit = await registry().runner(args, {
    cwd: ctx.root,
    out: () => {},
    err: (line) => lines.push(line),
    env: params.env ?? process.env,
    keepCutPrompt: true,
    standalonePrompt: true,
    keepDetail: true,
    replaces: true,
    report: (event) => {
      if (event.kind === "started") {
        cut.state = "drawing";
        publish(record);
        return;
      }
      if (event.kind === "rewrote-prompt") return;
      heard.outcome = event.kind;
      if (event.kind === "failed") heard.failure = event.message;
    },
    commit: async ({ target, bytes }, write) => {
      if (target.kind !== "cut") return write();
      const files = episodeFiles(target.episodeId);
      const asset = importedAssetPath(target, bytes);
      try {
        const { result, change } = await withProjectWrite(
          ctx,
          {
            summary: params.kind === "edit" ? "Changed the artwork" : "Drew the artwork",
            scopes: [{ kind: "artwork", episodeId: target.episodeId, cutId: target.cutId }],
            files: [files.cuts, `${files.folder}/logs/ingest.json`, ...(asset ? [asset] : [])],
            errors: "as-is",
          },
          async (tx) => {
            const label = cutLabel(tx.before, target.episodeId, target.cutId);
            tx.setSummary(
              params.kind === "edit" ? `Changed the artwork of ${label}` : `Drew ${label}`,
            );
            return write();
          },
        );
        if (change !== null) {
          record.changes.push(change);
          cut.changeId = change.changeId;
        }
        return result;
      } catch (error) {
        if (error instanceof ProjectIoError) throw error;
        // The run reports a project problem as this cut's failure and goes on.
        throw new ProjectIoError(
          error instanceof OpError ? error.message : "Could not save the new artwork.",
          "",
        );
      }
    },
  });
  if (heard.outcome === "generated" || heard.outcome === "unrecorded") {
    cut.state = "done";
    delete cut.message;
    return;
  }
  cut.state = "failed";
  cut.message = plainFailure(heard.failure === null ? lines : [heard.failure], ctx.root);
  if (exit === 0 && heard.outcome === null) cut.message = "Nothing was drawn for this cut.";
}

async function run(record: JobRecord): Promise<ArtJobView> {
  const view = record.view;
  if (record.stop) {
    for (const cut of view.cuts) cut.state = "skipped";
    view.state = "stopped";
    view.finishedAt = new Date().toISOString();
    publish(record);
    return structuredClone(view);
  }
  view.state = "running";
  view.startedAt = new Date().toISOString();
  publish(record);
  for (const [index, cut] of view.cuts.entries()) {
    const item = record.params.items[index];
    if (item === undefined) continue;
    if (record.stop) {
      cut.state = "skipped";
      cut.message = "Stopped before this cut.";
      continue;
    }
    try {
      await drawOne(record, cut, item);
    } catch {
      cut.state = "failed";
      cut.message = "The artwork engine could not draw this cut.";
    }
    publish(record);
    if (cut.state === "failed" && cut.message && ENGINE_DOWN.test(cut.message)) {
      for (const rest of view.cuts.slice(index + 1)) {
        rest.state = "skipped";
        rest.message = "Not drawn: the artwork engine stopped answering.";
      }
      break;
    }
  }
  view.state = record.stop ? "stopped" : "finished";
  view.finishedAt = new Date().toISOString();
  publish(record);
  return structuredClone(view);
}

/**
 * Queue a drawing job and return its view right away. `listener` hears every
 * update (with the changes written so far) until the job ends.
 */
export function startArtJob(params: ArtJobParams, listener?: Listener): ArtJobView {
  const reg = registry();
  const view: ArtJobView = {
    id: randomUUID(),
    workId: params.ctx.workId,
    episodeId: params.episodeId,
    kind: params.kind,
    state: "queued",
    cuts: params.items.map((item) => ({ cutId: item.cutId, label: item.label, state: "queued" })),
    createdAt: new Date().toISOString(),
    ...(params.ctx.conversationId ? { conversationId: params.ctx.conversationId } : {}),
  };
  const record: JobRecord = {
    view,
    params,
    listeners: new Set(listener ? [listener] : []),
    changes: [],
    stop: false,
    done: Promise.resolve(view),
  };
  record.done = queueEngineWork(() => run(record));
  reg.jobs.set(view.id, record);
  prune(reg.jobs);
  publish(record);
  return structuredClone(view);
}

export function getArtJob(id: string): ArtJobView | null {
  const record = registry().jobs.get(id);
  return record ? structuredClone(record.view) : null;
}

/** The changes a job has written so far, oldest first. */
export function artJobChanges(id: string): ProjectChange[] {
  return [...(registry().jobs.get(id)?.changes ?? [])];
}

/** Wait for the job saves in flight (tests remove the work folder after). */
export async function artJobsSaved(): Promise<void> {
  await Promise.all(registry().saving.values());
}

/** Jobs for a work, newest first; with `root`, saved jobs from before a restart too. */
export async function listArtJobs(workId: string, root?: string): Promise<ArtJobView[]> {
  if (root !== undefined) await restoreArtJobs(workId, root);
  return jobsOf(workId)
    .map((view) => structuredClone(view))
    .reverse();
}

/** Listen to a job until it ends. Returns a function that stops listening. */
export function watchArtJob(id: string, listener: Listener): () => void {
  const record = registry().jobs.get(id);
  if (!record) return () => {};
  record.listeners.add(listener);
  return () => record.listeners.delete(listener);
}

/**
 * Wait until the job ends or `ms` pass. Resolves with the view either way;
 * `onTick` runs about once a second so a caller can keep its turn alive.
 */
export async function waitForArtJob(
  id: string,
  ms: number,
  onTick?: () => void,
): Promise<ArtJobView | null> {
  const record = registry().jobs.get(id);
  if (!record) return null;
  const deadline = Date.now() + ms;
  while (!finished(record.view) && Date.now() < deadline) {
    await Promise.race([
      record.done,
      new Promise((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now()))),
    ]);
    onTick?.();
  }
  return structuredClone(record.view);
}

/**
 * Stop a job: cuts not started yet are skipped. A cut the engine is drawing
 * now still finishes and is stored. Returns the view, or null for no such job.
 */
export function stopArtJob(id: string): ArtJobView | null {
  const record = registry().jobs.get(id);
  if (!record) return null;
  if (!finished(record.view)) {
    record.stop = true;
    publish(record);
  }
  return structuredClone(record.view);
}
