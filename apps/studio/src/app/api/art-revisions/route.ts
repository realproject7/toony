import {
  applyArtRevision,
  artRevisionBrief,
  artRevisionContext,
  createArtRevision,
  listArtRevisions,
  RevisionError,
  readArtRevision,
} from "@toony/project-io";
import { resolveWork } from "@/lib/workspace";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const p = new URL(request.url).searchParams;
  const work = await resolveWork(p.get("workId") ?? "");
  if (!work) return Response.json({ ok: false, error: "Unknown work." }, { status: 400 });
  try {
    const episodeId = p.get("episodeId") ?? "",
      cutId = p.get("cutId") ?? "";
    const current = await artRevisionContext(work.root, episodeId, cutId);
    const requests = await listArtRevisions(work.root, episodeId, cutId);
    return Response.json({
      ok: true,
      contextRevision: current.contextRevision,
      sourceDigest: current.source.sha256,
      requests: requests.map((r) => ({
        ...r,
        context: undefined,
        brief: artRevisionBrief(r),
        stale: r.contextRevision !== current.contextRevision,
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  return Response.json(
    {
      ok: false,
      error:
        e instanceof RevisionError
          ? e.message
          : "Could not access the revision. Check the local work files.",
    },
    { status: 400 },
  );
}
export async function POST(request: Request): Promise<Response> {
  try {
    const p = await request.json();
    if (
      !p ||
      typeof p.workId !== "string" ||
      typeof p.episodeId !== "string" ||
      typeof p.cutId !== "string"
    )
      return failure(new RevisionError("Provide a work, episode and cut."));
    const work = await resolveWork(p.workId);
    if (!work) return failure(new RevisionError("Unknown work."));
    if (
      p.action === "create" &&
      typeof p.contextRevision === "string" &&
      typeof p.change === "string" &&
      typeof p.preserve === "string" &&
      (p.characterId === undefined || typeof p.characterId === "string")
    ) {
      const r = await createArtRevision(work.root, {
        episodeId: p.episodeId,
        cutId: p.cutId,
        contextRevision: p.contextRevision,
        change: p.change,
        preserve: p.preserve,
        characterId: p.characterId,
      });
      return Response.json({ ok: true, id: r.id });
    }
    if (p.action === "apply" && typeof p.id === "string" && typeof p.candidateDigest === "string") {
      const r = await readArtRevision(work.root, p.id);
      if (r.episodeId !== p.episodeId || r.cutId !== p.cutId)
        return failure(new RevisionError("Request belongs to another cut."));
      await applyArtRevision(work.root, p.id, p.candidateDigest);
      return Response.json({ ok: true });
    }
    return failure(new RevisionError("Invalid revision action."));
  } catch (e) {
    return failure(e);
  }
}
