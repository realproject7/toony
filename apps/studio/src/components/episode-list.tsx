// Navigable episode list shared by the per-work dashboard and the episodes
// route. Each row links into the episode editor (scoped to its work) and shows
// cut/transition counts plus a compact production status.

import Link from "next/link";
import type { EpisodeOverview } from "@/lib/project";
import { StatusChip } from "./status-chip";
import { StudioIcon } from "./studio-icon";

export function EpisodeList({ workId, episodes }: { workId: string; episodes: EpisodeOverview[] }) {
  if (episodes.length === 0) {
    return (
      <p className="empty">
        No episodes yet. Plan your first episode with your agent. Authored episodes will appear
        here.
      </p>
    );
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
            <div className="episode-row-meta">
              <StatusChip status={episode.status} />
              <div className="episode-row-counts">
                <span data-testid={`episode-review-${episode.id}`}>
                  <b>
                    {episode.finalCutCount} / {episode.cutCount}
                  </b>{" "}
                  {episode.cutCount === 1 ? "cut final" : "cuts final"}
                </span>
                <span>
                  <b>{episode.cutCount}</b> {episode.cutCount === 1 ? "cut" : "cuts"}
                </span>
                <span>
                  <b>{episode.transitionCount}</b>{" "}
                  {episode.transitionCount === 1 ? "transition" : "transitions"}
                </span>
                <span>
                  <b>{episode.letteringCount}</b>{" "}
                  {episode.letteringCount === 1 ? "bubble" : "bubbles"}
                </span>
              </div>
            </div>
            <span className="episode-row-go" aria-hidden="true">
              Open editor <StudioIcon name="arrow" />
            </span>
          </Link>
          <div className="episode-row-actions">
            {/* Preview remains separate from the default editor entry. */}
            <Link
              href={`${base}/episodes/${encodeURIComponent(episode.id)}/read`}
              className="episode-row-read"
              data-testid={`episode-read-${episode.id}`}
            >
              <StudioIcon name="eye" /> Preview
            </Link>
            <Link
              href={`${base}/episodes/${encodeURIComponent(episode.id)}/script`}
              className="episode-row-read"
              data-testid={`episode-script-${episode.id}`}
            >
              <StudioIcon name="text" /> Script
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
