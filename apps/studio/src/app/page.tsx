// Production Scroll dashboard.
//
// The studio's working home: project identity, language config, project health,
// and the episode list as navigable rows. Real data comes from project-io via
// the server-only `@/lib/project` wrapper. No wallet/account/publish/royalty/
// marketplace surfaces — this is a production tool, not a landing page.

import { EpisodeList } from "@/components/episode-list";
import { LoadError } from "@/components/load-error";
import { loadSelectedProject, overviewEpisodes, ProjectIoError } from "@/lib/project";

// The project is read from disk per request, so this page must not be cached.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let loaded: Awaited<ReturnType<typeof loadSelectedProject>>;
  try {
    loaded = await loadSelectedProject();
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const { project, validation } = loaded;
  const { webtoon } = project;
  const { languages, imageProviders } = webtoon;
  const episodes = overviewEpisodes(loaded);

  const totalCuts = episodes.reduce((sum, ep) => sum + ep.cutCount, 0);
  const totalTransitions = episodes.reduce((sum, ep) => sum + ep.transitionCount, 0);
  const totalBubbles = episodes.reduce((sum, ep) => sum + ep.letteringCount, 0);

  return (
    <div data-testid="studio-dashboard">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Project</p>
          <h1 className="page-title" data-testid="project-title">
            {webtoon.title}
          </h1>
          <div className="page-meta">
            <span>
              id <code>{webtoon.projectId}</code>
            </span>
            <span data-testid="validation-status">
              {validation.valid ? (
                <span className="chip chip-ok">Valid</span>
              ) : (
                <span className="chip chip-danger">{validation.issues.length} issue(s)</span>
              )}
            </span>
          </div>
        </div>
      </header>

      <section className="card-grid">
        <article className="card">
          <h2 className="card-title">Language</h2>
          <div className="stat-row">
            <span>Default</span>
            <b>{languages.defaultLanguage}</b>
          </div>
          <div className="stat-row">
            <span>Supported</span>
            <b>{languages.supportedLanguages.join(", ")}</b>
          </div>
          <div className="stat-row">
            <span>Dialogue</span>
            <b>{languages.dialogueLanguage}</b>
          </div>
          <div className="stat-row">
            <span>Prompt</span>
            <b>{languages.promptLanguage}</b>
          </div>
        </article>

        <article className="card">
          <h2 className="card-title">Production</h2>
          <div className="stat-row">
            <span>Episodes</span>
            <b>{episodes.length}</b>
          </div>
          <div className="stat-row">
            <span>Cuts</span>
            <b>{totalCuts}</b>
          </div>
          <div className="stat-row">
            <span>Transitions</span>
            <b>{totalTransitions}</b>
          </div>
          <div className="stat-row">
            <span>Bubbles</span>
            <b>{totalBubbles}</b>
          </div>
        </article>

        <article className="card">
          <h2 className="card-title">Generation</h2>
          <div className="stat-row">
            <span>Default provider</span>
            <b>{imageProviders.defaultProvider}</b>
          </div>
          <div className="stat-row">
            <span>Configured</span>
            <b>{imageProviders.providers.length}</b>
          </div>
          <div className="stat-row">
            <span>Schema version</span>
            <b>{webtoon.schemaVersion}</b>
          </div>
        </article>
      </section>

      <section>
        <h2 className="section-title">Episodes</h2>
        <EpisodeList episodes={episodes} />
      </section>
    </div>
  );
}
