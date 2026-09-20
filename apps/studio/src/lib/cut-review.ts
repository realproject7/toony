import { loadProject, writeCuts } from "@toony/project-io";
import { type Cut, REVIEW_STATUSES, type ReviewStatus } from "@toony/schema";

export interface CutReviewPayload {
  workId: string;
  episodeId: string;
  cutId: string;
  reviewStatus: ReviewStatus;
}

export function isCutReviewPayload(value: unknown): value is CutReviewPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    typeof v.cutId === "string" &&
    REVIEW_STATUSES.some((status) => status === v.reviewStatus)
  );
}

export function cutReviewCounts(cuts: readonly Cut[]): Record<ReviewStatus, number> {
  const counts = { draft: 0, "human-edited": 0, final: 0 };
  for (const cut of cuts) counts[cut.reviewStatus ?? "draft"] += 1;
  return counts;
}

/**
 * Apply only the review field to the current on-disk cuts. The browser never
 * supplies cut records, so metadata edited since the page loaded is preserved.
 * Lettering has its own file and save guard and is never part of this write.
 */
export async function saveCutReview(
  root: string,
  payload: CutReviewPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes.find((b) => b.episode.id === payload.episodeId);
  if (!bundle) return { ok: false, error: `unknown episode "${payload.episodeId}"` };
  const cut = bundle.cuts.find((c) => c.id === payload.cutId);
  if (!cut) return { ok: false, error: `unknown cut "${payload.cutId}"` };
  await writeCuts(
    root,
    bundle.episode.id,
    bundle.cuts.map((c) => (c.id === cut.id ? { ...c, reviewStatus: payload.reviewStatus } : c)),
  );
  return { ok: true };
}
