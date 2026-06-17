// Per-work transition editor route (issue #9, scoped for #51).
//
// Loads one episode of the work resolved path-safely from `<workId>` — its cuts,
// transition records, and reading sequence — and hands them to the client editor
// (`TransitionEditor`). Edits persist through `/api/transitions`, scoped to this
// work, which validates and writes `transitions.yaml` + `episode.yaml`.

import { notFound } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { TransitionEditor } from "@/components/transition-editor";
import { assetUrl, findEpisodeBundle, loadWork, ProjectIoError } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function TransitionEditorPage({
  params,
}: {
  params: Promise<{ workId: string; id: string }>;
}) {
  const { workId, id } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  const episodeId = decodeURIComponent(id);

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const bundle = findEpisodeBundle(loaded, episodeId);
  if (!bundle) notFound();

  // Resolve each transition's image to a safe served URL once, server-side, so
  // the client editor can show the current image without re-deriving asset paths.
  const imageUrls: Record<string, string | null> = {};
  for (const transition of bundle.transitions) {
    imageUrls[transition.id] = assetUrl(work.id, work.root, transition.image);
  }

  return (
    <TransitionEditor
      workId={work.id}
      episodeId={episodeId}
      episodeTitle={bundle.episode.title}
      webtoonTitle={loaded.project.webtoon.title}
      cuts={bundle.cuts}
      initialTransitions={bundle.transitions}
      initialSequence={bundle.episode.sequence}
      imageUrls={imageUrls}
    />
  );
}
