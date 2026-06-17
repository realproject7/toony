// Cut-field write endpoint for the focused cut editor (issue #38, scoped for #51).
//
// The studio is local-first and account-free: this route is the server write
// path the editor uses to persist a cut's CUT-LEVEL fields (its `imagePrompt`
// and `negativePrompt`). It resolves the posted `workId` to a work directory
// PATH-SAFELY against the workspace scan, loads that work's project, updates the
// prompt fields of ONE cut in ONE episode, validates the resulting project with
// `@toony/schema`, and writes only that episode's `cuts.yaml` deterministically
// through project-io. Invalid edits are rejected and nothing is written. Existing
// image-asset references on the cut are left untouched — only the text fields are
// replaced.
//
// Path safety: the work id is matched exactly against the workspace scan and the
// episode and cut ids are resolved by exact match against the loaded project —
// none is ever joined into a filesystem path from raw input, so none can
// traverse outside the work tree. project-io derives the concrete file path from
// the validated ids, mirroring `/api/lettering`.

import { writeCuts } from "@toony/project-io";
import { type Project, validateProject } from "@toony/schema";
import { loadWork, ProjectIoError } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface SavePayload {
  workId: string;
  episodeId: string;
  cutId: string;
  imagePrompt: string;
  negativePrompt: string;
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    typeof v.cutId === "string" &&
    typeof v.imagePrompt === "string" &&
    typeof v.negativePrompt === "string"
  );
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (!isSavePayload(payload)) {
    return badRequest(
      "request body must be { workId: string, episodeId: string, cutId: string, imagePrompt: string, negativePrompt: string }",
    );
  }
  const { workId, episodeId, cutId, imagePrompt, negativePrompt } = payload;

  const work = await resolveWork(workId);
  if (work === null) {
    return badRequest(`unknown work "${workId}"`);
  }

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
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
  const bundle = loaded.project.episodes[bundleIndex];
  if (!bundle?.cuts.some((cut) => cut.id === cutId)) {
    return badRequest(`unknown cut "${cutId}" in episode "${episodeId}"`);
  }

  // Replace only this cut's prompt fields; every other cut and field is left
  // exactly as loaded so the round-trip preserves image refs and ordering.
  const nextCuts = bundle.cuts.map((cut) =>
    cut.id === cutId ? { ...cut, imagePrompt, negativePrompt } : cut,
  );

  // Build the candidate project with this episode's cuts replaced, then run the
  // full validator before any bytes are written.
  const candidate: Project = {
    webtoon: loaded.project.webtoon,
    episodes: loaded.project.episodes.map((b, index) =>
      index === bundleIndex ? { ...b, cuts: nextCuts } : b,
    ),
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const detail = result.issues
      .filter((issue) => issue.path.startsWith(`episodes[${bundleIndex}].cuts`))
      .map((issue) => `${issue.path}: ${issue.message}`);
    const message =
      detail.length > 0
        ? `invalid cut: ${detail.join("; ")}`
        : `invalid project after edit: ${result.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`;
    return badRequest(message);
  }

  try {
    await writeCuts(work.root, episodeId, nextCuts);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return Response.json({ ok: false, error: reason }, { status: 500 });
  }

  return Response.json({ ok: true });
}
