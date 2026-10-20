import { loadProject } from "@toony/project-io";
import { isPathSafeId } from "@toony/schema";
import { readCutSuggestions } from "@/lib/suggestions/store";
import { resolveWork } from "@/lib/workspace";
export const dynamic = "force-dynamic";

/** A cut's dialogue suggestions, with flags and whether the cut changed since. */
export async function GET(request: Request): Promise<Response> {
  const p = new URL(request.url).searchParams;
  const work = await resolveWork(p.get("workId") ?? "");
  const episodeId = p.get("episodeId") ?? "";
  const cutId = p.get("cutId") ?? "";
  if (!work || !isPathSafeId(episodeId) || !isPathSafeId(cutId)) {
    return Response.json({ ok: false, error: "Unknown work, episode or cut." }, { status: 400 });
  }
  try {
    const loaded = await loadProject(work.root);
    const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
    const cut = bundle?.cuts.find((c) => c.id === cutId);
    if (!cut) return Response.json({ ok: true, suggestions: null });
    const suggestions = await readCutSuggestions(
      work.root,
      episodeId,
      cut,
      loaded.project.webtoon.characters ?? [],
    );
    return Response.json({ ok: true, suggestions });
  } catch {
    return Response.json(
      { ok: false, error: "Could not read the suggestions. Check the local work files." },
      { status: 400 },
    );
  }
}
