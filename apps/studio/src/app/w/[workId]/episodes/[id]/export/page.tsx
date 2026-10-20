// Export page: choose an output (episode strip, cut images, Instagram, X or
// webtoon platforms), set at most a few options, preview the layout of the
// files, export in the background and download the results.
//
// The page resolves the work path-safely from `<workId>`, reads each cut's
// artwork size for the layout preview, and loads the exports already on disk.
// Rendering and writing happen in the export engine through `/api/export`.

import { readFile } from "node:fs/promises";
import { readImageDimensions } from "@toony/export";
import { resolveReferenceWidth } from "@toony/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExportPanel } from "@/components/export-panel";
import { LoadError } from "@/components/load-error";
import { savedExports } from "@/lib/export";
import type { PreviewItem } from "@/lib/export-view";
import { routeParam, workPageData } from "@/lib/page-data";
import {
  assetUrl,
  findEpisodeBundle,
  loadWork,
  ProjectIoError,
  resolveWorkAsset,
  viewedArt,
} from "@/lib/project";
import { resolveWork } from "@/lib/workspace";
import "./export.css";

export const dynamic = "force-dynamic";

/** Header-only size of a cut's artwork, or null when it cannot be read. */
async function artSize(
  root: string,
  rel: string | null,
): Promise<{ width: number; height: number } | null> {
  if (!rel) return null;
  const absolute = resolveWorkAsset(root, rel);
  if (!absolute) return null;
  try {
    const shape = readImageDimensions(new Uint8Array(await readFile(absolute)));
    return shape ? { width: shape.width, height: shape.height } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workId: string; id: string }>;
}): Promise<Metadata> {
  const { workId, id } = await params;
  const data = await workPageData(workId);
  if (data.kind !== "ok") return { title: "Export" };
  const bundle = findEpisodeBundle(data.loaded, routeParam(id));
  return {
    title: `Export · ${bundle?.episode.title ?? "Episode"} · ${data.loaded.project.webtoon.title}`,
  };
}

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

  const { episode, cuts, transitions } = bundle;
  const cutById = new Map(cuts.map((cut) => [cut.id, cut]));
  const transitionById = new Map(transitions.map((t) => [t.id, t]));
  const items: PreviewItem[] = [];
  for (const item of episode.sequence) {
    if (item.type === "cut") {
      const cut = cutById.get(item.id);
      if (!cut) continue;
      const rel = cut.image?.final ?? cut.image?.clean ?? null;
      const size = await artSize(work.root, rel);
      const src = assetUrl(work.id, work.root, rel);
      items.push({
        type: "cut",
        id: cut.id,
        ...(cut.panelAspect === undefined ? {} : { panelAspect: cut.panelAspect }),
        art: size && src ? viewedArt(src, size.width, size.height, cut.imageView) : null,
      });
    } else {
      const transition = transitionById.get(item.id);
      if (transition) items.push({ type: "transition", id: transition.id, transition });
    }
  }
  const cutCount = items.filter((item) => item.type === "cut").length;
  const saved = await savedExports(work.id, work.root, episode.id);

  return (
    <div data-testid="studio-episode-export" className="export-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">Export</h1>
          <div className="page-meta">
            <span>{episode.title}</span>
            <span>
              <b>{cutCount}</b> {cutCount === 1 ? "cut" : "cuts"}
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
              Preview
            </Link>
            <span className="btn btn-primary" aria-current="page" data-testid="export-mode-active">
              Export
            </span>
          </nav>
        </div>
      </header>

      <ExportPanel
        workId={work.id}
        episodeId={episode.id}
        referenceWidth={resolveReferenceWidth(loaded.project.webtoon.referenceWidth)}
        items={items}
        saved={saved}
      />
    </div>
  );
}
