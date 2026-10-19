// The episode editor page: loads the episode once and hands every cut's saved
// lettering, artwork and scene to the client editor.

import { resolveGutterBandWidth, resolveReferenceWidth } from "@toony/schema";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CutEditorProps } from "@/components/cut-editor";
import { EpisodeEditor } from "@/components/episode-editor";
import { LoadError } from "@/components/load-error";
import { cutLetteringRevision } from "@/lib/lettering-save";
import { discoverStudioPacks } from "@/lib/packs";
import { routeParam, workPageData } from "@/lib/page-data";
import { findEpisodeBundle, resolveCutReviewArtwork } from "@/lib/project";
import { cutNumberIn } from "@/lib/sequence-order";
import { transitionRevision } from "@/lib/transition-save";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ workId: string; id: string }>;
  searchParams: Promise<{ item?: string; transitions?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId, id } = await params;
  const data = await workPageData(workId);
  if (data.kind !== "ok") return { title: "Episode" };
  const bundle = findEpisodeBundle(data.loaded, routeParam(id));
  return { title: `${bundle?.episode.title ?? "Episode"} · ${data.loaded.project.webtoon.title}` };
}

export default async function EpisodeEditorPage({ params, searchParams }: Params) {
  const { workId, id } = await params;
  const query = await searchParams;
  const data = await workPageData(workId);
  if (data.kind === "missing") notFound();
  if (data.kind === "error") return <LoadError reason={data.reason} />;
  const { work, loaded } = data;
  const bundle = findEpisodeBundle(loaded, routeParam(id));
  if (!bundle) notFound();
  const { webtoon } = loaded.project;
  const packs = await discoverStudioPacks(work.root);
  const episodeId = bundle.episode.id;
  const referenceWidth = resolveReferenceWidth(webtoon.referenceWidth);
  const cuts: CutEditorProps[] = await Promise.all(
    bundle.cuts.map(async (cut) => {
      const { art, artworkRevision } = await resolveCutReviewArtwork(work.id, work.root, cut);
      const bubbles = bundle.lettering.filter((b) => b.cutId === cut.id);
      return {
        workId: work.id,
        episodeId,
        cutId: cut.id,
        cutNumber: cutNumberIn(bundle.episode.sequence, cut.id),
        art,
        hasArtwork: art.src !== null,
        artworkRevision,
        initialBubbles: bubbles,
        initialLetteringRevision: cutLetteringRevision(bubbles),
        ...(cut.reviewStatus === undefined ? {} : { reviewStatus: cut.reviewStatus }),
        dialogueLanguage: webtoon.languages.dialogueLanguage,
        referenceWidth,
        gutterBandWidth: resolveGutterBandWidth(webtoon.gutterBandWidth),
        scene: cut.imagePrompt,
        cutCharacterIds: [...(cut.characters ?? [])],
        characters: webtoon.characters ?? [],
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
      referenceWidth={referenceWidth}
    />
  );
}
