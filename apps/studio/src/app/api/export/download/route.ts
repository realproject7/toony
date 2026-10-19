// Download exported files: `GET /api/export/download?work=&episode=&output=`
// with `file=<name>` for one file or `all=1` for a ZIP of every file plus the
// manifest. Read-only, loopback only, and limited to the files the output's own
// manifest lists, each verified against its recorded size and SHA-256.

import {
  assertLocalRead,
  buildExportZip,
  ExportAccessError,
  readExportFile,
} from "@/lib/export-download";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function attachment(name: string): string {
  return `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRead(request);
    const { searchParams } = new URL(request.url);
    const workId = searchParams.get("work") ?? "";
    const episodeId = searchParams.get("episode") ?? "";
    const output = searchParams.get("output") ?? "";
    const work = await resolveWork(workId);
    if (!work) throw new ExportAccessError(404, "This work does not exist.");
    if (searchParams.get("all") === "1") {
      const zip = await buildExportZip(work.root, episodeId, output);
      return new Response(new Uint8Array(zip.bytes), {
        headers: {
          "content-type": "application/zip",
          "content-length": String(zip.bytes.byteLength),
          "content-disposition": attachment(zip.name),
          "cache-control": "no-store",
        },
      });
    }
    const name = searchParams.get("file") ?? "";
    const file = await readExportFile(work.root, episodeId, output, name, searchParams.get("rev"));
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": attachment(`${episodeId}-${output}-${file.name}`),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (cause) {
    if (cause instanceof ExportAccessError) {
      return new Response(cause.message, { status: cause.status });
    }
    return new Response("Could not read this export.", { status: 500 });
  }
}
