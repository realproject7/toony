// A narrow artwork review edit. Resolve every id against trusted records before
// writing; never accept a cut snapshot or a filesystem path from the browser.
import { isCutReviewPayload, saveCutReview } from "@/lib/cut-review";
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
  if (!isCutReviewPayload(payload)) {
    return Response.json(
      { ok: false, error: "provide workId, episodeId, cutId, and a valid reviewStatus" },
      { status: 400 },
    );
  }
  const work = await resolveWork(payload.workId);
  if (!work) {
    return Response.json({ ok: false, error: "unknown work" }, { status: 400 });
  }
  try {
    const result = await saveCutReview(work.root, payload);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the cut review") },
      { status: 500 },
    );
  }
}
