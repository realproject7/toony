// Episode list route. The full, navigable list of episodes in reading order;
// each row links into the episode preview.

import { EpisodeList } from "@/components/episode-list";
import { LoadError } from "@/components/load-error";
import { loadSelectedProject, overviewEpisodes, ProjectIoError } from "@/lib/project";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  let loaded: Awaited<ReturnType<typeof loadSelectedProject>>;
  try {
    loaded = await loadSelectedProject();
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const episodes = overviewEpisodes(loaded);

  return (
    <div data-testid="studio-episodes">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">Episodes</h1>
        </div>
        <div className="page-meta">
          <span>
            <b>{episodes.length}</b> in this project
          </span>
        </div>
      </header>
      <EpisodeList episodes={episodes} />
    </div>
  );
}
