// Server-side project access for the studio app.
//
// Thin wrapper over `@toony/project-io`'s shared loader so the app has a single,
// server-only entry point for reading the selected project. The directory is
// selected by `toony studio`, which sets `TOONY_PROJECT_DIR`. All on-disk IO and
// YAML/JSON parsing lives in project-io; this module only derives view-model
// shapes from the already-loaded, validated project.

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { readImageDimensions } from "@toony/lint";
import {
  type EpisodeSummary,
  type LoadedProject,
  loadProject,
  ProjectIoError,
  summarizeEpisodes,
} from "@toony/project-io";
import type { Cut, EpisodeBundle } from "@toony/schema";

export type { EpisodeSummary, LoadedProject };
export { ProjectIoError, summarizeEpisodes };

/** The project directory chosen by `toony studio`, or the process cwd. */
export function projectDir(): string {
  return process.env.TOONY_PROJECT_DIR ?? process.cwd();
}

/** Load the selected project from disk and validate it. */
export async function loadSelectedProject(): Promise<LoadedProject> {
  return loadProject(projectDir());
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
 * Resolve a project-relative asset path to an absolute path INSIDE the selected
 * project directory, or null when the input is unsafe. Rejects absolute paths
 * and any `..` traversal that would escape the project root, so the asset route
 * (which streams file bytes) can never read outside the project tree. This is
 * the local-first analog of plotlink-ows's path-traversal-safe asset validation,
 * stripped of its server/auth coupling.
 */
export function resolveProjectAsset(relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  if (isAbsolute(relPath) || relPath.includes("\0")) return null;
  const root = resolve(projectDir());
  const target = resolve(root, normalize(relPath));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/**
 * The studio URL that serves a project-relative asset, or null when the path is
 * unsafe. Used by the preview to point an `<img>`/SVG image at a cut's art
 * without copying it into `public/`.
 */
export function assetUrl(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  if (resolveProjectAsset(relPath) === null) return null;
  return `/api/asset?path=${encodeURIComponent(relPath)}`;
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
export async function resolveCutArt(cut: Cut): Promise<CutArt> {
  const rel = cut.image?.final ?? cut.image?.clean ?? null;
  const src = assetUrl(rel);
  if (!rel || !src) return FALLBACK_ART;
  const absolute = resolveProjectAsset(rel);
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
