// Works in the library.
//
//   { action: "create", title, genre? }   (also the original { name, genre? })
//     Creates a work that keeps the typed title exactly. Its folder is a safe
//     slug (`webtoon`, `webtoon-2` for titles with no Latin letters). With no
//     starter it has no episode; with one it is seeded like `toony init --genre`.
//   { action: "rename", workId, title }
//
// Guarded like every Studio write. Answers `{ ok: true, id, workId, title,
// change, changeId }` on create and `{ ok: true, change, changeId }` on rename.

import { handleWrite, json, stringField, workOf } from "@/lib/api-route";
import { contextFor, createWork, renameWork } from "@/lib/ops";
import { ensureWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWrite(
    request,
    async ({ body, info }) => {
      const action = body.action ?? "create";
      if (action === "rename") {
        const resolved = await workOf(body);
        if ("response" in resolved) return resolved.response;
        const title = stringField(body, "title");
        if (title === undefined) return json({ ok: false, error: "Enter a title." }, 400);
        const change = await renameWork(
          contextFor(resolved.work.root, { ...info, workId: resolved.work.id }),
          title,
        );
        return json({ ok: true, change, changeId: change?.changeId ?? null });
      }
      if (action !== "create") return json({ ok: false, error: "Use create or rename." }, 400);
      const title = stringField(body, "title") ?? stringField(body, "name");
      const genre = stringField(body, "genre");
      if (title === undefined || (body.genre !== undefined && genre === undefined)) {
        return json(
          { ok: false, error: "request body must be { title: string, genre?: string }" },
          400,
        );
      }
      const root = await ensureWorkspaceRoot();
      const created = await createWork(root, title, {
        ...(genre === undefined ? {} : { genre }),
        info,
      });
      return json({
        ok: true,
        id: created.workId,
        workId: created.workId,
        title: created.title,
        change: created.change,
        changeId: created.change.changeId,
      });
    },
    "could not create the work",
  );
}
