// Per-work, per-episode export route (issue #53).
//
// Surfaces the existing headless export engine (`@toony/export`) in the studio
// UI: choose a target (platform / stitched / PlotLink-ready), set width / format
// / quality, run it, and review the engine's own manifest + constraint results
// and the on-disk output location. Rendering, constraint enforcement, and writes
// all happen in the engine via `/api/export`; this page only resolves the work
// path-safely from `<workId>`, lays out a thumbnail strip for context, and hands
// off to the client `ExportPanel`.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ExportPanel } from "@/components/export-panel";
import { LoadError } from "@/components/load-error";
import { assetUrl, findEpisodeBundle, loadWork, ProjectIoError } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function EpisodeExportPage({
  params,
}: {
  params: Promise<{ workId: string; id: string }>;
}) {
  const { workId, id } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  const episodeId = decodeURIComponent(id);
  const base = `/w/${encodeURIComponent(work.id)}`;
  const editHref = `${base}/episodes/${encodeURIComponent(episodeId)}`;

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const bundle = findEpisodeBundle(loaded, episodeId);
  if (!bundle) notFound();

  const { episode, cuts } = bundle;
  const cutById = new Map(cuts.map((cut) => [cut.id, cut]));

  // Thumbnail strip in reading order, for context while choosing a target.
  const thumbs = episode.sequence
    .filter((item) => item.type === "cut")
    .map((item) => {
      const cut = cutById.get(item.id);
      const rel = cut?.image?.final ?? cut?.image?.clean ?? null;
      return { id: item.id, src: assetUrl(work.id, work.root, rel) };
    });

  const cutCount = thumbs.length;

  return (
    <div data-testid="studio-episode-export">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">Export episode</h1>
          <div className="page-meta">
            <span>{episode.title}</span>
            <span>
              id <code>{episode.id}</code>
            </span>
            <span>
              <b>{cutCount}</b> cut(s)
            </span>
          </div>
        </div>
        <div className="editor-actions">
          <nav className="reader-toggle" aria-label="View mode">
            <Link href={editHref} className="btn btn-ghost" data-testid="back-to-edit-link">
              Edit
            </Link>
            <Link
              href={`${editHref}/read`}
              className="btn btn-ghost"
              data-testid="open-reader-link"
            >
              Read
            </Link>
            <span className="btn btn-primary" aria-current="page" data-testid="export-mode-active">
              Export
            </span>
          </nav>
        </div>
      </header>

      <div className="export-layout">
        <aside className="export-thumbs" aria-label="Cuts in reading order">
          {thumbs.length === 0 && <p className="empty">This episode has no cuts yet.</p>}
          {thumbs.map((thumb, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a cut can recur in the reading sequence, so its id is not unique here; the position is the stable identity.
            <figure className="export-thumb" key={`${index}-${thumb.id}`}>
              {thumb.src ? (
                // biome-ignore lint/performance/noImgElement: local file served by /api/asset, not a web image.
                <img src={thumb.src} alt={`Cut ${thumb.id}`} loading="lazy" />
              ) : (
                <div className="export-thumb-empty">No art</div>
              )}
              <figcaption>{thumb.id}</figcaption>
            </figure>
          ))}
        </aside>

        <ExportPanel workId={work.id} episodeId={episode.id} />
      </div>
    </div>
  );
}
