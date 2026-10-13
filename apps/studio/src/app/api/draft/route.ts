// Draft apply and discard for the Script page (#330).
//
// The page shows the diff `toony draft show` would print and this route is the
// one write path behind its Apply button. It resolves the posted `workId`
// path-safely against the workspace scan, then hands the absolute root to the
// same functions the CLI uses: the posted fingerprint must still match the
// project, the shipped `applyDraft` refuses on every conflict, and nothing here
// adds a second diff, a second apply or a force flag. Discard removes the draft
// file and touches no project data.

import { safeErrorMessage } from "@/lib/errors";
import {
  applyFromStudio,
  describeRefusal,
  discardFromStudio,
  isDraftActionPayload,
} from "@/lib/script-view";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "request body must be valid JSON" }, { status: 400 });
  }
  if (!isDraftActionPayload(payload)) {
    return Response.json(
      {
        ok: false,
        error:
          "provide workId, episodeId, action (apply or discard) and, for apply, the reviewedAgainst fingerprint",
      },
      { status: 400 },
    );
  }
  const work = await resolveWork(payload.workId);
  if (!work) {
    return Response.json({ ok: false, error: "unknown work" }, { status: 400 });
  }
  try {
    if (payload.action === "discard") {
      const removed = await discardFromStudio(work.root, payload.episodeId);
      return Response.json({ ok: true, removed });
    }
    const result = await applyFromStudio(
      work.root,
      payload.episodeId,
      payload.reviewedAgainst as NonNullable<typeof payload.reviewedAgainst>,
    );
    if (result.applied) {
      return Response.json({ ok: true, created: result.created });
    }
    const reason = result.refusal?.reason ?? "refused";
    const status = reason === "draft-missing" ? 404 : 409;
    return Response.json(
      { ok: false, reason, error: describeRefusal(result), refusal: result.refusal },
      { status },
    );
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not update the draft") },
      { status: 500 },
    );
  }
}
