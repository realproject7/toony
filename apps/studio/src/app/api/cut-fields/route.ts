// Cut field edits from the focused cut editor (#332). Guarded; the posted work
// id is resolved path-safely against the workspace scan, the cut is found by
// exact id in the loaded project, the whole project is validated with the cut
// replaced, and only that episode's cuts file is written, on the project write
// path. The render record and the image reference are never accepted from the
// browser and never changed here.

import { handleWrite, json } from "@/lib/api-route";
import { isCutFieldsPayload, saveCutFieldsChange } from "@/lib/cut-fields";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      if (!isCutFieldsPayload(body)) {
        return json(
          {
            ok: false,
            error:
              "provide workId, episodeId, cutId and fields { imagePrompt, negativePrompt, characters, shotType, palette, panelAspect }",
          },
          400,
        );
      }
      const work = await resolveWork(body.workId);
      if (!work) return json({ ok: false, error: "unknown work" }, 400);
      const { result, change } = await saveCutFieldsChange(work.root, body, {
        ...info,
        workId: work.id,
      });
      return json(
        { ...result, ...(change ? { changeId: change.changeId } : {}) },
        result.ok ? 200 : 400,
      );
    },
    "could not save the cut",
  );
}
