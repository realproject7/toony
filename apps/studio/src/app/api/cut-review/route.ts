// A narrow artwork review edit. Guarded; every id is resolved against trusted
// records before writing; never accepts a cut snapshot or a filesystem path
// from the browser. Runs on the project write path.

import { handleWrite, json } from "@/lib/api-route";
import { isCutReviewPayload, saveCutReviewChange } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      if (!isCutReviewPayload(body)) {
        return json(
          {
            ok: false,
            error: "provide workId, episodeId, cutId, artworkRevision, and a valid reviewStatus",
          },
          400,
        );
      }
      const work = await resolveWork(body.workId);
      if (!work) return json({ ok: false, error: "unknown work" }, 400);
      const { result, change } = await saveCutReviewChange(work.root, body, {
        ...info,
        workId: work.id,
      });
      return json(
        { ...result, ...(change ? { changeId: change.changeId } : {}) },
        result.ok ? 200 : "conflict" in result && result.conflict ? 409 : 400,
      );
    },
    "could not save the cut review",
  );
}
