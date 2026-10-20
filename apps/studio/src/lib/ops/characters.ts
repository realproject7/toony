// The cast, edited one character at a time. `upsertCharacters` merges each
// given character into the registry by id (or adds it), so an edit never
// replaces the whole registry from a stale copy. `removeCharacter` also takes
// the character out of every cut that names it. `setCharacterPortrait` stores a
// drawn portrait and makes it the character's reference picture.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWrite, slugify, writeCuts, writeWebtoon } from "@toony/project-io";
import { detectImageFormat, stripImageMetadata } from "@toony/providers";
import {
  type Character,
  type CharacterDevelopment,
  type CharacterWardrobe,
  isPathSafeId,
  validateProject,
} from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { checkArtworkBytes } from "./artwork.js";
import { OpError } from "./errors.js";
import { assertSafeId, episodeFiles, projectPath } from "./paths.js";
import { type OpContext, withProjectWrite } from "./write.js";

/** One character to add or update. Absent fields keep their saved value. */
export interface CharacterInput {
  /** The id of an existing character to update; absent adds a new one. */
  id?: string;
  name?: string;
  /** The visual description image prompts carry. Defaults to the name for a new character. */
  lockstring?: string;
  visualIdentity?: string | null;
  development?: Partial<CharacterDevelopment> | null;
  wardrobe?: CharacterWardrobe[] | null;
}

export interface SavedCharacter {
  id: string;
  name: string;
  created: boolean;
}

/** A new id from a name: its Latin slug, or `character` for other scripts; numbered when taken. */
export function characterIdFor(name: string, taken: ReadonlySet<string>): string {
  const slug = slugify(name);
  const base = slug === "untitled" ? "character" : slug.slice(0, 48).replace(/-+$/, "");
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

function merge(existing: Character | undefined, input: CharacterInput, id: string): Character {
  const name = (input.name ?? existing?.name ?? "").trim();
  if (name === "") throw new OpError("invalid", "Give every new character a name.");
  const next: Character = {
    ...(existing ?? {}),
    id,
    name,
    lockstring: (input.lockstring ?? existing?.lockstring ?? name).trim() || name,
  };
  if (input.visualIdentity !== undefined) {
    const value = input.visualIdentity?.trim() ?? "";
    if (value === "") delete next.visualIdentity;
    else next.visualIdentity = value;
  }
  if (input.development !== undefined) {
    if (input.development === null) delete next.development;
    else
      next.development = { ...existing?.development, ...input.development } as CharacterDevelopment;
  }
  if (input.wardrobe !== undefined) {
    if (input.wardrobe === null || input.wardrobe.length === 0) delete next.wardrobe;
    else next.wardrobe = input.wardrobe;
  }
  return next;
}

/** Add or update characters by id in one change. */
export async function upsertCharacters(
  ctx: OpContext,
  inputs: readonly CharacterInput[],
): Promise<{ characters: SavedCharacter[]; change: ProjectChange | null }> {
  if (inputs.length === 0) throw new OpError("invalid", "Name at least one character to save.");
  const { result, change } = await withProjectWrite(
    ctx,
    { summary: "Updated the cast", scopes: [{ kind: "characters" }], files: ["webtoon.json"] },
    async (tx) => {
      const registry = [...(tx.before.project.webtoon.characters ?? [])];
      const taken = new Set(registry.map((c) => c.id));
      const saved: SavedCharacter[] = [];
      for (const input of inputs) {
        const index = input.id === undefined ? -1 : registry.findIndex((c) => c.id === input.id);
        if (index !== -1) {
          const existing = registry[index];
          const next = merge(existing, input, existing?.id ?? "");
          registry[index] = next;
          saved.push({ id: next.id, name: next.name, created: false });
          continue;
        }
        if (input.id !== undefined && !isPathSafeId(input.id)) {
          throw new OpError("invalid", `"${input.id}" cannot be a character id.`);
        }
        const id = input.id ?? characterIdFor(input.name ?? "", taken);
        taken.add(id);
        const next = merge(undefined, input, id);
        registry.push(next);
        saved.push({ id, name: next.name, created: true });
      }
      const webtoon = { ...tx.before.project.webtoon, characters: registry };
      const validation = validateProject({ webtoon, episodes: tx.before.project.episodes });
      const own = validation.issues.filter((issue) => issue.path.startsWith("webtoon.characters"));
      if (own.length > 0) {
        const detail = own
          .slice(0, 3)
          .map((issue) => `${issue.path.replace(/^webtoon\./, "")}: ${issue.message}`);
        throw new OpError("invalid", `The cast would not be valid: ${detail.join(" ")}`);
      }
      await writeWebtoon(tx.root, webtoon);
      const created = saved.filter((c) => c.created).map((c) => c.name);
      const updated = saved.filter((c) => !c.created).map((c) => c.name);
      tx.setSummary(
        [
          created.length > 0 ? `Added ${created.join(", ")}` : "",
          updated.length > 0 ? `Updated ${updated.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
      );
      return saved;
    },
  );
  return { characters: result, change };
}

/**
 * Remove a character from the cast and from every cut's character list.
 * Refused while a cut's art direction still places the character, because
 * that framing would no longer make sense.
 */
export async function removeCharacter(
  ctx: OpContext,
  characterId: string,
): Promise<ProjectChange | null> {
  const { change } = await withProjectWrite(
    ctx,
    { summary: "Removed a character", scopes: [{ kind: "characters" }], files: ["webtoon.json"] },
    async (tx) => {
      const registry = tx.before.project.webtoon.characters ?? [];
      const character = registry.find((c) => c.id === characterId);
      if (character === undefined)
        throw new OpError("not-found", "This character is not in the cast.");
      for (const bundle of tx.before.project.episodes) {
        if (
          bundle.cuts.some((cut) =>
            cut.artDirection?.subjects.some((s) => s.characterId === characterId),
          )
        ) {
          throw new OpError(
            "refused",
            `${character.name} is placed in a cut's art direction in ${bundle.episode.title}. Change that cut first.`,
          );
        }
      }
      for (const bundle of tx.before.project.episodes) {
        if (!bundle.cuts.some((cut) => cut.characters?.includes(characterId))) continue;
        const episodeId = bundle.episode.id;
        await tx.track([episodeFiles(episodeId).cuts]);
        tx.addScope({ kind: "episode", episodeId });
        await writeCuts(
          tx.root,
          episodeId,
          bundle.cuts.map((cut) => {
            if (!cut.characters?.includes(characterId)) return cut;
            const rest = cut.characters.filter((id) => id !== characterId);
            const next = { ...cut };
            if (rest.length > 0) next.characters = rest;
            else delete next.characters;
            return next;
          }),
        );
      }
      await writeWebtoon(tx.root, {
        ...tx.before.project.webtoon,
        characters: registry.filter((c) => c.id !== characterId),
      });
      tx.setSummary(`Removed ${character.name} from the cast`);
    },
  );
  return change;
}

