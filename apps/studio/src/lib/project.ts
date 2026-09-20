// Server-side per-work view-model helpers for the studio app.
//
// A "work" is one Toony project directory inside the workspace. Every helper here
// takes an explicit `workRoot` (an absolute directory resolved path-safely by
// `@/lib/workspace`) and derives view-model shapes from the already-loaded,
// validated project. All on-disk IO and YAML/JSON parsing lives in
// `@toony/project-io`; this module never reads `process.env` and never joins raw
// user input into a path — route handlers resolve the work root first, then pass
// it here. This keeps the project-scoped routes (`/w/<id>/...`, issue #51) and
// the write/asset APIs reading the same code.

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { readImageDimensions } from "@toony/lint";
import {
  type EpisodeSummary,
  type LoadedProject,
  loadProject,
  ProjectIoError,
  summarizeEpisodes,
  writeCuts,
} from "@toony/project-io";
import { cutHeightAt, FALLBACK_CUT_ASPECT, resolveCutAspect } from "@toony/render";
import {
  type Cut,
  type EpisodeBundle,
  type LetteringOverlay,
  REVIEW_STATUSES,
  type ReviewStatus,
  type Transition,
} from "@toony/schema";

export type { EpisodeSummary, LoadedProject };
export { ProjectIoError, summarizeEpisodes };

/** Load and validate one work's project from its absolute root directory. */
export async function loadWork(workRoot: string): Promise<LoadedProject> {
  return loadProject(workRoot);
}

/** Coarse production status for one episode, derived from loaded data. */
export type EpisodeStatus = "invalid" | "draft" | "in-progress" | "lettered";

/** An episode summary plus its derived production status and overlay count. */
export interface EpisodeOverview extends EpisodeSummary {
  status: EpisodeStatus;
  letteringCount: number;
  finalCutCount: number;
}

/**
 * Whether any validation issue is scoped to a given episode index. Issue paths
 * from `@toony/schema` are dotted/indexed, e.g. `episodes[2].cuts[0].id`.
 */
function episodeHasIssues(loaded: LoadedProject, index: number): boolean {
  const prefix = `episodes[${index}]`;
  return loaded.validation.issues.some((issue) => issue.path.startsWith(prefix));
}

/** Derive a coarse status for one episode bundle. */
function deriveStatus(bundle: EpisodeBundle, hasIssues: boolean): EpisodeStatus {
  if (hasIssues) return "invalid";
  if (bundle.lettering.length > 0) return "lettered";
  const hasArt = bundle.cuts.some((cut) => cut.image?.clean || cut.image?.final);
  return hasArt ? "in-progress" : "draft";
}

/** Episode overviews for the dashboard and episode list, in reading order. */
export function overviewEpisodes(loaded: LoadedProject): EpisodeOverview[] {
  const summaries = summarizeEpisodes(loaded);
  return loaded.project.episodes.map((bundle, index) => {
    const summary = summaries[index];
    const hasIssues = episodeHasIssues(loaded, index);
    return {
      id: summary?.id ?? bundle.episode.id,
      title: summary?.title ?? bundle.episode.title,
      cutCount: summary?.cutCount ?? bundle.cuts.length,
      transitionCount: summary?.transitionCount ?? bundle.transitions.length,
      letteringCount: bundle.lettering.length,
      finalCutCount: bundle.cuts.filter((cut) => cut.reviewStatus === "final").length,
      status: deriveStatus(bundle, hasIssues),
    };
  });
}

/**
 * Resolve a project-relative asset path to an absolute path INSIDE the given
 * work directory, or null when the input is unsafe. Rejects absolute paths and
 * any `..` traversal that would escape the work root, so the asset route (which
 * streams file bytes) can never read outside the work tree. The work root itself
 * is resolved path-safely upstream against the workspace scan.
 */
