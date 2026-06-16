// Episode preview route.
//
// Walks the episode's canonical `sequence` and renders cuts and transitions in
// the exact reading order the reader experiences (Production Scroll hard rule
// 1). This is the SHELL: a readable vertical sequence. The RICH rendering of cut
// images, positioned bubble overlays, and transition rhythm visuals is issue #7,
// which fills the `CutCanvas`/`TransitionBlock` seam without changing this route.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CutCanvas } from "@/components/cut-canvas";
import { LoadError } from "@/components/load-error";
import { TransitionBlock } from "@/components/transition-block";
import {
  type CutArt,
  findEpisodeBundle,
  loadSelectedProject,
  ProjectIoError,
  resolveCutArt,
} from "@/lib/project";

export const dynamic = "force-dynamic";

export default async function EpisodePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = decodeURIComponent(id);

  let loaded: Awaited<ReturnType<typeof loadSelectedProject>>;
  try {
    loaded = await loadSelectedProject();
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
    cuts.map(async (cut) => [cut.id, await resolveCutArt(cut)] as const),
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
          <Link href="/episodes" className="inspector-back">
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
