// Workspace library — the studio's new home (issue #51).
//
// Opens over the WORKSPACE root and lists every work as a card (cover thumbnail,
// title, episode/cut counts, last edited). Picking a card enters that work's
// dashboard at `/w/<id>`. A "New webtoon" action scaffolds a fresh work into the
// workspace. Real data comes from `listWorks` (the project-io workspace scan) via
// the server-only `@/lib/workspace` wrapper; no wallet/account/publish surfaces —
// this is a production tool.

import Link from "next/link";
import { NewWorkButton } from "@/components/new-work-button";
import { listWorks } from "@/lib/workspace";

// The workspace is scanned from disk per request, so this page must not be cached.
export const dynamic = "force-dynamic";

/** A project-relative cover path becomes a scoped, path-safe asset URL. */
function coverUrl(workId: string, coverImagePath: string | null): string | null {
  if (!coverImagePath) return null;
  return `/api/asset?work=${encodeURIComponent(workId)}&path=${encodeURIComponent(coverImagePath)}`;
}

/** Human-readable "last edited" from an ISO timestamp (date only, locale-free). */
function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
}

export default async function LibraryPage() {
  const works = await listWorks();
  const totalEpisodes = works.reduce((sum, work) => sum + work.episodeCount, 0);
  const totalCuts = works.reduce((sum, work) => sum + work.cutCount, 0);

  return (
    <div data-testid="studio-library">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Workspace</p>
          <h1 className="page-title">Library</h1>
          <div className="page-meta">
            <span>
              <b>{works.length}</b> work{works.length === 1 ? "" : "s"}
            </span>
            <span>
              <b>{totalEpisodes}</b> episodes
            </span>
            <span>
              <b>{totalCuts}</b> cuts
            </span>
          </div>
        </div>
        <div className="editor-actions">
          <NewWorkButton />
        </div>
      </header>

      {works.length === 0 ? (
        <section className="notice" data-testid="library-empty">
          <h2 className="card-title">No works yet</h2>
          <p className="page-meta">
            This workspace has no webtoons. Create one to begin — it scaffolds a valid project
            folder in the workspace and opens its dashboard.
          </p>
          <p>
            <NewWorkButton />
          </p>
        </section>
      ) : (
        <ul className="work-grid" data-testid="work-grid">
          {works.map((work) => {
            const cover = coverUrl(work.id, work.coverImagePath);
            return (
              <li key={work.id}>
                <Link
                  href={`/w/${encodeURIComponent(work.id)}`}
                  className="work-card"
                  data-testid={`work-${work.id}`}
                >
                  <div className="work-cover" data-has-cover={cover ? "true" : "false"}>
                    {cover ? (
                      // biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer.
                      <img className="work-cover-img" src={cover} alt={`Cover for ${work.title}`} />
                    ) : (
                      <span className="work-cover-empty" aria-hidden="true">
                        {work.title.slice(0, 1).toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
                  <div className="work-card-body">
                    <p className="work-card-title">{work.title}</p>
                    <p className="work-card-id">
                      <code>{work.id}</code>
                    </p>
                    <div className="work-card-counts">
                      <span>
                        <b>{work.episodeCount}</b> ep
                      </span>
                      <span>
                        <b>{work.cutCount}</b> cuts
                      </span>
                      <span className="work-card-updated">{formatUpdated(work.updatedAt)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
