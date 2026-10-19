// Saved episode preview uses the same placement and transition renderers as export.

import { resolveGutterBandWidth, resolveReferenceWidth } from "@toony/schema";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CutCanvas } from "@/components/cut-canvas";
import { LoadError } from "@/components/load-error";
import { TransitionBlock } from "@/components/transition-block";
import {
  FALLBACK_ART,
  findEpisodeBundle,
  loadWork,
  ProjectIoError,
  resolveEpisodeRenderInputs,
} from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function EpisodeReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ workId: string; id: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { workId, id } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  const episodeId = decodeURIComponent(id);
  const base = `/w/${encodeURIComponent(work.id)}`;
  const episodeHref = `${base}/episodes/${encodeURIComponent(episodeId)}`;
  const query = await searchParams;
  const editHref =
    episodeHref + (typeof query.item === "string" ? `?item=${encodeURIComponent(query.item)}` : "");

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const bundle = findEpisodeBundle(loaded, episodeId);
  if (!bundle) notFound();

  const { episode } = bundle;
  const { cutById, transitionById, bubblesByCut, artByCut } = await resolveEpisodeRenderInputs(
    bundle,
    work.id,
    work.root,
  );
  // The column this project's px gutter heights were authored against (#217), so
  // the reader scales bands the same way the export does.
  const referenceWidth = resolveReferenceWidth(loaded.project.webtoon.referenceWidth);
  // The gutter strip this project letters in (#215) — the same field, resolved
  // the same way, that the export raster composes cuts with.
  const gutterBandWidth = resolveGutterBandWidth(loaded.project.webtoon.gutterBandWidth);

  return (
    <div data-testid="studio-episode-reader" className="reader-page">
      <header className="reader-head">
        <div>
          <p className="page-eyebrow">Episode preview</p>
          <h1 className="page-title">{episode.title}</h1>
          <p className="preview-caption">
            Saved artwork, lettering and transitions in output order.
          </p>
        </div>
        <nav className="reader-toggle" aria-label="View mode">
          <Link href={editHref} className="btn" data-testid="reader-edit-toggle">
            Back to editor
          </Link>
          <Link
            href={`${episodeHref}/export`}
            className="btn btn-primary"
            data-testid="reader-export-toggle"
          >
            Export
          </Link>
        </nav>
      </header>

      <div className="reader-flow" data-testid="reader-sequence">
        {episode.sequence.length === 0 && (
          <p className="empty">This episode has no sequence items yet.</p>
        )}
        {episode.sequence.map((item, index) => {
          const key = `${index}-${item.type}-${item.id}`;
          if (item.type === "cut") {
            const cut = cutById.get(item.id);
            if (!cut) return null;
            return (
              <CutCanvas
                key={key}
                cut={cut}
                bubbles={bubblesByCut.get(cut.id) ?? []}
                art={artByCut.get(cut.id) ?? FALLBACK_ART}
                workId={work.id}
                episodeId={episode.id}
                dialogueLanguage={loaded.project.webtoon.languages.dialogueLanguage}
                gutterBandWidth={gutterBandWidth}
                readOnly
              />
            );
          }
          const transition = transitionById.get(item.id);
          if (!transition) return null;
          return (
            <TransitionBlock
              key={key}
              transition={transition}
              referenceWidth={referenceWidth}
              readOnly
            />
          );
        })}
      </div>

      <footer className="reader-foot">
        <Link href={editHref} className="inspector-back" data-testid="reader-back-to-edit">
          &larr; Back to editing
        </Link>
      </footer>
    </div>
  );
}
