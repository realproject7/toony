// Server-side project access for the studio app.
//
// Thin wrapper over `@toony/project-io`'s shared loader so the app (and issue
// #6, which builds the full UI) has a single, server-only entry point for
// reading the selected project. The directory is selected by `toony studio`,
// which sets `TOONY_PROJECT_DIR`.

import {
  type EpisodeSummary,
  type LoadedProject,
  loadProject,
  ProjectIoError,
  summarizeEpisodes,
} from "@toony/project-io";

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