export function resolveWorkAsset(workRoot: string, relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  if (isAbsolute(relPath) || relPath.includes("\0")) return null;
  const root = resolve(workRoot);
  const target = resolve(root, normalize(relPath));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/**
 * The studio URL that serves a project-relative asset for a given work, or null
 * when the path is unsafe. Used by the preview/editors to point an `<img>`/SVG
 * image at a cut's art without copying it into `public/`. The `workId` scopes the
 * request so `/api/asset` resolves it inside the right work directory.
 */
export function assetUrl(
  workId: string,
  workRoot: string,
  relPath: string | null | undefined,
): string | null {
  if (!relPath) return null;
  if (resolveWorkAsset(workRoot, relPath) === null) return null;
  return `/api/asset?work=${encodeURIComponent(workId)}&path=${encodeURIComponent(relPath)}`;
}

/** Find a single episode bundle by id within the loaded project. */
export function findEpisodeBundle(
  loaded: LoadedProject,
  episodeId: string,
): EpisodeBundle | undefined {
  return loaded.project.episodes.find((bundle) => bundle.episode.id === episodeId);
}

/**
 * The resolved render inputs a cut needs in the preview: a safe asset URL for
 * its art and the art's natural pixel dimensions (so the SVG overlay viewBox and
 * the geometry core lay out at the true aspect ratio). `null` art with `null`
 * dimensions means there is no displayable image yet.
 */
export interface CutArt {
  src: string | null;
  width: number;
  height: number;
}

/** Nominal natural width of the default page frame. Only the RATIO reaches the
 *  render, so this is free to be any round number. */
const FALLBACK_ART_WIDTH = 1000;

/** Default stage for a cut whose art hasn't resolved AND which declares no shape
 *  of its own (#154). The ratio is the render core's, not the studio's, so the
 *  stage a reader sees for an art-less cut is the shape the export raster gives
 *  it (#211). */
export const FALLBACK_ART: CutArt = {
  src: null,
  width: FALLBACK_ART_WIDTH,
  height: cutHeightAt(FALLBACK_ART_WIDTH, FALLBACK_CUT_ASPECT),
};

/**
 * The stage for a cut with no usable art: the shape the cut DECLARES
 * (`panelAspect`, #237), else `FALLBACK_ART`'s. The export raster stages the
 * same cut through the same resolver (#260), so the two still show one shape —
 * which is the whole point of #211, and would have been silently lost had only
 * the export learned to read the declaration back.
 */
function artlessStage(cut: Cut, src: string | null): CutArt {
  const { aspect } = resolveCutAspect(cut.panelAspect, null);
  return { src, width: FALLBACK_ART_WIDTH, height: cutHeightAt(FALLBACK_ART_WIDTH, aspect) };
}

/**
 * Resolve a cut's art for the preview: prefer the final image, then the clean
 * image. Reads the image header (no full decode) to get natural dimensions; on
 * any IO/parse failure the cut still renders bubbles over its art-less stage
 * rather than throwing, keeping the sequence readable.
 */
export async function resolveCutArt(workId: string, workRoot: string, cut: Cut): Promise<CutArt> {
  const rel = cut.image?.final ?? cut.image?.clean ?? null;
  const src = assetUrl(workId, workRoot, rel);
  if (!rel || !src) return artlessStage(cut, null);
  const absolute = resolveWorkAsset(workRoot, rel);
  if (absolute === null) return artlessStage(cut, null);
  try {
    const bytes = await readFile(absolute);
    const dims = readImageDimensions(new Uint8Array(bytes));
    if (!dims || dims.width <= 0 || dims.height <= 0) return artlessStage(cut, src);
    return { src, width: dims.width, height: dims.height };
  } catch {
    return artlessStage(cut, src);
  }
}

/**
 * The render inputs both episode routes (preview + reader) build from one loaded
 * bundle: id→record lookups for the sequence walk, bubbles grouped by cut, and
 * each cut's art resolved once in parallel (so the synchronous sequence render
 * can place bubbles at the true aspect ratio). Extracted so the two routes cannot
 * drift in how they shape a sequence for rendering (#158).
 */
export interface EpisodeRenderInputs {
  cutById: Map<string, Cut>;
  transitionById: Map<string, Transition>;
  bubblesByCut: Map<string, LetteringOverlay[]>;
  artByCut: Map<string, CutArt>;
}

export async function resolveEpisodeRenderInputs(
  bundle: EpisodeBundle,
  workId: string,
  workRoot: string,
): Promise<EpisodeRenderInputs> {
  const { cuts, transitions, lettering } = bundle;
  const cutById = new Map(cuts.map((cut) => [cut.id, cut]));
  const transitionById = new Map(transitions.map((tr) => [tr.id, tr]));
  const bubblesByCut = new Map<string, LetteringOverlay[]>();
  for (const overlay of lettering) {
    const list = bubblesByCut.get(overlay.cutId) ?? [];
    list.push(overlay);
    bubblesByCut.set(overlay.cutId, list);
  }
  const artEntries = await Promise.all(
    cuts.map(async (cut) => [cut.id, await resolveCutArt(workId, workRoot, cut)] as const),
  );
  const artByCut = new Map<string, CutArt>(artEntries);
  return { cutById, transitionById, bubblesByCut, artByCut };
}

// Artwork review: content identity, progress, and narrow persistence (#239).

export interface CutReviewPayload {
  workId: string;
  episodeId: string;
  cutId: string;
  reviewStatus: ReviewStatus;
  artworkRevision: string;
}

export function isCutReviewPayload(value: unknown): value is CutReviewPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    typeof v.cutId === "string" &&
    typeof v.artworkRevision === "string" &&
    /^[a-f0-9]{64}$/.test(v.artworkRevision) &&
    REVIEW_STATUSES.some((status) => status === v.reviewStatus)
  );
}

