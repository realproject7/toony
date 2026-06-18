// Per-work focused cut lettering editor route (issue #8, scoped for #51).
//
// Loads ONE cut of an episode in the work resolved path-safely from `<workId>` —
// its art (src + natural dimensions) and the lettering overlays scoped to it —
// and hands them to the client editor (`CutEditor`). The editor renders bubbles
// through `@toony/render` and persists edits through `/api/lettering` and
// `/api/cut`, both scoped to this work.

import { notFound } from "next/navigation";
import { CutEditor } from "@/components/cut-editor";
import { LoadError } from "@/components/load-error";
import {
  findEpisodeBundle,
  lintEpisodeBundle,
  loadWork,
  ProjectIoError,
  resolveCutArt,
} from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function CutEditorPage({
  params,
}: {
  params: Promise<{ workId: string; id: string; cutId: string }>;
}) {
  const { workId, id, cutId } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  const episodeId = decodeURIComponent(id);
  const targetCutId = decodeURIComponent(cutId);

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const bundle = findEpisodeBundle(loaded, episodeId);
  if (!bundle) notFound();

  const cut = bundle.cuts.find((c) => c.id === targetCutId);
  if (!cut) notFound();

  const art = await resolveCutArt(work.id, work.root, cut);
  const bubbles = bundle.lettering.filter((overlay) => overlay.cutId === cut.id);

  const characters = loaded.project.webtoon.characters ?? [];
  const findings = await lintEpisodeBundle(work.root, bundle, characters);

  return (
    <CutEditor
      workId={work.id}
      episodeId={episodeId}
      episodeTitle={bundle.episode.title}
      webtoonTitle={loaded.project.webtoon.title}
      cutId={cut.id}
      art={art}
      initialBubbles={bubbles}
      initialImagePrompt={cut.imagePrompt}
      initialNegativePrompt={cut.negativePrompt}
      initialCraft={{
        shotType: cut.shotType,
        palette: cut.palette,
        layer: cut.layer,
        styleTag: cut.styleTag,
        characters: cut.characters ?? [],
      }}
      initialCharacters={characters}
      initialFindings={findings}
    />
  );
}
