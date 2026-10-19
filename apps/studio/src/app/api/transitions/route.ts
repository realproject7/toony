import { safeErrorMessage } from "@/lib/errors";
import { isTransitionSavePayload, saveTransitions } from "@/lib/transition-save";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isTransitionSavePayload(payload))
    return Response.json(
      { ok: false, error: "A sequence, transitions and the original save revision are required." },
      { status: 400 },
    );
  const work = await resolveWork(payload.workId);
  if (!work) return Response.json({ ok: false, error: "Unknown work." }, { status: 400 });
  try {
    const result = await saveTransitions(work.root, payload);
    return Response.json(result, { status: result.ok ? 200 : result.conflict ? 409 : 400 });
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "Could not save the transitions.") },
      { status: 500 },
    );
  }
}
