// The cast: one readable card per character (name, role, look, personality,
// outfits, reference sheets, where they appear), edited in place one character
// at a time.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type CastCard, CharacterCards } from "@/components/character-cards";
import { LiveRefresh } from "@/components/live-refresh";
import { LoadError } from "@/components/load-error";
import { characterRows } from "@/lib/characters";
import { workPageData, workTitle } from "@/lib/page-data";
import { assetUrl } from "@/lib/project";
import { cutNumberIn } from "@/lib/sequence-order";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ workId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId } = await params;
  return { title: `Characters · ${await workTitle(workId)}` };
}

export default async function CharactersPage({ params }: Params) {
  const { workId } = await params;
  const data = await workPageData(workId);
  if (data.kind === "missing") notFound();
  if (data.kind === "error") return <LoadError reason={data.reason} />;
  const { work, loaded } = data;
  const base = `/w/${encodeURIComponent(work.id)}`;
  const rows = await characterRows(work.root, loaded.project);
  const cards: CastCard[] = rows.map((row) => {
    const appearances: CastCard["appearances"] = [];
    for (const bundle of loaded.project.episodes) {
      const cuts = row.uses
        .filter((use) => use.episodeId === bundle.episode.id)
        .map((use) => ({
          number: cutNumberIn(bundle.episode.sequence, use.cutId),
          href: `${base}/episodes/${encodeURIComponent(bundle.episode.id)}?item=${encodeURIComponent(`cut:${use.cutId}`)}`,
        }))
        .filter((cut) => cut.number > 0)
        .sort((a, b) => a.number - b.number);
      if (cuts.length > 0) appearances.push({ episode: bundle.episode.title, cuts });
    }
    return {
      character: row.character,
      sheets: row.sheets
        .filter((sheet) => sheet.present)
        .map((sheet) => assetUrl(work.id, work.root, sheet.path))
        .filter((src): src is string => src !== null),
      appearances,
    };
  });

  return (
    <div className="page" data-testid="studio-characters">
      <LiveRefresh workId={work.id} scopes={[{ kind: "characters" }, { kind: "episodes" }]} />
      <header className="page-head">
        <div>
          <h1 className="page-title">Characters</h1>
          <p className="page-lede">
            Who appears in {loaded.project.webtoon.title}, how they look and how they talk.
          </p>
        </div>
      </header>
      <CharacterCards workId={work.id} cards={cards} />
    </div>
  );
}
