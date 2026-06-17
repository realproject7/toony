// Export run endpoint for the studio export screen (issue #53).
//
// The studio is local-first and account-free: this route is the server path the
// export screen uses to RUN one of the three headless export targets
// (platform / stitched / plotlink) over the existing `@toony/export` engine. It
// resolves the posted `workId` to a work directory PATH-SAFELY against the
// workspace scan, resolves the `episodeId` by exact match against the loaded
// project, validates the render options against the same bounds the CLI uses, and
// then hands an absolute work root to the engine. The engine owns all rendering,
// constraint enforcement, manifest, and on-disk writes; this route adds no export
// logic of its own.
//
// Path safety: the work id is matched exactly against the workspace scan and the
// episode id is matched exactly against the loaded project — neither is ever
// joined into a filesystem path from raw input, so neither can traverse outside
// the work tree. The engine writes only inside `episodes/<id>/exports/<target>`
// of the resolved root, and the manifest it returns carries only work-relative
// paths.

import { relative } from "node:path";
import {
  EXPORT_TARGET_KINDS,
  ExportError,
  type ExportOptions,
  type ExportTargetKind,
} from "@toony/export";
import { isPathSafeId, validateExportQuality, validateExportWidth } from "@toony/schema";
import { safeErrorMessage } from "@/lib/errors";
import { deriveConstraintChecks, runExportTarget } from "@/lib/export";
import { loadWork } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface ExportPayload {
  workId: string;
  episodeId: string;
  target: ExportTargetKind;
  width?: number;
  format?: "png" | "jpeg";
  quality?: number;
}

const TARGETS = new Set<string>(EXPORT_TARGET_KINDS);

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

function isExportPayload(value: unknown): value is ExportPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.workId !== "string" || typeof v.episodeId !== "string") return false;
  if (typeof v.target !== "string" || !TARGETS.has(v.target)) return false;
  if (v.width !== undefined && typeof v.width !== "number") return false;
  if (v.format !== undefined && v.format !== "png" && v.format !== "jpeg") return false;
  if (v.quality !== undefined && typeof v.quality !== "number") return false;
  return true;
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (!isExportPayload(payload)) {
    return badRequest(
      "request body must be { workId, episodeId, target: platform|stitched|plotlink, width?, format?, quality? }",
    );
  }
  const { workId, episodeId, target, width, format, quality } = payload;

  // Validate render options against the same bounds the CLI enforces (the bounds
  // and check are shared via @toony/schema so the two cannot diverge).
  const widthError = validateExportWidth(width);
  if (widthError) return badRequest(widthError);
  const qualityError = validateExportQuality(quality);
  if (qualityError) return badRequest(qualityError);

  // The episode id is handed to the engine, which joins it into a path. The
  // exact-match check below is the primary guard, but reject an unsafe segment
  // up front for a clear 400 (defense in depth, #74).
  if (!isPathSafeId(episodeId)) return badRequest(`unknown episode "${episodeId}"`);

  const work = await resolveWork(workId);
  if (work === null) return badRequest(`unknown work "${workId}"`);

  // Confirm the episode exists by exact id match before invoking the engine, so
  // an unknown episode is a clear 400 rather than an opaque engine error.
  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    return Response.json({ ok: false, error: safeErrorMessage(cause) }, { status: 500 });
  }
  if (!loaded.project.episodes.some((bundle) => bundle.episode.id === episodeId)) {
    return badRequest(`unknown episode "${episodeId}"`);
  }

  const options: ExportOptions = { width, format, quality };

  try {
    const { manifest, outDir } = await runExportTarget(work.root, target, episodeId, options);
    return Response.json({
      ok: true,
      manifest,
      checks: deriveConstraintChecks(manifest),
      // Work-relative output directory — never an absolute on-disk path.
      outDir: relative(work.root, outDir),
    });
  } catch (cause) {
    // The engine raises an actionable `ExportError` (e.g. PlotLink markdown too
    // short, too many images, an image that cannot be compressed under the cap).
    // Surface its code + message verbatim so the UI can show the real reason.
    if (cause instanceof ExportError) {
      return Response.json({ ok: false, error: cause.message, code: cause.code }, { status: 422 });
    }
    // ProjectIoError and unknown causes embed absolute on-disk paths — return a
    // generic, path-free message instead of their raw text (#78).
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not run the export") },
      { status: 500 },
    );
  }
}
