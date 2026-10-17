import { realpath } from "node:fs/promises";
import { loadProject, writeLettering } from "@toony/project-io";
import { type LetteringOverlay, type Project, validateProject } from "@toony/schema";

export interface CutLetteringPayload {
  workId: string;
  episodeId: string;
  cutId: string;
  overlays: LetteringOverlay[];
}

export function isCutLetteringPayload(value: unknown): value is CutLetteringPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    typeof v.cutId === "string" &&
    v.cutId.length > 0 &&
    Array.isArray(v.overlays)
  );
}

type SaveResult = { ok: true; count: number } | { ok: false; error: string };

// Serialize read/merge/write within this Studio process, including empty saves.
// External CLI/Studio processes still require the project's single-writer rule.
const writes = new Map<string, Promise<void>>();

export async function saveCutLettering(
  root: string,
  payload: CutLetteringPayload,
): Promise<SaveResult> {
  const canonicalRoot = await realpath(root);
  const key = JSON.stringify([canonicalRoot, payload.episodeId]);
  const previous = writes.get(key) ?? Promise.resolve();
  const pending = previous.then(() => mergeAndWrite(canonicalRoot, payload));
  // A failed write must release the queue rather than poison later saves.
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

async function mergeAndWrite(root: string, payload: CutLetteringPayload): Promise<SaveResult> {
  const { episodeId, cutId, overlays } = payload;
  const loaded = await loadProject(root);
  const bundleIndex = loaded.project.episodes.findIndex((b) => b.episode.id === episodeId);
  const bundle = loaded.project.episodes[bundleIndex];
  if (!bundle) return { ok: false, error: `unknown episode "${episodeId}"` };
  if (!bundle.cuts.some((cut) => cut.id === cutId)) {
    return { ok: false, error: `unknown cut "${cutId}"` };
  }
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
  return { ok: true, count: overlays.length };
}
