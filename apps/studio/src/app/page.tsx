// Minimal real overview page proving the project loads server-side.
//
// Scope: issue #5 owns this load proof. The full Production Scroll dashboard,
// episode preview, and Open Design styling are issue #6 — intentionally not
// built here.

import {
  loadSelectedProject,
  ProjectLoadError,
  projectDir,
  summarizeEpisodes,
} from "@/lib/project";

// The project is read from disk per request, so this page must not be cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let loaded: Awaited<ReturnType<typeof loadSelectedProject>>;
  try {
    loaded = await loadSelectedProject();
  } catch (cause) {
    const reason = cause instanceof ProjectLoadError ? cause.message : String(cause);
    return (
      <main data-testid="studio-load-error">
        <h1>Toony Studio</h1>
        <p>Could not load the selected project.</p>
        <pre>{reason}</pre>
      </main>
    );
  }

  const { project, validation } = loaded;
  const { languages } = project.webtoon;
  const episodes = summarizeEpisodes(loaded);

  return (
    <main data-testid="studio-overview">
      <h1 data-testid="project-title">{project.webtoon.title}</h1>
      <p>
        project id: <code>{project.webtoon.projectId}</code> · directory:{" "}
        <code>{projectDir()}</code>
      </p>
      <p data-testid="validation-status">
        {validation.valid
          ? "validation: valid"
          : `validation: ${validation.issues.length} issue(s)`}
      </p>

      <section>
        <h2>Language</h2>
        <ul>
          <li>default: {languages.defaultLanguage}</li>
          <li>supported: {languages.supportedLanguages.join(", ")}</li>
          <li>dialogue: {languages.dialogueLanguage}</li>
          <li>prompt: {languages.promptLanguage}</li>
        </ul>
      </section>

      <section>
        <h2>Episodes ({episodes.length})</h2>
        <ul data-testid="episode-list">
          {episodes.map((episode) => (
            <li key={episode.id} data-testid={`episode-${episode.id}`}>
              <strong>{episode.id}</strong> — {episode.title} · {episode.cutCount} cut(s),{" "}
              {episode.transitionCount} transition(s)
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
