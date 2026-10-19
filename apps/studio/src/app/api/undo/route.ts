// Undo one recorded change: `POST { workId, changeId }`. Answers the undo's
// own change (with `undoes`) or a refusal such as "Newer edits depend on this
// change. Undo those first."

import { handleWrite, json, stringField, workOf } from "@/lib/api-route";
import { contextFor, undoChange } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request, async ({ body, info }) => {
    const resolved = await workOf(body);
    if ("response" in resolved) return resolved.response;
    const changeId = stringField(body, "changeId");
    if (changeId === undefined) return json({ ok: false, error: "Name the change to undo." }, 400);
    const change = await undoChange(
      contextFor(resolved.work.root, { ...info, workId: resolved.work.id }),
      changeId,
    );
    return json({ ok: true, change, changeId: change.changeId });
  });
}
