// Per-work episode preview route.
//
// Walks the episode's canonical `sequence` and renders cuts and transitions in
// the exact reading order the reader experiences (Production Scroll hard rule 1),
// scoped to the work resolved path-safely from `<workId>`. Cut images and bubble
// overlays are resolved through `@toony/render` against this work's asset scope.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CutCanvas } from "@/components/cut-canvas";
import { LoadError } from "@/components/load-error";
import { TransitionBlock } from "@/components/transition-block";
import {
  type CutArt,
  findEpisodeBundle,
  loadWork,
  ProjectIoError,
  resolveCutArt,
} from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function EpisodePreviewPage({
  params,
}: {
  params: Promise<{ workId: string; id: string }>;
}) {
  const { workId, id } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  const episodeId = decodeURIComponent(id);
  const base = `/w/${encodeURIComponent(work.id)}`;

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const bundle = findEpisodeBundle(loaded, episodeId);
  if (!bundle) notFound();

  const { episode, cuts, transitions, lettering } = bundle;
  const cutById = new Map(cuts.map((cut) => [cut.id, cut]));
  const transitionById = new Map(transitions.map((tr) => [tr.id, tr]));
  const bubblesByCut = new Map<string, typeof lettering>();
  for (const overlay of lettering) {
    const list = bubblesByCut.get(overlay.cutId) ?? [];
    list.push(overlay);
    bubblesByCut.set(overlay.cutId, list);
  }

  const cutCount = episode.sequence.filter((item) => item.type === "cut").length;
  const transitionCount = episode.sequence.filter((item) => item.type === "transition").length;

  // Resolve each cut's art (src + natural dimensions) once, in parallel, so the
  // synchronous sequence render below can place bubbles at the true aspect ratio.
  const artEntries = await Promise.all(
    cuts.map(async (cut) => [cut.id, await resolveCutArt(work.id, work.root, cut)] as const),
  );
  const artByCut = new Map<string, CutArt>(artEntries);

  return (
    <div data-testid="studio-episode-preview">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">{episode.title}</h1>
          <div className="page-meta">
            <span>
              id <code>{episode.id}</code>
            </span>
            <span>
              <b>{episode.sequence.length}</b> sequence items
            </span>
          </div>
        </div>
        <div className="editor-actions">
          <Link
            href={`${base}/episodes/${encodeURIComponent(episode.id)}/transitions/edit`}
            className="btn"
            data-testid="edit-transitions-link"
          >
            Edit transitions
          </Link>
          <nav className="reader-toggle" aria-label="View mode">
            <span className="btn btn-primary" aria-current="page" data-testid="edit-mode-active">
              Edit
            </span>
            <Link
              href={`${base}/episodes/${encodeURIComponent(episode.id)}/read`}
              className="btn btn-ghost"
              data-testid="open-reader-link"
            >
              Read
            </Link>
            <Link
              href={`${base}/episodes/${encodeURIComponent(episode.id)}/export`}
              className="btn btn-ghost"
              data-testid="open-export-link"
            >
              Export
            </Link>
          </nav>
        </div>
      </header>

      <div className="preview-layout">
        <div className="sequence" data-testid="episode-sequence">
          {episode.sequence.length === 0 && (
            <p className="empty">This episode has no sequence items yet.</p>
          )}
          {episode.sequence.map((item, index) => {
            const key = `${index}-${item.type}-${item.id}`;
            if (item.type === "cut") {
              const cut = cutById.get(item.id);
              if (!cut) {
                return (
                  <div className="transition-block notice-danger" key={key}>
                    <span className="transition-type">Missing cut</span>
                    <span className="seq-id">{item.id}</span>
                  </div>
                );
              }
              return (
                <CutCanvas
                  key={key}
                  cut={cut}
                  bubbles={bubblesByCut.get(cut.id) ?? []}
                  art={artByCut.get(cut.id) ?? { src: null, width: 1000, height: 1414 }}
                  workId={work.id}
                  episodeId={episode.id}
                />
              );
            }
            const transition = transitionById.get(item.id);
            if (!transition) {
              return (
                <div className="transition-block notice-danger" key={key}>
                  <span className="transition-type">Missing transition</span>
                  <span className="seq-id">{item.id}</span>
                </div>
              );
            }
            return <TransitionBlock key={key} transition={transition} />;
          })}
        </div>

        <aside className="inspector" data-testid="episode-inspector">
          <Link href={`${base}/episodes`} className="inspector-back">
            &larr; All episodes
          </Link>
          <div>
            <h2 className="card-title">Sequence</h2>
            <div className="stat-row">
              <span>Cuts</span>
              <b>{cutCount}</b>
            </div>
            <div className="stat-row">
              <span>Transitions</span>
              <b>{transitionCount}</b>
            </div>
            <div className="stat-row">
              <span>Bubbles</span>
              <b>{lettering.length}</b>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
