// Local asset server for the studio preview.
//
// Cut images live in a work's `episodes/<id>/assets/` folders, OUTSIDE the Next
// `public/` directory, so they cannot be served as static files. This route
// streams a project-relative asset's bytes after (1) resolving the `work` query
// param to a work directory PATH-SAFELY against the workspace scan, (2) resolving
// the asset LEXICALLY inside that work root (see `resolveWorkAsset`), rejecting
// any path that would escape it, and (3) resolving the REAL path of the target
// (and the work root) and requiring the real target to stay inside the real work
// root — so an in-tree symlink that points outside the work cannot be used to
// read arbitrary files (#76). Read-only: it never writes, uploads, or publishes
// — consistent with the local-first, account-free product boundary.

import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, sep } from "node:path";
import { resolveWorkAsset } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

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
  const workId = searchParams.get("work");
  const relPath = searchParams.get("path");
  if (!workId) return new Response("missing work", { status: 400 });
  if (!relPath) return new Response("missing path", { status: 400 });

  const work = await resolveWork(workId);
  if (work === null) return new Response("unknown work", { status: 404 });

  const absolute = resolveWorkAsset(work.root, relPath);
  if (absolute === null) return new Response("invalid path", { status: 400 });

  const contentType = CONTENT_TYPES[extname(absolute).toLowerCase()];
  if (!contentType) return new Response("unsupported asset type", { status: 415 });

  try {
    // The lexical guard above rejects `..`/absolute inputs, but `absolute` could
    // still pass through an in-tree symlink whose target is OUTSIDE the work.
    // Resolve the REAL path of both the target and the work root and require the
    // target to remain inside the root, so a symlink escape is rejected (#76).
    const realRoot = await realpath(work.root);
    const realTarget = await realpath(absolute);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return new Response("invalid path", { status: 400 });
    }
    // `lstat` does not follow a final symlink; combined with the realpath check
    // above, only a regular file inside the work root is served.
    const info = await lstat(realTarget);
    if (!info.isFile()) return new Response("not a file", { status: 404 });
    const bytes = await readFile(realTarget);
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
