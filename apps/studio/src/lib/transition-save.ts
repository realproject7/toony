import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { loadProject, writeTransitions } from "@toony/project-io";
import { type Project, type SequenceItem, type Transition, validateProject } from "@toony/schema";

export interface TransitionSavePayload {
  workId: string;
  episodeId: string;
  sequence: SequenceItem[];
  transitions: Transition[];
  baseRevision: string;
}
export function transitionRevision(sequence: SequenceItem[], transitions: Transition[]): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(canonical({ sequence, transitions })))
    .digest("hex");
}
export function isTransitionSavePayload(value: unknown): value is TransitionSavePayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    Array.isArray(v.sequence) &&
    Array.isArray(v.transitions) &&
    typeof v.baseRevision === "string" &&
    /^[a-f0-9]{64}$/.test(v.baseRevision)
  );
}

type SaveResult = { ok: true; revision: string } | { ok: false; error: string; conflict?: boolean };
// One Studio process serializes its read/check/write. External writers still
// require exclusive project ownership; this is not a cross-process lock.
const writes = new Map<string, Promise<void>>();
export async function saveTransitions(
  root: string,
  payload: TransitionSavePayload,
): Promise<SaveResult> {
  const canonicalRoot = await realpath(root);
  const key = JSON.stringify([canonicalRoot, payload.episodeId]);
  const pending = (writes.get(key) ?? Promise.resolve()).then(() => commit(canonicalRoot, payload));
  const settled = pending.then(
    () => {},
    () => {},
  );
  writes.set(key, settled);
  try {
    return await pending;
  } finally {
    if (writes.get(key) === settled) writes.delete(key);
  }
}
async function commit(root: string, payload: TransitionSavePayload): Promise<SaveResult> {
  const { episodeId, sequence, transitions } = payload;
  const loaded = await loadProject(root);
  // Resolve the episode by exact id match — never join raw input into a path.
  const bundleIndex = loaded.project.episodes.findIndex(
    (bundle) => bundle.episode.id === episodeId,
  );
  const target = loaded.project.episodes[bundleIndex];
  if (bundleIndex === -1 || !target) {
    return { ok: false, error: `unknown episode "${episodeId}"` };
  }

  if (payload.baseRevision !== transitionRevision(target.episode.sequence, target.transitions)) {
    return {
      ok: false,
      conflict: true,
      error:
        "This episode changed after you opened it. Your draft is preserved. Reload the saved version before applying it again.",
    };
  }

  // Build the candidate project with this episode's transitions + sequence
  // replaced, then run the full validator so cross-file integrity (sequence
  // references, id uniqueness, transition-between-cuts shape) is enforced
  // before any bytes are written.
  const candidate: Project = {
    webtoon: loaded.project.webtoon,
    episodes: loaded.project.episodes.map((bundle, index) =>
      index === bundleIndex
        ? {
            ...bundle,
            transitions,
            episode: { ...bundle.episode, sequence },
          }
        : bundle,
    ),
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const prefix = `episodes[${bundleIndex}]`;
    const detail = result.issues
      .filter(
        (issue) =>
          issue.path.startsWith(`${prefix}.transitions`) ||
          issue.path.startsWith(`${prefix}.episode.sequence`) ||
          issue.path === `${prefix}.transitions`,
      )
      .map((issue) => `${issue.path}: ${issue.message}`);
    const message =
      detail.length > 0
        ? `invalid transitions: ${detail.join("; ")}`
        : `invalid project after edit: ${result.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`;
    return { ok: false, error: message };
  }

  await writeTransitions(
    root,
    episodeId,
    { ...target.episode, sequence },
    transitions,
    target.cuts,
  );
  return { ok: true, revision: transitionRevision(sequence, transitions) };
}
