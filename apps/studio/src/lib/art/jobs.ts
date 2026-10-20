// Drawing jobs: the agent's requests to draw or edit cut artwork, run in the
// background one at a time (the engine draws one image at a time). Each cut is
// one run of the shared generate path (`@toony/generate`) in-process, exactly
// as `toony generate` draws it. The slow render happens outside the project
// lock; each finished image is written through Studio's write path, so it is
// journaled, undoable and shown on the left right away like any other change.
// Views never carry absolute paths.

import { randomUUID } from "node:crypto";
import { type GenerateEvent, runGenerate } from "@toony/generate";
import { importedAssetPath, ProjectIoError } from "@toony/project-io";
import type { ArtJobCut, ArtJobView, ProjectChange } from "../agent/protocol.js";
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
  /** "fresh" for a new take, a number to pin one. Absent: the cut's recorded seed. */
  seed?: number | "fresh";
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
  runner: GenerateRunner;
}

const FINISHED_JOBS_KEPT = 50;
/** A prompt or message longer than this is cut, so a view stays small. */
const MESSAGE_MAX = 400;

const state = globalThis as typeof globalThis & { toonyArtJobs?: Registry };
function registry(): Registry {
  state.toonyArtJobs ??= { jobs: new Map(), queue: Promise.resolve(), runner: runGenerate };
  return state.toonyArtJobs;
}

/** Use another generate runner (tests). Returns the previous one. */
export function setGenerateRunner(runner: GenerateRunner): GenerateRunner {
  const previous = registry().runner;
  registry().runner = runner;
  return previous;
}

function finished(view: ArtJobView): boolean {
  return view.state === "finished" || view.state === "stopped";
}

function publish(record: JobRecord): void {
  const view = structuredClone(record.view);
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
  const useful = lines
    .filter((line) => !line.startsWith("usage:") && !line.startsWith("note:"))
    .map((line) => line.replace(/^generation failed for [^:]+: /, "").replace(/^error: /, ""));
  const text = (useful.join(" ").trim() || "The artwork engine could not draw this cut.")
    .split(root)
    .join("the project");
  const clean = redactPaths(text);
  return clean.length > MESSAGE_MAX ? `${clean.slice(0, MESSAGE_MAX - 1)}…` : clean;
}

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
  if (item.negative !== undefined && promptArg(item.negative) !== "") {
    args.push("--negative", promptArg(item.negative));
  }
  if (item.seed !== undefined) args.push("--seed", String(item.seed));
  if (params.kind === "edit") {
    args.push("--source", "current", "--strength", String(params.strength ?? 0.5));
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
  const done = reg.queue.then(() => run(record));
  record.done = done;
  reg.queue = done.catch(() => undefined);
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

/** Jobs for a work, newest first. */
export function listArtJobs(workId: string): ArtJobView[] {
  return [...registry().jobs.values()]
    .filter((record) => record.view.workId === workId)
    .map((record) => structuredClone(record.view))
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
