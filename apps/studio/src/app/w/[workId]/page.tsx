// Per-work dashboard (issue #51) — the working home for one webtoon.
//
// Project identity, language config, project health, and the episode list as
// navigable rows, all scoped to the work resolved from `<workId>`. The work id is
// resolved PATH-SAFELY by `resolveWork` (exact match against the workspace scan)
// before any project file is read. No wallet/account/publish surfaces.

import Link from "next/link";
import { notFound } from "next/navigation";
import { EpisodeList } from "@/components/episode-list";
import { LoadError } from "@/components/load-error";
import { loadWork, overviewEpisodes, ProjectIoError } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function WorkDashboardPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
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
        <div className="editor-actions">
          <Link href="/" className="btn btn-ghost" data-testid="back-to-library">
            &larr; Library
          </Link>
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
        <EpisodeList workId={work.id} episodes={episodes} />
      </section>
    </div>
  );
}
