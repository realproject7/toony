// A character's portrait: one plain picture of them that the engine draws with
// whenever a cut shows them (their reference picture), so every cut keeps the
// same face, hair and clothes. Drawn with the shared generate path's
// `renderImage`, outside any project lock; the caller stores it through the
// write path. Messages never carry absolute paths.
//
// The portrait gate: candidates are drawn with their own seeds and kept in the
// work's private agent files until the agent picks the one that matches the
// character best; only the pick becomes the reference picture.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type RenderImageOptions, renderImage, withCharacterAvoid } from "@toony/generate";
import type { Character } from "@toony/schema";
import { readPrivateBytes, writePrivateFile } from "../agent/storage.js";
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

/** Use another renderer (tests). Returns the previous one. */
export function setPortraitRenderer(renderer: PortraitRenderer): PortraitRenderer {
  const previous = state.toonyPortraitRenderer ?? renderImage;
  state.toonyPortraitRenderer = renderer;
  return previous;
}

/** The prompt a portrait of `character` is drawn with. */
export function portraitPrompt(character: Pick<Character, "lockstring">, extra?: string): string {
  return [character.lockstring.trim(), PORTRAIT_PROMPT, extra?.trim() ?? ""]
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
  };
  const renderer = state.toonyPortraitRenderer ?? renderImage;
  const result = await renderer(root, options, {
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

function candidatesDir(root: string, characterId: string): string {
  return join(root, PORTRAIT_CANDIDATES_DIR, characterId);
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
  const started = now();
  const candidates: PortraitCandidate[] = [];
  let prompt = portraitPrompt(character, extra);
  let failure: string | undefined;
  while (candidates.length < PORTRAIT_CANDIDATES) {
    if (candidates.length > 0 && now() - started > PORTRAIT_CANDIDATES_BUDGET_MS) break;
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
  const dir = candidatesDir(root, character.id);
  await rm(dir, { recursive: true, force: true });
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
  return readPrivateBytes(
    join(candidatesDir(root, characterId), `${seed}.image`),
    CANDIDATE_MAX_BYTES,
  );
}

/** Forget a character's candidates (after one became the portrait). */
export async function clearPortraitCandidates(root: string, characterId: string): Promise<void> {
  await rm(candidatesDir(root, characterId), { recursive: true, force: true });
}
