// Cut field edits from the focused cut editor (#332). One narrow write: the
// posted work id is resolved path-safely against the workspace scan, the cut is
// found by exact id in the loaded project, the whole project is validated with
// the cut replaced, and only that episode's cuts file is written through
// project-io. The render record and the image reference are never accepted
// from the browser and never changed here.

import { isCutFieldsPayload, saveCutFields } from "@/lib/cut-fields";
import { safeErrorMessage } from "@/lib/errors";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "request body must be valid JSON" }, { status: 400 });
  }
  if (!isCutFieldsPayload(payload)) {
    return Response.json(
      {
        ok: false,
        error:
          "provide workId, episodeId, cutId and fields { imagePrompt, negativePrompt, characters, shotType, palette, panelAspect }",
      },
      { status: 400 },
    );
  }
  const work = await resolveWork(payload.workId);
  if (!work) {
    return Response.json({ ok: false, error: "unknown work" }, { status: 400 });
  }
  try {
    const result = await saveCutFields(work.root, payload);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the cut") },
      { status: 500 },
    );
  }
}
