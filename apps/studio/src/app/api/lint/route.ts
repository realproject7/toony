// Craft-lint read endpoint for the studio editor (issue #102).
//
// The studio is local-first and account-free: this route runs `@toony/lint`
// SERVER-SIDE for one episode and returns its findings so the editor can show a
// craft-lint panel (craft/*, character/*, and per-bubble overflow). It resolves
// the posted/queried `workId` to a work directory PATH-SAFELY against the
// workspace scan, loads that work's project, finds the episode by exact id match,
// and runs the pure craft + character-ref lints plus the image-aware overflow
// lint against that episode's bundle. Nothing is written; this is a read path.
//
// Path safety: the work id is matched exactly against the workspace scan and the
// episode id is resolved by exact match against the loaded project — neither is
// joined into a filesystem path from raw input. The overflow lint reads cut art
// only through `resolveWorkAsset`, which rejects any path that escapes the work
// tree, so the resolver can never read outside the work directory.

import { safeErrorMessage } from "@/lib/errors";
import { lintEpisodeBundle, loadWork } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** Run every editor-relevant lint for one episode of one work. */
async function lintEpisode(workId: string, episodeId: string): Promise<Response> {
  const work = await resolveWork(workId);
  if (work === null) {
    return badRequest(`unknown work "${workId}"`);
  }

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    return Response.json({ ok: false, error: safeErrorMessage(cause) }, { status: 500 });
  }

  const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
  if (!bundle) {
    return badRequest(`unknown episode "${episodeId}"`);
  }

  const characters = loaded.project.webtoon.characters ?? [];
  const findings = await lintEpisodeBundle(work.root, bundle, characters);
  return Response.json({ ok: true, findings });
}

/** GET `/api/lint?work=<id>&episode=<id>` — convenience read for server fetches. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workId = url.searchParams.get("work");
  const episodeId = url.searchParams.get("episode");
  if (typeof workId !== "string" || typeof episodeId !== "string") {
    return badRequest("query must include work and episode ids");
  }
  return lintEpisode(workId, episodeId);
}

/** POST `{ workId, episodeId }` — used by the editor to refresh after a save. */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).workId !== "string" ||
    typeof (payload as Record<string, unknown>).episodeId !== "string"
  ) {
    return badRequest("request body must be { workId: string, episodeId: string }");
  }
  const { workId, episodeId } = payload as { workId: string; episodeId: string };
  return lintEpisode(workId, episodeId);
}
