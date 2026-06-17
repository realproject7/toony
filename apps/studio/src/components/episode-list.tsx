// Navigable episode list shared by the per-work dashboard and the episodes
// route. Each row links into the episode preview (scoped to its work) and shows
// cut/transition counts plus a compact production status.

import Link from "next/link";
import type { EpisodeOverview } from "@/lib/project";
import { StatusChip } from "./status-chip";

export function EpisodeList({ workId, episodes }: { workId: string; episodes: EpisodeOverview[] }) {
  if (episodes.length === 0) {
    return <p className="empty">No episodes yet. Create one with the Toony CLI to begin.</p>;
  }
  const base = `/w/${encodeURIComponent(workId)}`;
  return (
    <ul className="episode-rows" data-testid="episode-list">
      {episodes.map((episode) => (
        <li key={episode.id} className="episode-row-wrap">
          <Link
            href={`${base}/episodes/${encodeURIComponent(episode.id)}`}
            className="episode-row"
            data-testid={`episode-${episode.id}`}
          >
            <div className="episode-row-main">
              <span className="episode-row-id">{episode.id}</span>
              <p className="episode-row-title">{episode.title}</p>
            </div>
            <StatusChip status={episode.status} />
            <div className="episode-row-counts">
              <span>
                <b>{episode.cutCount}</b> cuts
              </span>
              <span>
                <b>{episode.transitionCount}</b> transitions
              </span>
              <span>
                <b>{episode.letteringCount}</b> bubbles
              </span>
            </div>
            <span className="episode-row-go" aria-hidden="true">
              Open &rarr;
            </span>
          </Link>
          {/* A direct entry into the distraction-free reader (#49), separate from
              the row's Open link so a reader can preview without the edit chrome. */}
          <Link
            href={`${base}/episodes/${encodeURIComponent(episode.id)}/read`}
            className="episode-row-read"
            data-testid={`episode-read-${episode.id}`}
          >
            Read
          </Link>
        </li>
      ))}
    </ul>
  );
}
