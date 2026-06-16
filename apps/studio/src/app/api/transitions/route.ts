// Transition write endpoint for the transition editor (issue #9).
//
// Transitions are first-class objects that live in `episode.sequence` between
// cuts. This route is the single server write path the editor uses to persist
// an episode's transition records AND the reading sequence that references them.
// It loads the selected project from `TOONY_PROJECT_DIR`, replaces ONE episode's
// transitions and sequence with the posted set, validates the resulting project
// with `@toony/schema` (per-transition shape, unique ids, every sequence entry
// references a real record, transitions only between cuts), and writes only that
// episode's `transitions.yaml` + `episode.yaml` deterministically through
// project-io. Invalid edits are rejected with an actionable message and nothing
// is written. The cuts file is never touched.
//
// Path safety: the episode id is resolved by exact match against the loaded
// project's episode ids — it is never joined into a filesystem path from raw
// input, so it cannot traverse outside the project tree. project-io derives the
// concrete file paths from the validated id, mirroring the `/api/asset` and
// `/api/lettering` guards.

import { writeTransitions } from "@toony/project-io";
import { type Project, type SequenceItem, type Transition, validateProject } from "@toony/schema";
import { loadSelectedProject, ProjectIoError, projectDir } from "@/lib/project";

export const dynamic = "force-dynamic";

interface SavePayload {
  episodeId: string;
  sequence: SequenceItem[];
  transitions: Transition[];
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.episodeId === "string" && Array.isArray(v.sequence) && Array.isArray(v.transitions)
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
      "request body must be { episodeId: string, sequence: array, transitions: array }",
    );
  }
  const { episodeId, sequence, transitions } = payload;

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
  const target = loaded.project.episodes[bundleIndex];
  if (bundleIndex === -1 || !target) {
    return badRequest(`unknown episode "${episodeId}"`);
  }

  // Build the candidate project with this episode's transitions + sequence
  // replaced, then run the full validator so cross-file integrity (sequence
  // references, id uniqueness, transition-between-cuts shape) is enforced
  // before any bytes are written.
  const candidate: Project = {
    webtoon: loaded.project.webtoon,
    episodes: loaded.project.episodes.map((bundle, index) =>
      index === bundleIndex
        ? {
            ...bundle,
            transitions,
            episode: { ...bundle.episode, sequence },
          }
        : bundle,
    ),
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const prefix = `episodes[${bundleIndex}]`;
    const detail = result.issues
      .filter(
        (issue) =>
          issue.path.startsWith(`${prefix}.transitions`) ||
          issue.path.startsWith(`${prefix}.episode.sequence`) ||
          issue.path === `${prefix}.transitions`,
      )
      .map((issue) => `${issue.path}: ${issue.message}`);
    const message =
      detail.length > 0
        ? `invalid transitions: ${detail.join("; ")}`
        : `invalid project after edit: ${result.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`;
    return badRequest(message);
  }

  try {
    await writeTransitions(
      projectDir(),
      episodeId,
      { ...target.episode, sequence },
      transitions,
      target.cuts,
    );
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return Response.json({ ok: false, error: reason }, { status: 500 });
  }

  return Response.json({ ok: true, count: transitions.length });
}
