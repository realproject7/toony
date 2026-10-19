// Save an episode's transitions and reading order on the project write path.
import { handleWrite, json } from "@/lib/api-route";
import { isTransitionSavePayload, saveTransitionsChange } from "@/lib/transition-save";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      if (!isTransitionSavePayload(body))
        return json(
          {
            ok: false,
            error: "A sequence, transitions and the original save revision are required.",
          },
          400,
        );
      const work = await resolveWork(body.workId);
      if (!work) return json({ ok: false, error: "Unknown work." }, 400);
      const { result, change } = await saveTransitionsChange(work.root, body, {
        ...info,
        workId: work.id,
      });
      return json(
        { ...result, ...(change ? { changeId: change.changeId } : {}) },
        result.ok ? 200 : result.conflict ? 409 : 400,
      );
    },
    "Could not save the transitions.",
  );
}
