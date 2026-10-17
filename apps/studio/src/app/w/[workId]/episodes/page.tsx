// Per-work episode list route. The full, navigable list of episodes in reading
// order for one work; each row links into that work's episode preview.

import Link from "next/link";
import { notFound } from "next/navigation";
import { EpisodeList } from "@/components/episode-list";
import { LoadError } from "@/components/load-error";
import { loadWork, overviewEpisodes, ProjectIoError } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function EpisodesPage({ params }: { params: Promise<{ workId: string }> }) {
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

  const episodes = overviewEpisodes(loaded);

  return (
    <div data-testid="studio-episodes">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">Episodes</h1>
        </div>
        <div className="page-meta">
          <Link href={`/w/${encodeURIComponent(work.id)}`} className="inspector-back">
            &larr; Dashboard
          </Link>
          <span>
            <b>{episodes.length}</b> in this project
          </span>
        </div>
      </header>
      <EpisodeList workId={work.id} episodes={episodes} />
    </div>
  );
}
