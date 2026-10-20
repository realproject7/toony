// Character registry writes from the Characters page (#328). Guarded, the
// posted work id resolved path-safely against the workspace scan, the registry
// validated with the whole project before any byte is written, and only
// `webtoon.json` written, on the project write path. No file upload: a
// reference sheet is a path the person placed under `characters/<id>/`.

import { handleWrite, json } from "@/lib/api-route";
import { isCharactersPayload, saveCharactersChange } from "@/lib/characters";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      if (!isCharactersPayload(body)) {
        return json(
          {
            ok: false,
            error:
              "provide workId and characters: [{ id, name, lockstring, references? }], each a string or string array",
          },
          400,
        );
      }
      const work = await resolveWork(body.workId);
      if (!work) return json({ ok: false, error: "unknown work" }, 400);
      const { result, change } = await saveCharactersChange(work.root, body.characters, {
        ...info,
        workId: work.id,
      });
      return json(
        { ...result, ...(change ? { changeId: change.changeId } : {}) },
        result.ok ? 200 : 400,
      );
    },
    "could not save the characters",
  );
}
