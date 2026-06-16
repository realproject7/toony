// Transition editor route (issue #9).
//
// Loads one episode server-side — its cuts, transition records, and reading
// sequence — and hands them to the client editor (`TransitionEditor`). The editor
// lets the user insert a transition between any two adjacent cuts, edit the
// selected transition's fields, mark it human-edited, and preview the scroll
// rhythm through `@toony/render`'s `layoutTransition` (the same core the
// read-only preview uses). Edits persist through `/api/transitions`, which
// validates and writes `transitions.yaml` + `episode.yaml`. Editing cut
// lettering is out of scope here (#8).

import { notFound } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { TransitionEditor } from "@/components/transition-editor";
import { assetUrl, findEpisodeBundle, loadSelectedProject, ProjectIoError } from "@/lib/project";

export const dynamic = "force-dynamic";

export default async function TransitionEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  // Resolve each transition's image to a safe served URL once, server-side, so
  // the client editor can show the current image without re-deriving asset paths.
  const imageUrls: Record<string, string | null> = {};
  for (const transition of bundle.transitions) {
    imageUrls[transition.id] = assetUrl(transition.image);
  }

  return (
    <TransitionEditor
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
