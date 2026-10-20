// A character's portrait: one plain picture of them that the engine draws with
// whenever a cut shows them (their reference picture), so every cut keeps the
// same face, hair and clothes. Drawn with the shared generate path's
// `renderImage`, outside any project lock; the caller stores it through the
// write path. Messages never carry absolute paths.

import { type RenderImageOptions, renderImage } from "@toony/generate";
import type { Character } from "@toony/schema";
import { redactPaths } from "../redact.js";
import { AGENT_NEGATIVE_BASE } from "./jobs.js";

/** What every portrait asks for: one person, plainly shown, nothing around them. */
export const PORTRAIT_PROMPT =
  "portrait of one person, head and shoulders, facing the viewer, neutral expression, plain light grey background";
const PORTRAIT_NEGATIVE = "multiple people, multiple views, character sheet, border, frame";
/** Tall, at the default workflow's pixel count. */
const PORTRAIT_SIZE = { width: 832, height: 1216 } as const;

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

/** Draw one portrait with a new seed. Nothing is written. */
export async function drawPortrait(
  root: string,
  character: Pick<Character, "lockstring">,
  extra: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ bytes: Uint8Array; seed: number; prompt: string } | { error: string }> {
  const options: RenderImageOptions = {
    prompt: portraitPrompt(character, extra),
    negative: `${PORTRAIT_NEGATIVE}, ${AGENT_NEGATIVE_BASE}`,
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
