import { createHash } from "node:crypto";
import { type LoadedProject, writeLettering } from "@toony/project-io";
import { isPathSafeId, type LetteringOverlay, type Project, validateProject } from "@toony/schema";
import type { ProjectChange } from "./agent/protocol.js";
import { type ActorInfo, contextFor } from "./ops/context.js";
import { cutLabel } from "./ops/labels.js";
import { episodeFiles } from "./ops/paths.js";
import { withProjectWrite } from "./ops/write.js";

export interface CutLetteringPayload {
  workId: string;
  episodeId: string;
  cutId: string;
  overlays: LetteringOverlay[];
  baseRevision?: string;
}

/** Compare saved content rather than timestamps or unrelated sibling cuts. */
export function cutLetteringRevision(overlays: readonly LetteringOverlay[]): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(canonical(overlays)))
    .digest("hex");
}

export function isCutLetteringPayload(value: unknown): value is CutLetteringPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    typeof v.cutId === "string" &&
    v.cutId.length > 0 &&
    Array.isArray(v.overlays) &&
    (v.baseRevision === undefined ||
      (typeof v.baseRevision === "string" && /^[a-f0-9]{64}$/.test(v.baseRevision)))
  );
}

type SaveResult =
  | { ok: true; count: number; revision?: string }
  | { ok: false; error: string; conflict?: boolean };

/**
 * Save one cut's lettering through the project write path: under the
 * project's lock (so concurrent saves read the latest episode), with an undo
 * snapshot, a journal entry and a live event. Returns the save result and the
 * recorded change (null when nothing changed).
 */
export async function saveCutLetteringChange(
  root: string,
  payload: CutLetteringPayload,
  info: ActorInfo = {},
): Promise<{ result: SaveResult; change: ProjectChange | null }> {
  const { episodeId, cutId } = payload;
  if (!isPathSafeId(episodeId)) {
    return { result: { ok: false, error: `unknown episode "${episodeId}"` }, change: null };
  }
  return withProjectWrite(
    contextFor(root, { workId: payload.workId, ...info }),
    {
      summary: "Updated lettering",
      scopes: [{ kind: "lettering", episodeId, cutId }],
      files: [episodeFiles(episodeId).lettering],
      errors: "as-is",
    },
    async (tx) => {
      tx.setSummary(`Updated lettering on ${cutLabel(tx.before, episodeId, cutId)}`);
      return mergeAndWrite(tx.root, payload, tx.before);
    },
  );
}

/** Save one cut's lettering. See `saveCutLetteringChange`. */
export async function saveCutLettering(
  root: string,
  payload: CutLetteringPayload,
  info: ActorInfo = {},
): Promise<SaveResult> {
  return (await saveCutLetteringChange(root, payload, info)).result;
}

async function mergeAndWrite(
  root: string,
  payload: CutLetteringPayload,
  loaded: LoadedProject,
): Promise<SaveResult> {
  const { episodeId, cutId, overlays } = payload;
  const bundleIndex = loaded.project.episodes.findIndex((b) => b.episode.id === episodeId);
  const bundle = loaded.project.episodes[bundleIndex];
  if (!bundle) return { ok: false, error: `unknown episode "${episodeId}"` };
  if (!bundle.cuts.some((cut) => cut.id === cutId)) {
    return { ok: false, error: `unknown cut "${cutId}"` };
  }
  if (
    payload.baseRevision !== undefined &&
    payload.baseRevision !== cutLetteringRevision(bundle.lettering.filter((b) => b.cutId === cutId))
  )
    return {
      ok: false,
      conflict: true,
      error:
        "This cut's lettering changed after you opened it. Your edits are still here. Copy them before reloading the saved version.",
    };
  if (
    overlays.some(
      (overlay) => typeof overlay !== "object" || overlay === null || overlay.cutId !== cutId,
    )
  ) {
    return { ok: false, error: "every overlay must belong to the edited cut" };
  }

  const lettering = [...bundle.lettering.filter((overlay) => overlay.cutId !== cutId), ...overlays];
  const candidate: Project = {
    ...loaded.project,
    episodes: loaded.project.episodes.map((b, index) =>
      index === bundleIndex ? { ...b, lettering } : b,
    ),
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const detail = result.issues.filter((issue) =>
      issue.path.startsWith(`episodes[${bundleIndex}].lettering`),
    );
    const issues = detail.length > 0 ? detail : result.issues;
    return {
      ok: false,
      error: `invalid project after lettering edit: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  await writeLettering(root, episodeId, lettering);
  return {
    ok: true,
    count: overlays.length,
    ...(payload.baseRevision !== undefined ? { revision: cutLetteringRevision(overlays) } : {}),
  };
}