/** The prefix of the portraits Toony draws for a character, inside its folder. */
export function portraitPrefix(characterId: string): string {
  return `characters/${characterId}/portrait-`;
}

/**
 * Store a drawn portrait as the character's reference picture: the first of
 * its references, the one every cut that shows them draws with. The file is
 * named by its content, so an undo puts the earlier portrait back exactly.
 * Earlier drawn portraits leave the list; pictures the person added stay after it.
 */
export async function setCharacterPortrait(
  ctx: OpContext,
  characterId: string,
  bytes: Uint8Array,
): Promise<{ path: string; change: ProjectChange | null }> {
  assertSafeId(characterId, "character");
  checkArtworkBytes(bytes);
  const format = detectImageFormat(bytes);
  if (format === null) throw new OpError("invalid", "The portrait is not an image.");
  const clean = stripImageMetadata(bytes, format);
  const digest = createHash("sha256").update(clean).digest("hex").slice(0, 16);
  const extension = format === "jpeg" ? "jpg" : format;
  const path = `${portraitPrefix(characterId)}${digest}.${extension}`;
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Drew a portrait",
      scopes: [{ kind: "characters" }],
      files: ["webtoon.json", path],
    },
    async (tx) => {
      const registry = [...(tx.before.project.webtoon.characters ?? [])];
      const index = registry.findIndex((c) => c.id === characterId);
      const character = registry[index];
      if (character === undefined) {
        throw new OpError("not-found", "This character is not in the cast.");
      }
      const file = projectPath(tx.root, path);
      await mkdir(dirname(file), { recursive: true });
      await atomicWrite(file, clean);
      const others = (character.references ?? []).filter(
        (ref) => ref !== path && !ref.startsWith(portraitPrefix(characterId)),
      );
      registry[index] = { ...character, references: [path, ...others] };
      await writeWebtoon(tx.root, { ...tx.before.project.webtoon, characters: registry });
      tx.setSummary(`Drew a portrait of ${character.name}`);
    },
  );
  return { path, change };
}
