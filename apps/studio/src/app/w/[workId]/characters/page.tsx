// Per-work Characters page (#328): the registry every cut, cast note and script
// line keys to, with each character's uses and reference sheets. Edits go
// through `/api/characters`, which validates the whole project and writes only
// `webtoon.json`.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CharacterEditor } from "@/components/character-editor";
import { LoadError } from "@/components/load-error";
import { characterRows } from "@/lib/characters";
import { assetUrl, loadWork, ProjectIoError } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function CharactersPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  const rows = await characterRows(work.root, loaded.project);
  const initial = rows.map((row) => ({
    character: row.character,
    uses: row.uses,
    sheets: row.sheets.map((sheet) => ({
      ...sheet,
      src: sheet.present ? assetUrl(work.id, work.root, sheet.path) : null,
    })),
  }));

  return (
    <div data-testid="studio-characters">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">Characters</h1>
          <div className="page-meta">
            <span>
              <b>{rows.length}</b> characters
            </span>
            <span>
              <b>{rows.filter((row) => row.sheets.length > 0).length}</b> with a reference sheet
            </span>
          </div>
        </div>
        <div className="page-meta">
          <Link href={`/w/${encodeURIComponent(work.id)}`} className="inspector-back">
            &larr; Story
          </Link>
        </div>
      </header>
      <CharacterEditor workId={work.id} initial={initial} />
    </div>
  );
}
