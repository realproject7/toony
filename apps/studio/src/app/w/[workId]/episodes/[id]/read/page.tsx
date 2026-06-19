// Distraction-free reader route (#49).
//
// Renders the whole episode top-to-bottom exactly as a reader experiences it —
// cut artwork + on-art bubbles + transitions in the canonical `sequence` order
// (Production Scroll hard rule 1) — at a comfortable, centered reading width
// with NO inspector or per-item edit affordances. The artwork/overlay/transition
// render path is the SAME `@toony/render`-backed `CutCanvas`/`TransitionBlock`
// the edit-chrome preview uses, so the reader stays WYSIWYG with preview and
// export; only the editing chrome is dropped. A header toggle returns to the
// editing preview so it is always obvious how to get back to editing.

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

export default async function EpisodeReaderPage({
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

  const { episode, cuts, transitions, lettering } = bundle;
  const cutById = new Map(cuts.map((cut) => [cut.id, cut]));
  const transitionById = new Map(transitions.map((tr) => [tr.id, tr]));
  const bubblesByCut = new Map<string, typeof lettering>();
  for (const overlay of lettering) {
    const list = bubblesByCut.get(overlay.cutId) ?? [];
    list.push(overlay);
    bubblesByCut.set(overlay.cutId, list);
  }

  // Resolve each cut's art (src + natural dimensions) once, in parallel, so the
  // synchronous sequence render below can place bubbles at the true aspect ratio.
  const artEntries = await Promise.all(
    cuts.map(async (cut) => [cut.id, await resolveCutArt(work.id, work.root, cut)] as const),
  );
  const artByCut = new Map<string, CutArt>(artEntries);

  return (
    <div data-testid="studio-episode-reader" className="reader-page">
      <header className="reader-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">{episode.title}</h1>
        </div>
        <nav className="reader-toggle" aria-label="View mode">
          <Link href={editHref} className="btn btn-ghost" data-testid="reader-edit-toggle">
            Edit
          </Link>
          <span className="btn btn-primary" aria-current="page" data-testid="reader-mode-active">
            Read
          </span>
          <Link
            href={`${editHref}/export`}
            className="btn btn-ghost"
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
                art={artByCut.get(cut.id) ?? { src: null, width: 1000, height: 1414 }}
                workId={work.id}
                episodeId={episode.id}
                readOnly
              />
            );
          }
          const transition = transitionById.get(item.id);
          if (!transition) return null;
          return <TransitionBlock key={key} transition={transition} readOnly />;
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
