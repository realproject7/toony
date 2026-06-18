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

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import {
  type Finding,
  lintBubbleOverflow,
  lintCharacterRefs,
  lintCraft,
  readImageDimensions,
  sortFindings,
} from "@toony/lint";
import {
  type EpisodeSummary,
  type LoadedProject,
  loadProject,
  ProjectIoError,
  summarizeEpisodes,
} from "@toony/project-io";
import type { Character, Cut, EpisodeBundle } from "@toony/schema";

export type { EpisodeSummary, Finding, LoadedProject };
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

/** Default aspect when an asset is missing or its header cannot be read. */
const FALLBACK_ART: CutArt = { src: null, width: 1000, height: 1414 };

/**
 * Resolve a cut's art for the preview: prefer the final image, then the clean
 * image. Reads the image header (no full decode) to get natural dimensions; on
 * any IO/parse failure the cut still renders bubbles over a default-aspect stage
 * rather than throwing, keeping the sequence readable.
 */
export async function resolveCutArt(workId: string, workRoot: string, cut: Cut): Promise<CutArt> {
  const rel = cut.image?.final ?? cut.image?.clean ?? null;
  const src = assetUrl(workId, workRoot, rel);
  if (!rel || !src) return FALLBACK_ART;
  const absolute = resolveWorkAsset(workRoot, rel);
  if (absolute === null) return FALLBACK_ART;
  try {
    const bytes = await readFile(absolute);
    const dims = readImageDimensions(new Uint8Array(bytes));
    if (!dims || dims.width <= 0 || dims.height <= 0) return { ...FALLBACK_ART, src };
    return { src, width: dims.width, height: dims.height };
  } catch {
    return { ...FALLBACK_ART, src };
  }
}

/**
 * Run every editor-relevant `@toony/lint` over one episode bundle (#102): the
 * pure craft and character-ref lints plus the image-aware overflow lint. Cut art
 * is read only through `resolveWorkAsset` (path-safe), so the resolver can never
 * read outside the work tree; an unreadable/unsafe/missing image simply falls
 * back to the lint's default dimensions. Findings are returned in deterministic
 * order. This is the single place the editor route and the editor page share, so
 * the inline panel and the on-demand refresh produce identical results.
 */
export async function lintEpisodeBundle(
  workRoot: string,
  bundle: EpisodeBundle,
  characters: readonly Character[],
): Promise<Finding[]> {
  const imageBytes = new Map<string, Uint8Array>();
  await Promise.all(
    bundle.cuts.map(async (cut) => {
      const rel = cut.image?.final ?? cut.image?.clean ?? null;
      if (!rel) return;
      const absolute = resolveWorkAsset(workRoot, rel);
      if (absolute === null) return;
      try {
        imageBytes.set(cut.id, new Uint8Array(await readFile(absolute)));
      } catch {
        // Unreadable art → fall back to default dimensions in the lint.
      }
    }),
  );

  const findings: Finding[] = [
    ...lintCraft(bundle, characters),
    ...lintCharacterRefs(bundle, characters),
    ...lintBubbleOverflow(bundle, (cutId) => imageBytes.get(cutId) ?? null),
  ];
  return sortFindings(findings);
}
