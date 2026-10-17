// The character registry from Studio (#328): read it with where each character
// is used and whether its reference sheets are on disk, and save it through
// `writeWebtoon`, the surgical writer the registry already has. The registry is
// the single identity every cut, brief cast note and script line keys to, so
// this module never mints a second one: an id is made once from a name and then
// stays.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { encodeJson, loadProject, slugify, writeWebtoon } from "@toony/project-io";
import { type Character, isPathSafeId, type Project, validateProject } from "@toony/schema";

export interface CharacterUse {
  episodeId: string;
  cutId: string;
}

export interface CharacterSheet {
  path: string;
  /** Whether the file is on disk; the page shows a missing one as missing. */
  present: boolean;
}

export interface CharacterRow {
  character: Character;
  uses: CharacterUse[];
  sheets: CharacterSheet[];
}

/** Every cut, across episodes, that names `characterId`. */
export function cutsNaming(project: Project, characterId: string): CharacterUse[] {
  const uses: CharacterUse[] = [];
  for (const bundle of project.episodes) {
    for (const cut of bundle.cuts) {
      if ((cut.characters ?? []).includes(characterId)) {
        uses.push({ episodeId: bundle.episode.id, cutId: cut.id });
      }
    }
  }
  return uses;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The registry with each character's uses and sheets, for the Characters page. */
export async function characterRows(root: string, project: Project): Promise<CharacterRow[]> {
  const rows: CharacterRow[] = [];
  for (const character of project.webtoon.characters ?? []) {
    const sheets: CharacterSheet[] = [];
    for (const path of character.references ?? []) {
      sheets.push({ path, present: await exists(join(root, path)) });
    }
    rows.push({ character, uses: cutsNaming(project, character.id), sheets });
  }
  return rows;
}

/**
 * A new, unique, path-safe id for a character named `name`: the slug of the
 * name, suffixed when the registry already holds it. The id becomes the folder
 * `characters/<id>/` and the key every cut uses, so it is made once and kept.
 */
export function newCharacterId(name: string, existing: readonly string[]): string {
  const base = slugify(name);
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

export interface CharactersPayload {
  workId: string;
  characters: Character[];
}

function isCharacter(value: unknown): value is Character {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.lockstring === "string" &&
    (v.references === undefined ||
      (Array.isArray(v.references) && v.references.every((r) => typeof r === "string")))
  );
}

export function isCharactersPayload(value: unknown): value is CharactersPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workId === "string" && Array.isArray(v.characters) && v.characters.every(isCharacter)
  );
}

/**
 * Save the registry. The whole project is validated with the registry replaced
 * before any byte is written, so a duplicate id, a bad reference path or an id
 * that is not a safe folder name is refused with nothing written. Only
 * `webtoon.json` is written; every episode file stays byte-stable.
 */
export async function saveCharacters(
  root: string,
  characters: readonly Character[],
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  for (const character of characters) {
    if (!isPathSafeId(character.id)) {
      return { ok: false, error: `character id "${character.id}" is not a safe folder name.` };
    }
  }
  const normalized: Character[] = characters.map((c) => {
    const references = (c.references ?? []).map((r) => r.trim()).filter((r) => r !== "");
    return {
      id: c.id.trim(),
      name: c.name.trim(),
      lockstring: c.lockstring.trim(),
      ...(references.length > 0 ? { references } : {}),
    };
  });
  const loaded = await loadProject(root);
  // Compared as the file would be written (sorted keys), so key order in the
  // browser's objects never counts as a change.
  if (encodeJson(loaded.project.webtoon.characters ?? []) === encodeJson(normalized)) {
    return { ok: true, changed: false };
  }
  const webtoon = { ...loaded.project.webtoon, characters: normalized };
  const result = validateProject({ webtoon, episodes: loaded.project.episodes });
  if (!result.valid) {
    const own = result.issues.filter((issue) => issue.path.startsWith("webtoon.characters"));
    const detail = (own.length > 0 ? own : result.issues).map((issue) => issue.message).join(" ");
    return { ok: false, error: `The registry does not validate: ${detail}` };
  }
  await writeWebtoon(root, webtoon);
  return { ok: true, changed: true };
}
