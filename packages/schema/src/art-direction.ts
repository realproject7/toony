import { type IssueCollector, joinPath } from "./errors.js";
import { isArray, isFiniteNumber, isNonEmptyString, isOneOf, isPlainObject } from "./guards.js";
import type { Character, Cut } from "./types.js";

export const ART_FRAMINGS = ["establishing", "wide", "medium", "close-up", "detail"] as const;
export const SUBJECT_POSITIONS = ["left", "center", "right", "foreground", "background"] as const;

/** Authored visual intent. Coordinates describe desired composition, not proven controls. */
export interface ArtDirection {
  version: 1;
  purpose: string;
  framing: (typeof ART_FRAMINGS)[number];
  camera: string;
  subjects: Array<{
    characterId: string;
    position: (typeof SUBJECT_POSITIONS)[number];
    action: string;
    expression?: string;
    wardrobeId?: string;
    /** Only these visible details reach a detail insert, not a full portrait identity. */
    visibleDetails?: string[];
  }>;
  environment: { setting: string; depth: string; lighting: string };
  style: { linework: string; color: string; shading: string; texture?: string };
  focalPoints: string[];
  lettering: { mode: "none" | "reserved"; regions?: ArtRegion[] };
  protectedRegions?: ArtRegion[];
  continuity?: { fromCutId: string; preserve: string[]; changes?: string[] };
}

export interface ArtRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
}

export interface CharacterDevelopment {
  role: string;
  desire: string;
  flaw: string;
  voice: string;
  arc: string;
}

export interface CharacterWardrobe {
  id: string;
  description: string;
}

function keys(value: Record<string, unknown>, allowed: string[], path: string, c: IssueCollector) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      c.add(joinPath(path, key), "art.unknown-key", `Unknown field: ${key}.`);
}
function text(value: unknown, path: string, c: IssueCollector) {
  if (!isNonEmptyString(value) || value.length > 4000)
    c.add(path, "art.text", "Expected 1 to 4000 characters.");
}
function strings(value: unknown, path: string, c: IssueCollector, allowEmpty = false) {
  if (!isArray(value) || value.length > 32 || (!allowEmpty && value.length === 0)) {
    c.add(path, "art.list", "Expected a bounded list of text entries.");
    return;
  }
  value.forEach((entry, i) => {
    text(entry, joinPath(path, i), c);
  });
}
function textObject(
  value: unknown,
  required: string[],
  optional: string[],
  path: string,
  c: IssueCollector,
) {
  if (!isPlainObject(value)) {
    c.add(path, "art.object", "Expected an object.");
    return;
  }
  keys(value, [...required, ...optional], path, c);
  for (const key of required) text(value[key], joinPath(path, key), c);
  for (const key of optional)
    if (value[key] !== undefined) text(value[key], joinPath(path, key), c);
}
function regions(value: unknown, path: string, c: IssueCollector) {
  if (!isArray(value) || value.length > 16) {
    c.add(path, "art.regions", "Expected at most 16 regions.");
    return;
  }
  value.forEach((r, i) => {
    const p = joinPath(path, i);
    if (!isPlainObject(r)) {
      c.add(p, "art.region", "Expected a rectangle and description.");
      return;
    }
    keys(r, ["x", "y", "width", "height", "description"], p, c);
    text(r.description, joinPath(p, "description"), c);
    const { x, y, width, height } = r;
    if (
      !isFiniteNumber(x) ||
      !isFiniteNumber(y) ||
      !isFiniteNumber(width) ||
      !isFiniteNumber(height) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1 ||
      y + height > 1
    )
      c.add(p, "art.region-bounds", "Region must fit within normalized image bounds.");
  });
}

