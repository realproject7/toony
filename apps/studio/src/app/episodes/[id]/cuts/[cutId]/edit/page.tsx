// Focused cut lettering editor route (issue #8).
//
// Loads ONE cut of an episode server-side — its art (src + natural dimensions)
// and the lettering overlays scoped to it — and hands them to the client editor
// (`CutEditor`). The editor renders bubbles through `@toony/render` (the same
// geometry core the read-only preview uses, so editing is WYSIWYG) and persists
// edits through `/api/lettering`. Editing transitions is out of scope here (#9).

import { notFound } from "next/navigation";
import { CutEditor } from "@/components/cut-editor";
import { LoadError } from "@/components/load-error";
import {
  findEpisodeBundle,
  loadSelectedProject,
  ProjectIoError,
  resolveCutArt,
} from "@/lib/project";

export const dynamic = "force-dynamic";

export default async function CutEditorPage({
  params,
}: {
  params: Promise<{ id: string; cutId: string }>;
}) {
  const { id, cutId } = await params;
  const episodeId = decodeURIComponent(id);
  const targetCutId = decodeURIComponent(cutId);

  let loaded: Awaited<ReturnType<typeof loadSelectedProject>>;
  try {
    loaded = await loadSelectedProject();
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const bundle = findEpisodeBundle(loaded, episodeId);
  if (!bundle) notFound();

  const cut = bundle.cuts.find((c) => c.id === targetCutId);
  if (!cut) notFound();

  const art = await resolveCutArt(cut);
  const bubbles = bundle.lettering.filter((overlay) => overlay.cutId === cut.id);

  return (
    <CutEditor
      episodeId={episodeId}
      episodeTitle={bundle.episode.title}
      webtoonTitle={loaded.project.webtoon.title}
      cutId={cut.id}
      art={art}
      initialBubbles={bubbles}
      initialImagePrompt={cut.imagePrompt}
      initialNegativePrompt={cut.negativePrompt}
    />
  );
}
