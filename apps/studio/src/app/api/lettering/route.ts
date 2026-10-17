// Save one cut's lettering. Resolve the work path through the workspace, then
// merge only that cut into the latest episode under the Studio write queue.
import { safeErrorMessage } from "@/lib/errors";
import { isCutLetteringPayload, saveCutLettering } from "@/lib/lettering-save";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (!isCutLetteringPayload(payload)) {
    return badRequest(
      "request body must be { workId: string, episodeId: string, cutId: string, overlays: array }",
    );
  }
  const work = await resolveWork(payload.workId);
  if (!work) return badRequest(`unknown work "${payload.workId}"`);
  try {
    const result = await saveCutLettering(work.root, payload);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the lettering") },
      { status: 500 },
    );
  }
}
