// Who says a bubble. The project's cast is the speaker list; a person can also
// type any other name. Dialogue kinds (speech, thought, shout, whisper) need a
// speaker to save, so a new dialogue bubble starts with a sensible one and the
// editor points at a bubble that still has none before it saves.

import type { BubbleKind, Character, LetteringOverlay } from "@toony/schema";

const UNATTRIBUTED = new Set<BubbleKind>(["narration", "sfx", "beat", "ambient"]);

/** Whether a bubble of this kind must name a speaker. */
export function needsSpeaker(kind: BubbleKind): boolean {
  return !UNATTRIBUTED.has(kind);
}

/**
 * The speaker a new dialogue bubble starts with: the last speaker the person
 * used in this cut editor, else the first character the cut names, else the
 * speaker of the cut's last attributed bubble, else the only cast member.
 * Empty when nothing is known.
 */
export function defaultSpeaker(options: {
  lastUsed?: string | null;
  cutCharacterIds?: readonly string[];
  characters: readonly Character[];
  bubbles: readonly LetteringOverlay[];
}): string {
  const last = options.lastUsed?.trim();
  if (last) return last;
  for (const id of options.cutCharacterIds ?? []) {
    const name = options.characters.find((c) => c.id === id)?.name.trim();
    if (name) return name;
  }
  for (let i = options.bubbles.length - 1; i >= 0; i--) {
    const bubble = options.bubbles[i];
    if (bubble && needsSpeaker(bubble.kind) && bubble.speaker.trim()) return bubble.speaker.trim();
  }
  if (options.characters.length === 1) return options.characters[0]?.name.trim() ?? "";
  return "";
}

/** The first bubble that must name a speaker and does not, or null. */
export function bubbleMissingSpeaker(
  bubbles: readonly LetteringOverlay[],
): LetteringOverlay | null {
  return bubbles.find((b) => needsSpeaker(b.kind) && b.speaker.trim() === "") ?? null;
}

/** Speaker choices: the cut's characters first, then the rest of the cast, by name. */
export function speakerChoices(
  characters: readonly Character[],
  cutCharacterIds: readonly string[] = [],
): string[] {
  const inCut = cutCharacterIds
    .map((id) => characters.find((c) => c.id === id)?.name.trim())
    .filter((name): name is string => Boolean(name));
  const rest = characters.map((c) => c.name.trim()).filter((name) => name && !inCut.includes(name));
  return [...new Set([...inCut, ...rest])];
}
