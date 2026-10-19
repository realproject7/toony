import { createHash } from "node:crypto";
import { type LoadedProject, writeTransitions } from "@toony/project-io";
import {
  isPathSafeId,
  type Project,
  type SequenceItem,
  type Transition,
  validateProject,
} from "@toony/schema";
import type { ProjectChange } from "./agent/protocol.js";
import { type ActorInfo, contextFor } from "./ops/context.js";
import { episodeLabel, findEpisode } from "./ops/labels.js";
import { episodeFiles } from "./ops/paths.js";
import { withProjectWrite } from "./ops/write.js";

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

/**
 * Save an episode's transitions and reading order through the project write
 * path (lock, undo snapshot, journal, live event). The base revision check
 * runs inside the lock, against the episode as it is on disk.
 */
export async function saveTransitionsChange(
  root: string,
  payload: TransitionSavePayload,
  info: ActorInfo = {},
): Promise<{ result: SaveResult; change: ProjectChange | null }> {
  const { episodeId } = payload;
  if (!isPathSafeId(episodeId)) {
    return { result: { ok: false, error: `unknown episode "${episodeId}"` }, change: null };
  }
  const files = episodeFiles(episodeId);
  return withProjectWrite(
    contextFor(root, { workId: payload.workId, ...info }),
    {
      summary: "Updated transitions",
      scopes: [{ kind: "sequence", episodeId }],
      files: [files.transitions, files.episode],
      errors: "as-is",
    },
    async (tx) => {
      const label = episodeLabel(findEpisode(tx.before, episodeId), episodeId);
      tx.setSummary(`Updated transitions in ${label}`);
      return commit(tx.root, payload, tx.before);
    },
  );
}

/** Save an episode's transitions. See `saveTransitionsChange`. */
export async function saveTransitions(
  root: string,
  payload: TransitionSavePayload,
  info: ActorInfo = {},
): Promise<SaveResult> {
  return (await saveTransitionsChange(root, payload, info)).result;
}
async function commit(
  root: string,
  payload: TransitionSavePayload,
  loaded: LoadedProject,
): Promise<SaveResult> {
  const { episodeId, sequence, transitions } = payload;
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
