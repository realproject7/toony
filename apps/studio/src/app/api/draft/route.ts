// Draft apply and discard for the Script page (#330).
//
// The page shows the diff `toony draft show` would print and this route is the
// one write path behind its Apply button. It is guarded, resolves the posted
// `workId` path-safely against the workspace scan, then hands the absolute
// root to the same functions the CLI uses, on the project write path: the
// posted fingerprint must still match the project, the shipped `applyDraft`
// refuses on every conflict, and nothing here adds a second diff, a second
// apply or a force flag. Discard removes the draft file and touches no project
// data.

import { handleWrite, json } from "@/lib/api-route";
import {
  applyFromStudioChange,
  describeRefusal,
  discardFromStudio,
  isDraftActionPayload,
} from "@/lib/script-view";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      if (!isDraftActionPayload(body)) {
        return json(
          {
            ok: false,
            error:
              "provide workId, episodeId, action (apply or discard) and, for apply, the reviewedAgainst fingerprint",
          },
          400,
        );
      }
      const work = await resolveWork(body.workId);
      if (!work) return json({ ok: false, error: "unknown work" }, 400);
      const actor = { ...info, workId: work.id };
      if (body.action === "discard") {
        const removed = await discardFromStudio(work.root, body.episodeId, actor);
        return json({ ok: true, removed });
      }
      const { result, change } = await applyFromStudioChange(
        work.root,
        body.episodeId,
        body.reviewedAgainst as NonNullable<typeof body.reviewedAgainst>,
        actor,
      );
      if (result.applied) {
        return json({
          ok: true,
          created: result.created,
          ...(change ? { changeId: change.changeId } : {}),
        });
      }
      const reason = result.refusal?.reason ?? "refused";
      const status = reason === "draft-missing" ? 404 : 409;
      return json(
        { ok: false, reason, error: describeRefusal(result), refusal: result.refusal },
        status,
      );
    },
    "could not update the proposal",
  );
}
