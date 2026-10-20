// Save one cut's lettering. Guarded (local origin, header, JSON, session), the
// work path resolved through the workspace, then merged into the latest
// episode on the project write path (lock, undo snapshot, journal, live event).
import { handleWrite, json } from "@/lib/api-route";
import { isCutLetteringPayload, saveCutLetteringChange } from "@/lib/lettering-save";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      if (!isCutLetteringPayload(body)) {
        return json(
          {
            ok: false,
            error:
              "request body must be { workId: string, episodeId: string, cutId: string, overlays: array }",
          },
          400,
        );
      }
      const work = await resolveWork(body.workId);
      if (!work) return json({ ok: false, error: `unknown work "${body.workId}"` }, 400);
      const { result, change } = await saveCutLetteringChange(work.root, body, {
        ...info,
        workId: work.id,
      });
      return json(
        { ...result, ...(change ? { changeId: change.changeId } : {}) },
        result.ok ? 200 : result.conflict ? 409 : 400,
      );
    },
    "could not save the lettering",
  );
}
