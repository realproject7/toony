// Server-side project access for the studio app.
//
// Thin wrapper over `@toony/cli`'s shared `loadProject` so the app (and issue
// #6, which builds the full UI) has a single, server-only entry point for
// reading the selected project. The directory is selected by `toony studio`,
// which sets `TOONY_PROJECT_DIR`.

import { type LoadedProject, loadProject, ProjectLoadError } from "@toony/cli";

export type { LoadedProject };
export { ProjectLoadError };

/** The project directory chosen by `toony studio`, or the process cwd. */
export function projectDir(): string {
  return process.env.TOONY_PROJECT_DIR ?? process.cwd();
}

/** Per-episode counts derived from a loaded project, for the overview UI. */
export interface EpisodeSummary {
  id: string;
  title: string;
  cutCount: number;
  transitionCount: number;
}

/** Load the selected project from disk and validate it. */
export async function loadSelectedProject(): Promise<LoadedProject> {
  return loadProject(projectDir());
}

/** Reduce a loaded project's episodes to id/title/cut/transition counts. */
export function summarizeEpisodes(loaded: LoadedProject): EpisodeSummary[] {
  return loaded.project.episodes.map((bundle) => ({
    id: bundle.episode.id,
    title: bundle.episode.title,
    cutCount: bundle.cuts.length,
    transitionCount: bundle.transitions.length,
  }));
}
