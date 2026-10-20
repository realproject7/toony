// Start an export: `POST /api/export` with `{ workId, episodeId, output,
// options? }` answers `{ ok: true, jobId, job }` right away and the export runs
// in the background (`GET /api/export/jobs/<id>` follows it).
//
// Guarded like every mutating Studio route: loopback origin matching the host,
// the `x-toony-agent: 1` header, the session cookie and a JSON body. The work id is matched exactly
// against the workspace scan and the episode id against the loaded project, so
// neither is ever joined into a path from raw input. The engine writes only
// inside `episodes/<id>/exports/<output>/` and reports project-relative paths.

import { parseExportOptions } from "@toony/schema";
import { agentBody, assertAgentOrigin, assertAgentSession } from "@/lib/agent/security";
import { AgentError } from "@/lib/agent/types";
import { safeErrorMessage } from "@/lib/errors";
import { ExportJobError, startExportJob } from "@/lib/export-jobs";
import { loadWork } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function badRequest(error: string, code = "request"): Response {
  return reply({ ok: false, code, error }, 400);
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    assertAgentOrigin(request);
    assertAgentSession(request);
    body = await agentBody(request);
  } catch (cause) {
    if (cause instanceof AgentError) {
      return reply({ ok: false, code: cause.code, error: cause.message }, cause.status);
    }
    return badRequest("The request is incomplete.");
  }
  const { workId, episodeId, output } = body;
  if (typeof workId !== "string" || typeof episodeId !== "string" || typeof output !== "string") {
    return badRequest("Send { workId, episodeId, output, options? }.");
  }
  const { options, problems } = parseExportOptions(body.options);
  if (problems.length > 0) {
    return badRequest(problems.map((problem) => problem.message).join("; "), "options");
  }

  const work = await resolveWork(workId);
  if (work === null) return badRequest(`unknown work "${workId}"`);
  try {
    const loaded = await loadWork(work.root);
    if (!loaded.project.episodes.some((bundle) => bundle.episode.id === episodeId)) {
      return badRequest(`unknown episode "${episodeId}"`);
    }
  } catch (cause) {
    return reply({ ok: false, code: "load", error: safeErrorMessage(cause) }, 500);
  }

  try {
    const job = await startExportJob({
      workId: work.id,
      workRoot: work.root,
      episodeId,
      output,
      options,
    });
    return reply({ ok: true, jobId: job.id, job });
  } catch (cause) {
    if (cause instanceof ExportJobError) return badRequest(cause.message, cause.code);
    return reply({ ok: false, code: "export", error: "Could not start the export." }, 500);
  }
}