export function validateArtDirection(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "art.type", "Expected an art direction object.");
    return;
  }
  keys(
    value,
    [
      "version",
      "purpose",
      "framing",
      "camera",
      "subjects",
      "environment",
      "style",
      "focalPoints",
      "lettering",
      "protectedRegions",
      "continuity",
    ],
    path,
    c,
  );
  if (value.version !== 1)
    c.add(joinPath(path, "version"), "art.version", "Art direction version must be 1.");
  text(value.purpose, joinPath(path, "purpose"), c);
  text(value.camera, joinPath(path, "camera"), c);
  if (!isOneOf(value.framing, ART_FRAMINGS))
    c.add(joinPath(path, "framing"), "art.framing", "Unknown shot framing.");
  if (!isArray(value.subjects) || value.subjects.length > 32)
    c.add(joinPath(path, "subjects"), "art.subjects", "Expected at most 32 visible subjects.");
  else {
    const ids = new Set<string>();
    value.subjects.forEach((s, i) => {
      const p = joinPath(joinPath(path, "subjects"), i);
      if (!isPlainObject(s)) {
        c.add(p, "art.subject", "Expected a subject object.");
        return;
      }
      keys(
        s,
        ["characterId", "position", "action", "expression", "wardrobeId", "visibleDetails"],
        p,
        c,
      );
      text(s.characterId, joinPath(p, "characterId"), c);
      text(s.action, joinPath(p, "action"), c);
      if (!isOneOf(s.position, SUBJECT_POSITIONS))
        c.add(joinPath(p, "position"), "art.position", "Unknown subject position.");
      for (const key of ["expression", "wardrobeId"])
        if (s[key] !== undefined) text(s[key], joinPath(p, key), c);
      if (s.visibleDetails !== undefined)
        strings(s.visibleDetails, joinPath(p, "visibleDetails"), c);
      if (typeof s.characterId === "string") {
        if (ids.has(s.characterId))
          c.add(
            p,
            "art.duplicate-subject",
            "A character may appear once in the visible subject list.",
          );
        ids.add(s.characterId);
      }
    });
  }
  textObject(
    value.environment,
    ["setting", "depth", "lighting"],
    [],
    joinPath(path, "environment"),
    c,
  );
  textObject(
    value.style,
    ["linework", "color", "shading"],
    ["texture"],
    joinPath(path, "style"),
    c,
  );
  strings(value.focalPoints, joinPath(path, "focalPoints"), c);
  const l = value.lettering;
  if (!isPlainObject(l))
    c.add(joinPath(path, "lettering"), "art.lettering", "State whether lettering space is needed.");
  else {
    keys(l, ["mode", "regions"], joinPath(path, "lettering"), c);
    if (!isOneOf(l.mode, ["none", "reserved"]))
      c.add(joinPath(path, "lettering"), "art.lettering", "Mode must be none or reserved.");
    if (l.regions !== undefined) regions(l.regions, joinPath(path, "lettering.regions"), c);
    if (l.mode === "reserved" && (!isArray(l.regions) || !l.regions.length))
      c.add(path, "art.lettering-region-required", "Reserved lettering needs at least one region.");
    if (l.mode === "none" && isArray(l.regions) && l.regions.length)
      c.add(
        path,
        "art.silent-space-conflict",
        "A silent cut cannot also reserve lettering regions.",
      );
  }
  if (value.protectedRegions !== undefined)
    regions(value.protectedRegions, joinPath(path, "protectedRegions"), c);
  if (isPlainObject(l) && isArray(l.regions) && isArray(value.protectedRegions)) {
    for (const a of l.regions)
      for (const b of value.protectedRegions) {
        if (
          isPlainObject(a) &&
          isPlainObject(b) &&
          [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(isFiniteNumber)
        ) {
          if (
            Number(a.x) < Number(b.x) + Number(b.width) &&
            Number(b.x) < Number(a.x) + Number(a.width) &&
            Number(a.y) < Number(b.y) + Number(b.height) &&
            Number(b.y) < Number(a.y) + Number(a.height)
          )
            c.add(path, "art.space-conflict", "Lettering space overlaps a protected art region.");
        }
      }
  }
  if (value.continuity !== undefined) {
    const v = value.continuity,
      p = joinPath(path, "continuity");
    if (!isPlainObject(v)) c.add(p, "art.continuity", "Expected a continuity link.");
    else {
      keys(v, ["fromCutId", "preserve", "changes"], p, c);
      text(v.fromCutId, joinPath(p, "fromCutId"), c);
      strings(v.preserve, joinPath(p, "preserve"), c);
      if (v.changes !== undefined) strings(v.changes, joinPath(p, "changes"), c, true);
    }
  }
}

