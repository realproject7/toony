// The library: every webtoon in the workspace as a card (cover, title,
// episodes, last edited), newest first. With no webtoons it is the welcome.

import { join } from "node:path";
import Link from "next/link";
import { ContinueWork } from "@/components/continue-work";
import { LibraryWelcome } from "@/components/library-welcome";
import { LibraryRefresh } from "@/components/live-refresh";
import { NewWorkButton } from "@/components/new-work-button";
import { RouteFocus } from "@/components/work-presence";
import { artEngineStatus } from "@/lib/art/engine";
import { assetUrl } from "@/lib/project";
import { editedLabel } from "@/lib/relative-time";
import { listWorks, workspaceRoot } from "@/lib/workspace";

// The workspace is scanned from disk per request, so this page must not be cached.
export const dynamic = "force-dynamic";
// The root page shares the layout segment, so it names the full title itself.
export const metadata = { title: { absolute: "Library · Toony" } };

export default async function LibraryPage() {
  const works = [...(await listWorks())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const root = workspaceRoot();
  const now = new Date();

  return (
    <div className="page" data-testid="studio-library">
      <RouteFocus route="library" />
      <LibraryRefresh />
      {works.length === 0 ? (
        <LibraryWelcome engine={await artEngineStatus(root)} />
      ) : (
        <>
          <header className="page-head">
            <h1 className="page-title">Library</h1>
            <NewWorkButton />
          </header>
          <ContinueWork works={works.map(({ id, title }) => ({ id, title }))} />
          <ul className="work-grid" data-testid="work-grid">
            {works.map((work) => {
              const cover = assetUrl(work.id, join(root, work.id), work.coverImagePath);
              const edited = editedLabel(work.updatedAt, now);
              return (
                <li key={work.id}>
                  <Link
                    href={`/w/${encodeURIComponent(work.id)}`}
                    className="work-card"
                    data-testid={`work-${work.id}`}
                  >
                    <div className="work-cover" data-has-cover={cover ? "true" : "false"}>
                      {cover ? (
                        // biome-ignore lint/performance/noImgElement: local-first studio serves project files directly.
                        <img className="work-cover-img" src={cover} alt="" />
                      ) : (
                        <span className="work-cover-empty" aria-hidden="true">
                          {Array.from(work.title.trim())[0]?.toUpperCase() ?? "T"}
                        </span>
                      )}
                    </div>
                    <div className="work-card-body">
                      <p className="work-card-title">{work.title}</p>
                      <p className="work-card-meta">
                        {work.episodeCount === 0
                          ? "No episodes yet"
                          : `${work.episodeCount} ${work.episodeCount === 1 ? "episode" : "episodes"}`}
                        {edited && <span> · {edited}</span>}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
