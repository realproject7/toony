// Transition write endpoint for the transition editor (issue #9, scoped for #51).
//
// Transitions are first-class objects that live in `episode.sequence` between
// cuts. This route is the single server write path the editor uses to persist
// an episode's transition records AND the reading sequence that references them.
// It resolves the posted `workId` to a work directory PATH-SAFELY against the
// workspace scan, loads that work's project, replaces ONE episode's transitions
// and sequence with the posted set, validates the resulting project with
// `@toony/schema` (per-transition shape, unique ids, every sequence entry
// references a real record, transitions only between cuts), and writes only that
// episode's `transitions.yaml` + `episode.yaml` deterministically through
// project-io. Invalid edits are rejected and nothing is written. The cuts file is
// never touched.
//
// Path safety: the work id is matched exactly against the workspace scan and the
// episode id is resolved by exact match against the loaded project's episode ids
// — neither is ever joined into a filesystem path from raw input, so neither can
// traverse outside the work tree. project-io derives the concrete file paths from
// the validated ids, mirroring the `/api/asset` and `/api/lettering` guards.

import { writeTransitions } from "@toony/project-io";
import { type Project, type SequenceItem, type Transition, validateProject } from "@toony/schema";
import { safeErrorMessage } from "@/lib/errors";
import { loadWork } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface SavePayload {
  workId: string;
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
    typeof v.workId === "string" &&
    typeof v.episodeId === "string" &&
    Array.isArray(v.sequence) &&
    Array.isArray(v.transitions)
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
      "request body must be { workId: string, episodeId: string, sequence: array, transitions: array }",
    );
  }
  const { workId, episodeId, sequence, transitions } = payload;

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
      work.root,
      episodeId,
      { ...target.episode, sequence },
      transitions,
      target.cuts,
    );
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the transitions") },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, count: transitions.length });
}
