// The episode preview: the saved episode as a reader sees it, in the 480 px
// reading column, drawn by the same placement and transition renderers as the
// export. Cut numbers appear only on hover.

import { resolveGutterBandWidth, resolveReferenceWidth } from "@toony/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CutCanvas } from "@/components/cut-canvas";
import { LoadError } from "@/components/load-error";
import { StudioIcon } from "@/components/studio-icon";
import { TransitionBlock } from "@/components/transition-block";
import { routeParam, workPageData } from "@/lib/page-data";
import { FALLBACK_ART, findEpisodeBundle, resolveEpisodeRenderInputs } from "@/lib/project";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ workId: string; id: string }>;
  searchParams: Promise<{ item?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId, id } = await params;
  const data = await workPageData(workId);
  if (data.kind !== "ok") return { title: "Preview" };
  const bundle = findEpisodeBundle(data.loaded, routeParam(id));
  return {
    title: `Preview · ${bundle?.episode.title ?? "Episode"} · ${data.loaded.project.webtoon.title}`,
  };
}

export default async function EpisodeReaderPage({ params, searchParams }: Params) {
  const { workId, id } = await params;
  const data = await workPageData(workId);
  if (data.kind === "missing") notFound();
  if (data.kind === "error") return <LoadError reason={data.reason} />;
  const { work, loaded } = data;
  const bundle = findEpisodeBundle(loaded, routeParam(id));
  if (!bundle) notFound();
  const episodeHref = `/w/${encodeURIComponent(work.id)}/episodes/${encodeURIComponent(bundle.episode.id)}`;
  const query = await searchParams;
  const editHref =
    episodeHref +
    (typeof query.item === "string" && query.item ? `?item=${encodeURIComponent(query.item)}` : "");

  const { episode } = bundle;
  const { cutById, transitionById, bubblesByCut, artByCut } = await resolveEpisodeRenderInputs(
    bundle,
    work.id,
    work.root,
  );
  // The column this project's px gutter heights were authored against (#217), so
  // the reader scales bands the same way the export does.
  const referenceWidth = resolveReferenceWidth(loaded.project.webtoon.referenceWidth);
  // The gutter strip this project letters in (#215), resolved the same way the
  // export raster composes cuts with.
  const gutterBandWidth = resolveGutterBandWidth(loaded.project.webtoon.gutterBandWidth);
  let cutNumber = 0;

  return (
    <div data-testid="studio-episode-reader" className="reader-page">
      <header className="reader-head">
        <h1 className="reader-title">{episode.title}</h1>
        <nav className="reader-toggle" aria-label="Preview actions">
          <Link href={editHref} className="btn btn-ghost" data-testid="reader-edit-toggle">
            <StudioIcon name="arrow" rotate={180} /> Back to editor
          </Link>
          <Link
            href={`${episodeHref}/export`}
            className="btn btn-primary"
            data-testid="reader-export-toggle"
          >
            <StudioIcon name="export" /> Export
          </Link>
        </nav>
      </header>

      <div className="reader-flow" data-testid="reader-sequence">
        {episode.sequence.length === 0 && (
          <p className="empty-note">This episode has no cuts yet.</p>
        )}
        {episode.sequence.map((item, index) => {
          const key = `${index}-${item.type}-${item.id}`;
          if (item.type === "cut") {
            const cut = cutById.get(item.id);
            if (!cut) return null;
            cutNumber += 1;
            return (
              <CutCanvas
                key={key}
                cut={cut}
                number={cutNumber}
                bubbles={bubblesByCut.get(cut.id) ?? []}
                art={artByCut.get(cut.id) ?? FALLBACK_ART}
                dialogueLanguage={loaded.project.webtoon.languages.dialogueLanguage}
                gutterBandWidth={gutterBandWidth}
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
        <Link href={editHref} className="btn btn-ghost" data-testid="reader-back-to-edit">
          Back to editor
        </Link>
      </footer>
    </div>
  );
}