export function validateCharacterCraft(
  value: Record<string, unknown>,
  path: string,
  c: IssueCollector,
): void {
  if (value.visualIdentity !== undefined)
    text(value.visualIdentity, joinPath(path, "visualIdentity"), c);
  if (value.avoid !== undefined) text(value.avoid, joinPath(path, "avoid"), c);
  if (value.lora !== undefined) {
    const lora = value.lora as Record<string, unknown>;
    const ok =
      isPlainObject(lora) &&
      typeof lora.file === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(lora.file) &&
      Object.keys(lora).every((key) => ["file", "strength", "trigger"].includes(key)) &&
      (lora.strength === undefined ||
        (typeof lora.strength === "number" &&
          Number.isFinite(lora.strength) &&
          lora.strength >= 0 &&
          lora.strength <= 2)) &&
      (lora.trigger === undefined ||
        (typeof lora.trigger === "string" && /^[A-Za-z0-9]{1,40}$/.test(lora.trigger)));
    if (!ok)
      c.add(
        joinPath(path, "lora"),
        "character.lora",
        "lora must be {file, strength?, trigger?}: a bare file name, a strength from 0 to 2 and a trigger word of letters and digits.",
      );
  }
  if (value.development !== undefined)
    textObject(
      value.development,
      ["role", "desire", "flaw", "voice", "arc"],
      [],
      joinPath(path, "development"),
      c,
    );
  if (value.wardrobe !== undefined) {
    if (!isArray(value.wardrobe) || value.wardrobe.length > 32)
      c.add(path, "character.wardrobe", "Expected at most 32 outfits.");
    else {
      const ids = new Set<string>();
      value.wardrobe.forEach((outfit, i) => {
        const p = joinPath(joinPath(path, "wardrobe"), i);
        textObject(outfit, ["id", "description"], [], p, c);
        if (isPlainObject(outfit) && typeof outfit.id === "string") {
          if (ids.has(outfit.id))
            c.add(p, "character.duplicate-outfit", "Outfit ids must be unique per character.");
          ids.add(outfit.id);
        }
      });
    }
  }
}

export function artDirectionIssues(
  cut: Cut,
  registry: readonly Character[],
  orderedCuts: readonly Cut[],
): string[] {
  const d = cut.artDirection;
  if (!d) return [];
  const issues: string[] = [];
  const ids = d.subjects.map((s) => s.characterId);
  if (
    cut.characters &&
    (ids.length !== cut.characters.length || ids.some((id) => !cut.characters?.includes(id)))
  )
    issues.push("Visible subjects must match the cut's character list.");
  for (const s of d.subjects) {
    const character = registry.find((c) => c.id === s.characterId);
    if (!character) issues.push(`Unknown character: ${s.characterId}.`);
    else if (s.wardrobeId && !character.wardrobe?.some((w) => w.id === s.wardrobeId))
      issues.push(`Unknown outfit for ${s.characterId}: ${s.wardrobeId}.`);
    if (d.framing === "detail" && !s.visibleDetails?.length)
      issues.push(`Detail framing needs visibleDetails for ${s.characterId}.`);
  }
  if (d.continuity) {
    const before = orderedCuts.findIndex((c) => c.id === d.continuity?.fromCutId);
    const now = orderedCuts.findIndex((c) => c.id === cut.id);
    if (before < 0 || before >= now)
      issues.push("Continuity must reference an earlier cut in this episode.");
    else {
      const previous = orderedCuts[before]?.artDirection;
      for (const s of d.subjects) {
        const was = previous?.subjects.find((p) => p.characterId === s.characterId);
        if (was && was.wardrobeId !== s.wardrobeId && !d.continuity.changes?.length)
          issues.push(`Outfit change for ${s.characterId} needs an explicit continuity change.`);
      }
    }
  }
  return issues;
}
