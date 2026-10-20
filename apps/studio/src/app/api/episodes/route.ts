// Episode operations for the left workspace:
//   { action: "create", workId, title?, cuts? }   a blank episode with N empty cuts (default 1)
//   { action: "rename", workId, episodeId, title }
//   { action: "delete", workId, episodeId }
// Each answers `{ ok: true, change, changeId }` (plus `episodeId` on create) so
// the page can offer Undo.

import { handleWrite, json, stringField, workOf } from "@/lib/api-route";
import { contextFor, createBlankEpisode, deleteEpisode, renameEpisode } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request, async ({ body, info }) => {
    const resolved = await workOf(body);
    if ("response" in resolved) return resolved.response;
    const ctx = contextFor(resolved.work.root, { ...info, workId: resolved.work.id });
    const episodeId = stringField(body, "episodeId");
    switch (body.action) {
      case "create": {
        const cuts = body.cuts === undefined ? 1 : Number(body.cuts);
        const created = await createBlankEpisode(ctx, {
          ...(stringField(body, "title") ? { title: stringField(body, "title") } : {}),
          cuts,
        });
        return json({
          ok: true,
          episodeId: created.episodeId,
          title: created.title,
          change: created.change,
          changeId: created.change?.changeId ?? null,
        });
      }
      case "rename": {
        const title = stringField(body, "title");
        if (episodeId === undefined || title === undefined) {
          return json({ ok: false, error: "Name the episode and its new title." }, 400);
        }
        const change = await renameEpisode(ctx, episodeId, title);
        return json({ ok: true, change, changeId: change?.changeId ?? null });
      }
      case "delete": {
        if (episodeId === undefined)
          return json({ ok: false, error: "Name the episode to delete." }, 400);
        const change = await deleteEpisode(ctx, episodeId);
        return json({ ok: true, change, changeId: change?.changeId ?? null });
      }
      default:
        return json({ ok: false, error: "Use create, rename or delete." }, 400);
    }
  });
}
