// Navigable episode list shared by the dashboard and the episodes route. Each
// row links into the episode preview and shows cut/transition counts plus a
// compact production status.

import Link from "next/link";
import type { EpisodeOverview } from "@/lib/project";
import { StatusChip } from "./status-chip";

export function EpisodeList({ episodes }: { episodes: EpisodeOverview[] }) {
  if (episodes.length === 0) {
    return <p className="empty">No episodes yet. Create one with the Toony CLI to begin.</p>;
  }
  return (
    <ul className="episode-rows" data-testid="episode-list">
      {episodes.map((episode) => (
        <li key={episode.id}>
          <Link
            href={`/episodes/${encodeURIComponent(episode.id)}`}
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
        </li>
      ))}
    </ul>
  );
}
