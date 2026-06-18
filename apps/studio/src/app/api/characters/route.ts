// Character-registry write endpoint for the studio editor (issue #102).
//
// The studio is local-first and account-free: this route is the server write
// path the cut editor's character-registry UI uses to persist the project's
// `webtoon.characters` list (id/name/lockstring) AND a cut's `cut.characters`
// assignment. It resolves the posted `workId` to a work directory PATH-SAFELY
// against the workspace scan, loads that work's project, replaces the webtoon's
// character registry and (optionally) one cut's character refs, validates the
// resulting project with `@toony/schema`, then writes only the two affected
// files — `webtoon.json` (registry) and, when a cut assignment is included, that
// episode's `cuts.yaml` — deterministically through project-io. Invalid edits are
// rejected and nothing is written.
//
// Path safety: the work id is matched exactly against the workspace scan and the
// episode/cut ids are resolved by exact match against the loaded project — none
// is ever joined into a filesystem path from raw input, so none can traverse
// outside the work tree. project-io derives the concrete file paths from the
// validated ids, mirroring `/api/cut` and `/api/lettering`.

import { writeCuts, writeWebtoon } from "@toony/project-io";
import { type Character, type Project, validateProject, type Webtoon } from "@toony/schema";
import { safeErrorMessage } from "@/lib/errors";
import { loadWork } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * One cut's character assignment, applied alongside the registry write so the
 * editor can save "define character + assign to this cut" in a single request.
 */
interface CutAssignment {
  episodeId: string;
  cutId: string;
  characters: string[];
}

interface SavePayload {
  workId: string;
  characters: Character[];
  /** Optional: also set one cut's `characters` refs in the same transaction. */
  assignment?: CutAssignment;
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** A `{id, name, lockstring}` with all three present as strings. */
function isCharacter(value: unknown): value is Character {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string" && typeof v.lockstring === "string";
}

function isAssignment(value: unknown): value is CutAssignment {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.episodeId === "string" &&
    typeof v.cutId === "string" &&
    Array.isArray(v.characters) &&
    v.characters.every((id) => typeof id === "string")
  );
}

function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.workId !== "string") return false;
  if (!Array.isArray(v.characters) || !v.characters.every(isCharacter)) return false;
  if (v.assignment !== undefined && !isAssignment(v.assignment)) return false;
  return true;
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
      "request body must be { workId: string, characters: {id,name,lockstring}[], assignment?: { episodeId, cutId, characters[] } }",
    );
  }
  const { workId, characters, assignment } = payload;

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

  // Replace the registry; drop the field entirely when empty so a cleared
  // registry round-trips as "no characters" rather than an empty array.
  const nextWebtoon: Webtoon = { ...loaded.project.webtoon };
  if (characters.length > 0) {
    nextWebtoon.characters = characters;
  } else {
    delete nextWebtoon.characters;
  }

  // Resolve an optional cut assignment by exact id match — never join raw input
  // into a path.
  let bundleIndex = -1;
  let nextCuts: Project["episodes"][number]["cuts"] | null = null;
  if (assignment) {
    bundleIndex = loaded.project.episodes.findIndex(
      (bundle) => bundle.episode.id === assignment.episodeId,
    );
    if (bundleIndex === -1) {
      return badRequest(`unknown episode "${assignment.episodeId}"`);
    }
    const bundle = loaded.project.episodes[bundleIndex];
    if (!bundle?.cuts.some((cut) => cut.id === assignment.cutId)) {
      return badRequest(`unknown cut "${assignment.cutId}" in episode "${assignment.episodeId}"`);
    }
    nextCuts = bundle.cuts.map((cut) =>
      cut.id === assignment.cutId
        ? assignment.characters.length > 0
          ? { ...cut, characters: assignment.characters }
          : (({ characters: _drop, ...rest }) => rest)(cut)
        : cut,
    );
  }

  // Build the candidate project and validate it fully before any bytes are
  // written, so a malformed registry or assignment is rejected atomically.
  const candidate: Project = {
    webtoon: nextWebtoon,
    episodes:
      nextCuts && bundleIndex !== -1
        ? loaded.project.episodes.map((bundle, index) =>
            index === bundleIndex ? { ...bundle, cuts: nextCuts } : bundle,
          )
        : loaded.project.episodes,
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const detail = result.issues
      .filter(
        (issue) =>
          issue.path.startsWith("webtoon.characters") ||
          (bundleIndex !== -1 && issue.path.startsWith(`episodes[${bundleIndex}].cuts`)),
      )
      .map((issue) => `${issue.path}: ${issue.message}`);
    const message =
      detail.length > 0
        ? `invalid characters: ${detail.join("; ")}`
        : `invalid project after edit: ${result.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`;
    return badRequest(message);
  }

  try {
    await writeWebtoon(work.root, nextWebtoon);
    if (nextCuts && assignment) {
      await writeCuts(work.root, assignment.episodeId, nextCuts);
    }
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the characters") },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
