// A character's portrait: one plain picture of them that the engine draws with
// whenever a cut shows them (their reference picture), so every cut keeps the
// same face, hair and clothes. Drawn with the shared generate path's
// `renderImage`, outside any project lock; the caller stores it through the
// write path. Messages never carry absolute paths.
//
// The portrait gate: candidates are drawn with their own seeds and kept in the
// work's private agent files until the agent picks the one that matches the
// character best; only the pick becomes the reference picture.

import { lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  characterLock,
  type RenderImageOptions,
  renderImage,
  withCharacterAvoid,
} from "@toony/generate";
import { CHARACTER_LORA_STRENGTH, type Character } from "@toony/schema";
import { readPrivateBytes, writePrivateFile } from "../agent/storage.js";
import { AgentError } from "../agent/types.js";
import { redactPaths } from "../redact.js";
import { AGENT_NEGATIVE_BASE } from "./jobs.js";

/** What every portrait asks for: one person, plainly shown, nothing around them. */
export const PORTRAIT_PROMPT =
  "portrait of one person, head and shoulders, facing the viewer, neutral expression, plain light grey background";
const PORTRAIT_NEGATIVE = "multiple people, multiple views, character sheet, border, frame";
/** Tall, at the default workflow's pixel count. */
const PORTRAIT_SIZE = { width: 832, height: 1216 } as const;
/** How many candidates one gate draws. */
export const PORTRAIT_CANDIDATES = 3;
/** No further candidate is started after this long, so the call ends inside the tool timeout. */
export const PORTRAIT_CANDIDATES_BUDGET_MS = 240_000;
/** Where candidates wait for the pick: the work's private agent files, not the project. */
export const PORTRAIT_CANDIDATES_DIR = ".toony/agent/portraits";
const CANDIDATE_MAX_BYTES = 32 * 1024 * 1024;

/** Replaces the engine in tests; the real one draws with the person's engine. */
export type PortraitRenderer = typeof renderImage;
const state = globalThis as typeof globalThis & { toonyPortraitRenderer?: PortraitRenderer };

/** The renderer portraits and training sets are drawn with. */
export function portraitRenderer(): PortraitRenderer {
  return state.toonyPortraitRenderer ?? renderImage;
}

/** Use another renderer (tests). Returns the previous one. */
export function setPortraitRenderer(renderer: PortraitRenderer): PortraitRenderer {
  const previous = state.toonyPortraitRenderer ?? renderImage;
  state.toonyPortraitRenderer = renderer;
  return previous;
}

/** The prompt a portrait of `character` is drawn with (after their LoRA's trigger word). */
export function portraitPrompt(
  character: Pick<Character, "lockstring" | "lora">,
  extra?: string,
): string {
  return [characterLock(character), PORTRAIT_PROMPT, extra?.trim() ?? ""]
    .filter((part) => part !== "")
    .join(", ");
}

/** The negative a portrait of `character` is drawn with: plain picture words, then their avoid tags. */
export function portraitNegative(character: Character): string {
  return withCharacterAvoid(
    `${PORTRAIT_NEGATIVE}, ${AGENT_NEGATIVE_BASE}`,
    [character.id],
    [character],
  );
}

/** Draw one portrait with a new seed. Nothing is written. */
export async function drawPortrait(
  root: string,
  character: Character,
  extra: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ bytes: Uint8Array; seed: number; prompt: string } | { error: string }> {
  const options: RenderImageOptions = {
    prompt: portraitPrompt(character, extra),
    negative: portraitNegative(character),
    ...PORTRAIT_SIZE,
    // A trained character is drawn with their LoRA, so the portrait matches their cuts.
    ...(character.lora
      ? {
          loras: [
            {
              name: character.lora.file,
              strength: character.lora.strength ?? CHARACTER_LORA_STRENGTH,
            },
          ],
        }
      : {}),
  };
  const result = await portraitRenderer()(root, options, {
    cwd: root,
    out: () => {},
    err: () => {},
    env: { ...env },
  });
  if ("error" in result) return { error: redactPaths(result.error) };
  return { bytes: result.bytes, seed: result.seed, prompt: options.prompt };
}

export interface PortraitCandidate {
  seed: number;
  bytes: Uint8Array;
}

const CANDIDATE_FILE = /^\d+\.image$/;

/**
 * A character's candidates folder, walked one part at a time below the work
 * root: a symlink or a file anywhere on the way is refused, so nothing here
 * reads, writes or deletes outside the work. Missing parts are created
 * privately when `create`; otherwise a missing folder is null.
 */
async function candidatesDir(
  root: string,
  characterId: string,
  create: boolean,
): Promise<string | null> {
  let dir = root;
  for (const part of [...PORTRAIT_CANDIDATES_DIR.split("/"), characterId]) {
    dir = join(dir, part);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(dir);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      if (!create) return null;
      await mkdir(dir, { mode: 0o700 });
      info = await lstat(dir);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AgentError("storage", "The work's agent files are not a plain folder.", 500);
    }
  }
  return dir;
}

/** Remove the candidate pictures in `dir`, and nothing else. */
async function removeCandidates(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    if (CANDIDATE_FILE.test(name)) await unlink(join(dir, name));
  }
}

/**
 * Draw up to `PORTRAIT_CANDIDATES` portraits, each with its own seed, and keep
 * them for the pick in place of any earlier ones. Stops starting new ones after
 * `PORTRAIT_CANDIDATES_BUDGET_MS`. An error only when not one was drawn.
 */
export async function drawPortraitCandidates(
  root: string,
  character: Character,
  extra: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  now: () => number = Date.now,
): Promise<
  { candidates: PortraitCandidate[]; prompt: string; failure?: string } | { error: string }
> {
  const dir = (await candidatesDir(root, character.id, true)) as string;
  const started = now();
  const candidates: PortraitCandidate[] = [];
  let prompt = portraitPrompt(character, extra);
  let failure: string | undefined;
  for (let attempt = 0; attempt < PORTRAIT_CANDIDATES; attempt++) {
    if (attempt > 0 && now() - started > PORTRAIT_CANDIDATES_BUDGET_MS) break;
    const drawn = await drawPortrait(root, character, extra, env);
    if ("error" in drawn) {
      failure = drawn.error;
      break;
    }
    prompt = drawn.prompt;
    if (!candidates.some((c) => c.seed === drawn.seed)) {
      candidates.push({ seed: drawn.seed, bytes: drawn.bytes });
    }
  }
  if (candidates.length === 0) return { error: failure ?? "No portrait was drawn." };
  await removeCandidates(dir);
  for (const candidate of candidates) {
    await writePrivateFile(join(dir, `${candidate.seed}.image`), candidate.bytes);
  }
  return { candidates, prompt, ...(failure === undefined ? {} : { failure }) };
}

/** A kept candidate's bytes, or null when no candidate of this character has that seed. */
export async function readPortraitCandidate(
  root: string,
  characterId: string,
  seed: number,
): Promise<Uint8Array | null> {
  const dir = await candidatesDir(root, characterId, false);
  return dir === null ? null : readPrivateBytes(join(dir, `${seed}.image`), CANDIDATE_MAX_BYTES);
}

/** Forget a character's candidates (after one became the portrait). */
export async function clearPortraitCandidates(root: string, characterId: string): Promise<void> {
  const dir = await candidatesDir(root, characterId, false);
  if (dir !== null) await removeCandidates(dir);
}
