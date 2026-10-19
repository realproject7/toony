import { resolveGutterBandWidth, resolveReferenceWidth } from "@toony/schema";
import { notFound } from "next/navigation";
import type { CutEditorProps } from "@/components/cut-editor";
import { EpisodeEditor } from "@/components/episode-editor";
import { LoadError } from "@/components/load-error";
import { cutFieldsOf } from "@/lib/cut-fields";
import { cutLetteringRevision } from "@/lib/lettering-save";
import { discoverStudioPacks } from "@/lib/packs";
import {
  assetUrl,
  findEpisodeBundle,
  loadWork,
  ProjectIoError,
  resolveCutReviewArtwork,
} from "@/lib/project";
import { transitionRevision } from "@/lib/transition-save";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function EpisodeEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ workId: string; id: string }>;
  searchParams: Promise<{ item?: string; transitions?: string }>;
}) {
  const { workId, id } = await params;
  const query = await searchParams;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    return <LoadError reason={cause instanceof ProjectIoError ? cause.message : String(cause)} />;
  }
  const bundle = findEpisodeBundle(loaded, decodeURIComponent(id));
  if (!bundle) notFound();
  const { webtoon } = loaded.project;
  const packs = await discoverStudioPacks(work.root);
  const episodeId = bundle.episode.id;
  const referenceWidth = resolveReferenceWidth(webtoon.referenceWidth);
  const base = `/w/${encodeURIComponent(work.id)}/episodes/${encodeURIComponent(episodeId)}`;
  const navigation = bundle.episode.sequence
    .filter((item) => item.type === "cut")
    .map((item) => ({ id: item.id, href: `${base}?item=${encodeURIComponent(`cut:${item.id}`)}` }));
  const cuts: CutEditorProps[] = await Promise.all(
    bundle.cuts.map(async (cut) => {
      const { art, artworkRevision } = await resolveCutReviewArtwork(work.id, work.root, cut);
      const bubbles = bundle.lettering.filter((b) => b.cutId === cut.id);
      return {
        workId: work.id,
        episodeId,
        episodeTitle: bundle.episode.title,
        webtoonTitle: webtoon.title,
        cutId: cut.id,
        art,
        artworkRevision,
        initialBubbles: bubbles,
        initialLetteringRevision: cutLetteringRevision(bubbles),
        cutNavigation: navigation,
        initialReviewStatus: cut.reviewStatus,
        dialogueLanguage: webtoon.languages.dialogueLanguage,
        referenceWidth,
        gutterBandWidth: resolveGutterBandWidth(webtoon.gutterBandWidth),
        cutFields: cutFieldsOf(cut),
        characters: webtoon.characters ?? [],
        renderRecord: {
          ...(cut.imageSeed === undefined ? {} : { imageSeed: cut.imageSeed }),
          ...(cut.imageWorkflow === undefined ? {} : { imageWorkflow: cut.imageWorkflow }),
        },
        theme: packs.letteringTheme(webtoon.letteringTheme),
        themeId: webtoon.letteringTheme ?? null,
      };
    }),
  );
  const firstTransition = bundle.episode.sequence.find((item) => item.type === "transition");
  return (
    <EpisodeEditor
      key={`${work.id}/${episodeId}`}
      workId={work.id}
      episodeId={episodeId}
      title={bundle.episode.title}
      cuts={cuts}
      initialRhythm={{ sequence: bundle.episode.sequence, transitions: bundle.transitions }}
      initialRevision={transitionRevision(bundle.episode.sequence, bundle.transitions)}
      initialItem={
        typeof query.item === "string"
          ? query.item
          : query.transitions && firstTransition
            ? `transition:${firstTransition.id}`
            : undefined
      }
      imageUrls={Object.fromEntries(
        bundle.transitions.map((t) => [t.id, assetUrl(work.id, work.root, t.image)]),
      )}
      referenceWidth={referenceWidth}
    />
  );
}
