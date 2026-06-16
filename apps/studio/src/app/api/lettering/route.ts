// Lettering write endpoint for the focused cut editor (issue #8).
//
// The studio is local-first and account-free: this route is the single server
// write path the editor uses to persist a cut's bubbles. It loads the selected
// project from `TOONY_PROJECT_DIR`, replaces ONE episode's lettering with the
// posted overlay set, validates the resulting project with `@toony/schema`
// (per-overlay shape, unique ids, and cross-file integrity — every `cutId` must
// match a real cut in the episode), and writes only that episode's
// `lettering.json` deterministically through project-io. Invalid edits are
// rejected with an actionable message and nothing is written.
//
// Path safety: the episode id is resolved by exact match against the loaded
// project's episode ids — it is never joined into a filesystem path from raw
// input, so it cannot traverse outside the project tree. project-io derives the
// concrete file path from the validated id, mirroring the `/api/asset` guard.

import { writeLettering } from "@toony/project-io";
import { type LetteringOverlay, type Project, validateProject } from "@toony/schema";
import { loadSelectedProject, ProjectIoError, projectDir } from "@/lib/project";

export const dynamic = "force-dynamic";

interface SavePayload {
  episodeId: string;
  overlays: LetteringOverlay[];
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.episodeId === "string" && Array.isArray(v.overlays);
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (!isSavePayload(payload)) {
    return badRequest("request body must be { episodeId: string, overlays: array }");
  }
  const { episodeId, overlays } = payload;

  let loaded: Awaited<ReturnType<typeof loadSelectedProject>>;
  try {
    loaded = await loadSelectedProject();
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return Response.json({ ok: false, error: reason }, { status: 500 });
  }

  // Resolve the episode by exact id match — never join raw input into a path.
  const bundleIndex = loaded.project.episodes.findIndex(
    (bundle) => bundle.episode.id === episodeId,
  );
  if (bundleIndex === -1) {
    return badRequest(`unknown episode "${episodeId}"`);
  }

  // Build the candidate project with this episode's lettering replaced, then run
  // the full validator so cross-file integrity (cutId references, id uniqueness)
  // is enforced before any bytes are written.
  const candidate: Project = {
    webtoon: loaded.project.webtoon,
    episodes: loaded.project.episodes.map((bundle, index) =>
      index === bundleIndex ? { ...bundle, lettering: overlays } : bundle,
    ),
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const detail = result.issues
      .filter((issue) => issue.path.startsWith(`episodes[${bundleIndex}].lettering`))
      .map((issue) => `${issue.path}: ${issue.message}`);
    const message =
      detail.length > 0
        ? `invalid lettering: ${detail.join("; ")}`
        : `invalid project after edit: ${result.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`;
    return badRequest(message);
  }

  try {
    await writeLettering(projectDir(), episodeId, overlays);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return Response.json({ ok: false, error: reason }, { status: 500 });
  }

  return Response.json({ ok: true, count: overlays.length });
}
