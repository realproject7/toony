// A cut's own fields, edited from Studio (#332): the prompt, the negative
// prompt, the characters it names, its shot type, its palette and its declared
// shape. Saving goes through `writeCuts`, the surgical writer `toony generate`
// uses for its write-back, and marks the cut `human-edited`, because a person
// wrote it. The render record (`imageSeed`, `imageWorkflow`) and the image
// reference are never touched here: they say what produced the art on disk, and
// only a render may change them.

import { loadProject, writeCuts } from "@toony/project-io";
import {
  type Cut,
  PANEL_ASPECT_MAX,
  PANEL_ASPECT_MIN,
  SHOT_TYPES,
  type ShotType,
  validateProject,
} from "@toony/schema";

export interface CutFields {
  imagePrompt: string;
  negativePrompt: string;
  characters: string[];
  shotType: ShotType | null;
  palette: string | null;
  panelAspect: number | null;
}

export interface CutFieldsPayload {
  workId: string;
  episodeId: string;
  cutId: string;
  fields: CutFields;
}

/** The editable fields as the cut carries them now. */
export function cutFieldsOf(cut: Cut): CutFields {
  return {
    imagePrompt: cut.imagePrompt,
    negativePrompt: cut.negativePrompt,
    characters: [...(cut.characters ?? [])],
    shotType: cut.shotType ?? null,
    palette: cut.palette ?? null,
    panelAspect: cut.panelAspect ?? null,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isCutFieldsPayload(value: unknown): value is CutFieldsPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.workId !== "string" ||
    typeof v.episodeId !== "string" ||
    typeof v.cutId !== "string"
  ) {
    return false;
  }
  const f = v.fields;
  if (typeof f !== "object" || f === null) return false;
  const fields = f as Record<string, unknown>;
  return (
    typeof fields.imagePrompt === "string" &&
    typeof fields.negativePrompt === "string" &&
    isStringArray(fields.characters) &&
    (fields.shotType === null || SHOT_TYPES.includes(fields.shotType as ShotType)) &&
    (fields.palette === null || typeof fields.palette === "string") &&
    (fields.panelAspect === null || typeof fields.panelAspect === "number")
  );
}

/**
 * The cut with `fields` applied, and the names of the fields that changed.
 * Pure. An unchanged cut comes back as the same object with no changes, so a
 * save that moves nothing writes nothing. Any change marks the cut
 * `human-edited`; the render record and the image reference are copied through.
 */
export function applyCutFields(cut: Cut, fields: CutFields): { next: Cut; changed: string[] } {
  const current = cutFieldsOf(cut);
  const characters = [
    ...new Set(fields.characters.map((id) => id.trim()).filter((id) => id !== "")),
  ];
  const palette =
    fields.palette === null || fields.palette.trim() === "" ? null : fields.palette.trim();
  const changed: string[] = [];
  if (fields.imagePrompt !== current.imagePrompt) changed.push("imagePrompt");
  if (fields.negativePrompt !== current.negativePrompt) changed.push("negativePrompt");
  if (characters.join("\n") !== current.characters.join("\n")) changed.push("characters");
  if (fields.shotType !== current.shotType) changed.push("shotType");
  if (palette !== current.palette) changed.push("palette");
  if (fields.panelAspect !== current.panelAspect) changed.push("panelAspect");
  if (changed.length === 0) return { next: cut, changed };

  const next: Cut = {
    ...cut,
    imagePrompt: fields.imagePrompt,
    negativePrompt: fields.negativePrompt,
    reviewStatus: "human-edited",
  };
  if (characters.length > 0) next.characters = characters;
  else delete next.characters;
  if (fields.shotType !== null) next.shotType = fields.shotType;
  else delete next.shotType;
  if (palette !== null) next.palette = palette;
  else delete next.palette;
  if (fields.panelAspect !== null) next.panelAspect = fields.panelAspect;
  else delete next.panelAspect;
  return { next, changed };
}

/** A path-free reason a field value is refused before the validator sees it. */
export function describeCutFieldsProblem(fields: CutFields): string | null {
  if (
    fields.panelAspect !== null &&
    (!Number.isFinite(fields.panelAspect) ||
      fields.panelAspect < PANEL_ASPECT_MIN ||
      fields.panelAspect > PANEL_ASPECT_MAX)
  ) {
    return `Panel shape must be a number between ${PANEL_ASPECT_MIN} and ${PANEL_ASPECT_MAX}: the cut's height as a multiple of its width.`;
  }
  return null;
}

/**
 * Save one cut's fields. Validates the whole project with the cut replaced
 * before any byte is written, writes only the episode's `cuts.yaml`, and leaves
 * every other file byte-stable.
 */
export async function saveCutFields(
  root: string,
  payload: CutFieldsPayload,
): Promise<{ ok: true; changed: string[] } | { ok: false; error: string }> {
  const problem = describeCutFieldsProblem(payload.fields);
  if (problem !== null) return { ok: false, error: problem };
  const loaded = await loadProject(root);
  const index = loaded.project.episodes.findIndex((b) => b.episode.id === payload.episodeId);
  const bundle = loaded.project.episodes[index];
  if (bundle === undefined) return { ok: false, error: `unknown episode "${payload.episodeId}"` };
  const cutIndex = bundle.cuts.findIndex((c) => c.id === payload.cutId);
  const cut = bundle.cuts[cutIndex];
  if (cut === undefined) return { ok: false, error: `unknown cut "${payload.cutId}"` };

  const { next, changed } = applyCutFields(cut, payload.fields);
  if (changed.length === 0) return { ok: true, changed };

  const cuts = bundle.cuts.map((c, i) => (i === cutIndex ? next : c));
  const candidate = {
    webtoon: loaded.project.webtoon,
    episodes: loaded.project.episodes.map((b, i) => (i === index ? { ...b, cuts } : b)),
  };
  const result = validateProject(candidate);
  if (!result.valid) {
    const prefix = `episodes[${index}].cuts[${cutIndex}]`;
    const own = result.issues.filter((issue) => issue.path.startsWith(prefix));
    const detail = (own.length > 0 ? own : result.issues).map((issue) => issue.message).join(" ");
    return { ok: false, error: `The edit does not validate: ${detail}` };
  }
  await writeCuts(root, payload.episodeId, cuts);
  return { ok: true, changed };
}
