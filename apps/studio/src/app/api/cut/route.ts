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
import { type Cut, type Project, SHOT_TYPES, type ShotType, validateProject } from "@toony/schema";
import { safeErrorMessage } from "@/lib/errors";
import { loadWork } from "@/lib/project";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Optional craft metadata (#98) the editor may set alongside the prompts. Each is
 * absent → leave the cut's current value untouched; null/"" → clear the field; a
 * value → set it. Carried in one payload so the cut panel saves in one request.
 */
interface CraftPayload {
  shotType?: ShotType | null;
  palette?: string | null;
  layer?: string | null;
  styleTag?: string | null;
}

interface SavePayload extends CraftPayload {
  workId: string;
  episodeId: string;
  cutId: string;
  // Prompts are OPTIONAL: the prompt panel sends them, the craft panel omits them
  // (so saving craft never clobbers the cut's prompts). Absent → preserve.
  imagePrompt?: string;
  negativePrompt?: string;
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** A craft string field is valid when absent, null, or a string. */
function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.workId !== "string" ||
    typeof v.episodeId !== "string" ||
    typeof v.cutId !== "string"
  ) {
    return false;
  }
  // Prompts are optional; when present each must be a string.
  if (v.imagePrompt !== undefined && typeof v.imagePrompt !== "string") return false;
  if (v.negativePrompt !== undefined && typeof v.negativePrompt !== "string") return false;
  // Craft metadata is optional; the full schema validator still runs below, so
  // this is only a coarse shape guard.
  if (
    v.shotType !== undefined &&
    v.shotType !== null &&
    !SHOT_TYPES.includes(v.shotType as ShotType)
  ) {
    return false;
  }
  return isOptionalString(v.palette) && isOptionalString(v.layer) && isOptionalString(v.styleTag);
}

/**
 * Apply the craft fields to a cut: a non-empty value sets it, while null/""/
 * absent deletes it so a cleared control round-trips as "no value" (sparse on
 * disk, matching how the renderer treats absent metadata).
 */
function applyCraft(cut: Cut, payload: CraftPayload): Cut {
  const next: Cut = { ...cut };
  for (const key of ["shotType", "palette", "layer", "styleTag"] as const) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.length === 0)
    ) {
      delete next[key];
    } else {
      // Narrowed by the payload guard: shotType is a ShotType, the rest strings.
      (next[key] as string) = value as string;
    }
  }
  return next;
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
      "request body must be { workId, episodeId, cutId, imagePrompt, negativePrompt, shotType?, palette?, layer?, styleTag? }",
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
    return Response.json({ ok: false, error: safeErrorMessage(cause) }, { status: 500 });
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

  // Replace only this cut's prompt + craft fields; every other cut and field is
  // left exactly as loaded so the round-trip preserves image refs and ordering.
  // Absent prompts are preserved (the craft panel omits them).
  const nextCuts = bundle.cuts.map((cut) => {
    if (cut.id !== cutId) return cut;
    const withPrompts: typeof cut = {
      ...cut,
      ...(imagePrompt !== undefined ? { imagePrompt } : {}),
      ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    };
    return applyCraft(withPrompts, payload);
  });

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
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not save the cut") },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
