// Server-side project access for the studio app.
//
// Thin wrapper over `@toony/project-io`'s shared loader so the app has a single,
// server-only entry point for reading the selected project. The directory is
// selected by `toony studio`, which sets `TOONY_PROJECT_DIR`. All on-disk IO and
// YAML/JSON parsing lives in project-io; this module only derives view-model
// shapes from the already-loaded, validated project.

import {
  type EpisodeSummary,
  type LoadedProject,
  loadProject,
  ProjectIoError,
  summarizeEpisodes,
} from "@toony/project-io";
import type { EpisodeBundle } from "@toony/schema";

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

/** Find a single episode bundle by id within the loaded project. */
export function findEpisodeBundle(
  loaded: LoadedProject,
  episodeId: string,
): EpisodeBundle | undefined {
  return loaded.project.episodes.find((bundle) => bundle.episode.id === episodeId);
}
