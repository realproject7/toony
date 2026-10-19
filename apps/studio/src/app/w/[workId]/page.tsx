// Per-work dashboard (issue #51) — the working home for one webtoon.
//
// Project identity, language config, project health, and the episode list as
// navigable rows, all scoped to the work resolved from `<workId>`. The work id is
// resolved PATH-SAFELY by `resolveWork` (exact match against the workspace scan)
// before any project file is read. No wallet/account/publish surfaces.

import Link from "next/link";
import { notFound } from "next/navigation";
import { AskAgent } from "@/components/ask-agent";
import { BriefCard } from "@/components/brief-card";
import { EpisodeList } from "@/components/episode-list";
import { LoadError } from "@/components/load-error";
import { loadWork, overviewEpisodes, ProjectIoError } from "@/lib/project";
import { loadBriefView } from "@/lib/script-view";
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
  const { languages } = webtoon;
  const episodes = overviewEpisodes(loaded);
  const briefView = await loadBriefView(work.root);
  const characters = webtoon.characters ?? [];

  const totalCuts = episodes.reduce((sum, ep) => sum + ep.cutCount, 0);

  return (
    <div data-testid="studio-dashboard">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Story</p>
          <h1 className="page-title" data-testid="project-title">
            {webtoon.title}
          </h1>
          <div className="page-meta">
            <span>
              {episodes.length} {episodes.length === 1 ? "episode" : "episodes"} · {totalCuts} cuts
              · {characters.length} characters
            </span>
            <span data-testid="validation-status">
              {validation.valid ? null : (
                <span className="chip chip-danger">{validation.issues.length} issue(s)</span>
              )}
            </span>
          </div>
        </div>
        <div className="editor-actions">
          <AskAgent message="Help me develop this story. Start with the central conflict and the character motivations.">
            Develop with agent
          </AskAgent>
          <Link href="/" className="btn btn-ghost" data-testid="back-to-library">
            &larr; Library
          </Link>
        </div>
      </header>

      <div className="story-overview">
        <Link href={`/w/${encodeURIComponent(work.id)}/characters`} data-testid="character-count">
          <span>Cast</span>
          <strong>{characters.length} characters</strong>
          <small data-testid="character-references">
            {characters.filter((c) => (c.references?.length ?? 0) > 0).length} with reference sheets
          </small>
        </Link>
        <Link href={`/w/${encodeURIComponent(work.id)}/episodes`}>
          <span>Episodes</span>
          <strong>{episodes.length} in this story</strong>
          <small>{totalCuts} cuts to shape and letter</small>
        </Link>
        <div>
          <span>Dialogue</span>
          <strong>{languages.dialogueLanguage}</strong>
          <small>Your words, in every scene</small>
        </div>
      </div>

      <section className="card-grid" data-testid="brief-section">
        <BriefCard
          brief={briefView.brief}
          unreadable={briefView.unreadable}
          characters={webtoon.characters ?? []}
        />
      </section>

      <section>
        <h2 className="section-title">Episodes</h2>
        <EpisodeList workId={work.id} episodes={episodes} />
      </section>
    </div>
  );
}
