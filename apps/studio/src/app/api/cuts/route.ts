// Cut operations for the left workspace, one per request:
//   { action: "add", workId, episodeId, after?: cutId | null, scene? }
//   { action: "remove", workId, episodeId, cutId }
//   { action: "move", workId, episodeId, cutId, after: cutId | null }
//   { action: "scene", workId, episodeId, cutId, scene }
// `after: null` means first; an absent `after` on add means last. Answers
// `{ ok: true, cuts, added, removed, change, changeId }`.

import { handleWrite, json, stringField, workOf } from "@/lib/api-route";
import { type CutOperation, contextFor, editCuts } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function after(body: Record<string, unknown>): string | null | undefined {
  if (body.after === null) return null;
  return typeof body.after === "string" ? body.after : undefined;
}

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request, async ({ body, info }) => {
    const resolved = await workOf(body);
    if ("response" in resolved) return resolved.response;
    const episodeId = stringField(body, "episodeId");
    const cutId = stringField(body, "cutId");
    if (episodeId === undefined) return json({ ok: false, error: "Name the episode." }, 400);
    let operation: CutOperation;
    switch (body.action) {
      case "add":
        operation = {
          op: "add",
          ...(after(body) === undefined ? {} : { after: after(body) }),
          ...(stringField(body, "scene") === undefined
            ? {}
            : { scene: stringField(body, "scene") }),
        };
        break;
      case "remove":
        if (cutId === undefined) return json({ ok: false, error: "Name the cut to remove." }, 400);
        operation = { op: "remove", cutId };
        break;
      case "move": {
        const target = after(body);
        if (cutId === undefined || target === undefined) {
          return json({ ok: false, error: "Name the cut and where it goes." }, 400);
        }
        operation = { op: "move", cutId, after: target };
        break;
      }
      case "scene": {
        const scene = stringField(body, "scene");
        if (cutId === undefined || scene === undefined) {
          return json({ ok: false, error: "Name the cut and its scene." }, 400);
        }
        operation = { op: "update", cutId, scene };
        break;
      }
      default:
        return json({ ok: false, error: "Use add, remove, move or scene." }, 400);
    }
    const result = await editCuts(
      contextFor(resolved.work.root, { ...info, workId: resolved.work.id }),
      episodeId,
      [operation],
    );
    return json({ ok: true, ...result, changeId: result.change?.changeId ?? null });
  });
}
