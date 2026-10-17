// Character registry writes from the Characters page (#328). The posted work id
// is resolved path-safely against the workspace scan; the registry is validated
// with the whole project before any byte is written; only `webtoon.json` is
// written, through project-io. No file upload: a reference sheet is a path the
// person placed under `characters/<id>/` themselves.

import { isCharactersPayload, saveCharacters } from "@/lib/characters";
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
  if (!isCharactersPayload(payload)) {
    return Response.json(
      {
        ok: false,
        error:
          "provide workId and characters: [{ id, name, lockstring, references? }], each a string or string array",
      },
      { status: 400 },
    );
  }
  const work = await resolveWork(payload.workId);
  if (!work) {
    return Response.json({ ok: false, error: "unknown work" }, { status: 400 });
  }
  try {
    const result = await saveCharacters(work.root, payload.characters);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the characters") },
      { status: 500 },
    );
  }
}
