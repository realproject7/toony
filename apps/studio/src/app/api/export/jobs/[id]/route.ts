// Follow an export job: `GET /api/export/jobs/<id>` answers `{ ok: true, job }`
// with the job's state, progress and, once finished, its files.

import { assertLocalRead, ExportAccessError } from "@/lib/export-download";
import { getExportJob } from "@/lib/export-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  try {
    assertLocalRead(request);
  } catch (cause) {
    const status = cause instanceof ExportAccessError ? cause.status : 403;
    return Response.json(
      { ok: false, error: "Open Toony from this computer." },
      { status, headers },
    );
  }
  const { id } = await params;
  const job = getExportJob(id);
  if (!job) {
    return Response.json(
      { ok: false, error: "This export is no longer tracked. Export again." },
      { status: 404, headers },
    );
  }
  return Response.json({ ok: true, job }, { headers });
}
