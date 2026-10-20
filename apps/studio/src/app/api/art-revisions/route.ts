import {
  applyArtRevision,
  artRevisionBrief,
  artRevisionContext,
  createArtRevision,
  listArtRevisions,
  RevisionError,
  readArtRevision,
} from "@toony/project-io";
import { isPathSafeId } from "@toony/schema";
import { contextFor, withProjectWrite } from "@/lib/ops";
import { cutLabel } from "@/lib/ops/labels";
import { clientIdOf, guardFailure, guardJsonWrite } from "@/lib/request-guard";
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
  let p: Record<string, unknown>;
  try {
    p = await guardJsonWrite(request);
  } catch (error) {
    return guardFailure(error) ?? failure(new RevisionError("Invalid revision action."));
  }
  const clientId = clientIdOf(request);
  try {
    if (
      typeof p.workId !== "string" ||
      typeof p.episodeId !== "string" ||
      typeof p.cutId !== "string" ||
      !isPathSafeId(p.episodeId)
    )
      return failure(new RevisionError("Provide a work, episode and cut."));
    const work = await resolveWork(p.workId);
    if (!work) return failure(new RevisionError("Unknown work."));
    const episodeId = p.episodeId;
    const cutId = p.cutId;
    const ctx = contextFor(work.root, {
      actor: "human",
      workId: work.id,
      ...(clientId ? { clientId } : {}),
    });
    if (
      p.action === "create" &&
      typeof p.contextRevision === "string" &&
      typeof p.change === "string" &&
      typeof p.preserve === "string" &&
      (p.characterId === undefined || typeof p.characterId === "string")
    ) {
      const { contextRevision, change, preserve } = p;
      const characterId = p.characterId as string | undefined;
      // A request is runtime state under `.toony/`, not project data: it is
      // serialized with every other write but leaves no undo snapshot.
      const { result } = await withProjectWrite(
        ctx,
        {
          summary: "Requested an art change",
          scopes: [{ kind: "artwork", episodeId, cutId }],
          errors: "as-is",
        },
        (tx) =>
          createArtRevision(tx.root, {
            episodeId,
            cutId,
            contextRevision,
            change,
            preserve,
            characterId,
          }),
      );
      return Response.json({ ok: true, id: result.id });
    }
    if (
      p.action === "apply" &&
      typeof p.id === "string" &&
      /^[0-9a-f-]{36}$/.test(p.id) &&
      typeof p.candidateDigest === "string"
    ) {
      const id = p.id;
      const candidateDigest = p.candidateDigest;
      const r = await readArtRevision(work.root, id);
      if (r.episodeId !== episodeId || r.cutId !== cutId)
        return failure(new RevisionError("Request belongs to another cut."));
      const { change } = await withProjectWrite(
        ctx,
        {
          summary: "Used the revised artwork",
          scopes: [{ kind: "artwork", episodeId, cutId }],
          files: [`episodes/${episodeId}/cuts.yaml`, `.toony/revisions/${id}/request.json`],
          errors: "as-is",
        },
        async (tx) => {
          tx.setSummary(`Used the revised artwork on ${cutLabel(tx.before, episodeId, cutId)}`);
          await applyArtRevision(tx.root, id, candidateDigest);
        },
      );
      return Response.json({ ok: true, ...(change ? { changeId: change.changeId } : {}) });
    }
    return failure(new RevisionError("Invalid revision action."));
  } catch (e) {
    return failure(e);
  }
}
