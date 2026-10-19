// Export jobs: an in-process registry that runs exports in the background, one
// at a time, and reports progress. The export page starts a job through
// `POST /api/export` and follows it through `GET /api/export/jobs/<id>`; the
// agent can call `startExportJob` directly and pass `onProgress` to forward each
// update as a live event. Views never carry absolute paths.

import { randomUUID } from "node:crypto";
import {
  type ContributedExportPreset,
  ExportError,
  type ExportManifest,
  type ExportOptions,
  type ExportPreset,
  exportWithPreset,
  resolveExportPreset,
} from "@toony/export";
import type { ExportJobView } from "./agent/protocol.js";
import { exportFileHref, exportZipHref } from "./export-view.js";

export interface ExportJobParams {
  workId: string;
  /** Absolute work root, resolved path-safely by the caller. Never sent to a browser. */
  workRoot: string;
  episodeId: string;
  /** Output id: a built-in output, `stitched`/`platform`, or a contributed preset. */
  output: string;
  options?: ExportOptions;
  /** Presets installed packs contribute, when the caller offers them. */
  presets?: readonly ContributedExportPreset[];
}

/** A request that cannot become a job (unknown output). */
export class ExportJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Listener = (view: ExportJobView) => void;

interface JobRecord {
  view: ExportJobView;
  listeners: Set<Listener>;
  done: Promise<ExportJobView>;
}

interface Registry {
  jobs: Map<string, JobRecord>;
  /** Exports run one at a time: they are CPU- and memory-heavy. */
  queue: Promise<unknown>;
}

/** Finished jobs kept for late readers; older ones are forgotten first. */
const FINISHED_JOBS_KEPT = 50;

const state = globalThis as typeof globalThis & { toonyExportJobs?: Registry };
function registry(): Registry {
  state.toonyExportJobs ??= { jobs: new Map(), queue: Promise.resolve() };
  return state.toonyExportJobs;
}

function snapshot(view: ExportJobView): ExportJobView {
  return structuredClone(view);
}

function publish(record: JobRecord): void {
  const view = snapshot(record.view);
  for (const listener of record.listeners) {
    try {
      listener(view);
    } catch {
      // A listener's failure never stops the export or other listeners.
    }
  }
}

function prune(jobs: Map<string, JobRecord>): void {
  const finished = [...jobs.values()].filter(
    (job) => job.view.state === "completed" || job.view.state === "failed",
  );
  for (const job of finished.slice(0, Math.max(0, finished.length - FINISHED_JOBS_KEPT))) {
    jobs.delete(job.view.id);
  }
}

/** The result fields of a view, from the manifest an export wrote. */
export function resultFromManifest(
  workId: string,
  manifest: ExportManifest,
): Pick<ExportJobView, "files" | "zipHref" | "warnings" | "manifestHref" | "inputsHash"> {
  const { episodeId, output } = manifest;
  return {
    files: manifest.files.map((file) => {
      const name = file.path.slice(file.path.lastIndexOf("/") + 1);
      return {
        name,
        width: file.width,
        height: file.height,
        bytes: file.byteSize,
        href: exportFileHref(workId, episodeId, output, name, file.sha256),
        sha256: file.sha256,
        role: file.role,
        items: file.items.map((item) => item.id),
        ...(file.post === undefined ? {} : { post: file.post }),
      };
    }),
    zipHref: exportZipHref(workId, episodeId, output),
    manifestHref: exportFileHref(workId, episodeId, output, "manifest.json"),
    warnings: manifest.warnings.map(({ code, message }) => ({ code, message })),
    inputsHash: manifest.inputs.sha256,
  };
}

/** A message a person can act on; engine errors are already path-free. */
function failure(cause: unknown): { code: string; message: string } {
  if (cause instanceof ExportError) return { code: cause.code, message: cause.message };
  return { code: "export-failed", message: "Could not finish the export. Try again." };
}

async function run(
  record: JobRecord,
  params: ExportJobParams,
  preset: ExportPreset,
): Promise<ExportJobView> {
  const view = record.view;
  view.state = "running";
  view.startedAt = new Date().toISOString();
  publish(record);
  try {
    const { manifest } = await exportWithPreset(
      params.workRoot,
      params.episodeId,
      preset,
      params.options ?? {},
      {
        onProgress: (progress) => {
          view.progress = { ...progress };
          publish(record);
        },
      },
    );
    Object.assign(view, resultFromManifest(params.workId, manifest));
    view.state = "completed";
    view.progress = { done: view.progress.total, total: view.progress.total };
  } catch (cause) {
    const { code, message } = failure(cause);
    view.state = "failed";
    view.code = code;
    view.message = message;
  }
  view.finishedAt = new Date().toISOString();
  publish(record);
  return snapshot(view);
}

/**
 * Start an export in the background and return its view right away. A job for
 * the same work, episode and output that is still queued or running is reused,
 * so a double click starts one export. `onProgress` receives every update
 * (state changes and progress counts) until the job finishes.
 */
export async function startExportJob(
  params: ExportJobParams,
  onProgress?: Listener,
): Promise<ExportJobView> {
  const preset = await resolveExportPreset(params.output, params.presets ?? []);
  if (!preset) {
    throw new ExportJobError("unknown-output", `There is no "${params.output}" output.`);
  }
  const { jobs } = registry();
  for (const record of jobs.values()) {
    const v = record.view;
    if (
      (v.state === "queued" || v.state === "running") &&
      v.workId === params.workId &&
      v.episodeId === params.episodeId &&
      v.output === preset.id
    ) {
      if (onProgress) record.listeners.add(onProgress);
      return snapshot(v);
    }
  }
  const reg = registry();
  const record: JobRecord = {
    view: {
      id: randomUUID(),
      workId: params.workId,
      episodeId: params.episodeId,
      output: preset.id,
      state: "queued",
      progress: { done: 0, total: 0 },
    },
    listeners: new Set(onProgress ? [onProgress] : []),
    // Runs after every earlier job has finished, whatever its outcome.
    done: reg.queue.then(() => run(record, params, preset)),
  };
  reg.queue = record.done.catch(() => undefined);
  jobs.set(record.view.id, record);
  prune(jobs);
  return snapshot(record.view);
}

/** The current view of a job, or null when it is unknown or forgotten. */
export function getExportJob(id: string): ExportJobView | null {
  const record = registry().jobs.get(id);
  return record ? snapshot(record.view) : null;
}

/** Resolve when a job finishes, with its final view. */
export async function waitForExportJob(id: string): Promise<ExportJobView | null> {
  const record = registry().jobs.get(id);
  return record ? record.done : null;
}
