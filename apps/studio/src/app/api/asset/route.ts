// Local asset server for the studio preview.
//
// Cut images live in the selected project's `episodes/<id>/assets/` folders,
// OUTSIDE the Next `public/` directory, so they cannot be served as static
// files. This route streams a project-relative asset's bytes after resolving it
// strictly inside `TOONY_PROJECT_DIR` (see `resolveProjectAsset`), rejecting any
// path that would escape the project root. Read-only: it never writes, uploads,
// or publishes — consistent with the local-first, account-free product boundary.

import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { resolveProjectAsset } from "@/lib/project";

export const dynamic = "force-dynamic";

/** Allow-list of image content types the preview can display. */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const relPath = searchParams.get("path");
  if (!relPath) return new Response("missing path", { status: 400 });

  const absolute = resolveProjectAsset(relPath);
  if (absolute === null) return new Response("invalid path", { status: 400 });

  const contentType = CONTENT_TYPES[extname(absolute).toLowerCase()];
  if (!contentType) return new Response("unsupported asset type", { status: 415 });

  try {
    const info = await stat(absolute);
    if (!info.isFile()) return new Response("not a file", { status: 404 });
    const bytes = await readFile(absolute);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        // Local files can change between edits; do not cache aggressively.
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("asset not found", { status: 404 });
  }
}