/** Read only assets the local asset route may serve, including its realpath guard. */
async function readArtwork(root: string, path: string | null) {
  const absolute = path === null ? null : resolveWorkAsset(root, path);
  if (absolute === null) return { path, bytes: null, digest: null };
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(absolute)]);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return { path, bytes: null, digest: null };
    }
    const bytes = await readFile(realTarget);
    return { path, bytes, digest: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return { path, bytes: null, digest: null };
  }
}

async function artworkSnapshot(root: string, cut: Cut) {
  const assets = await Promise.all([
    readArtwork(root, cut.image?.clean ?? null),
    readArtwork(root, cut.image?.final ?? null),
  ]);
  const revision = createHash("sha256")
    .update(JSON.stringify(assets.map(({ path, digest }) => ({ path, digest }))))
    .digest("hex");
  return { revision, visible: assets[cut.image?.final ? 1 : 0] };
}

/**
 * Bind the editor's review token and image URL to the same bytes. The asset
 * route checks the URL's digest, so an intervening same-path replacement cannot
 * silently display different artwork under the review token issued here.
 */
export async function resolveCutReviewArtwork(
  workId: string,
  root: string,
  cut: Cut,
): Promise<{ art: CutArt; artworkRevision: string }> {
  const { revision, visible } = await artworkSnapshot(root, cut);
  const fallback = await resolveCutArt(workId, root, { ...cut, image: null });
  const url = assetUrl(workId, root, visible?.path ?? null);
  if (!url || !visible?.bytes || !visible.digest) {
    return { art: fallback, artworkRevision: revision };
  }
  const dimensions = readImageDimensions(visible.bytes);
  return {
    art: {
      ...fallback,
      ...(dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions : {}),
      src: `${url}&revision=${visible.digest}`,
    },
    artworkRevision: revision,
  };
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
): Promise<{ ok: true } | { ok: false; error: string; conflict?: boolean }> {
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes.find((b) => b.episode.id === payload.episodeId);
  if (!bundle) return { ok: false, error: `unknown episode "${payload.episodeId}"` };
  const cut = bundle.cuts.find((c) => c.id === payload.cutId);
  if (!cut) return { ok: false, error: `unknown cut "${payload.cutId}"` };
  if ((await artworkSnapshot(root, cut)).revision !== payload.artworkRevision) {
    return {
      ok: false,
      conflict: true,
      error: "Artwork changed. Save any lettering edits, then reload before reviewing this cut.",
    };
  }
  await writeCuts(
    root,
    bundle.episode.id,
    bundle.cuts.map((c) => (c.id === cut.id ? { ...c, reviewStatus: payload.reviewStatus } : c)),
  );
  return { ok: true };
}
