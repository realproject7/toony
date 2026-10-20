// Turning a dialogue suggestion into lettering, only when the person asks:
// a new bubble of the suggestion's kind, or the text of the selected bubble.

import type { LetteringOverlay } from "@toony/schema";
import { bubbleKindPatch } from "../new-overlay.js";
import { needsSpeaker } from "../speaker.js";
import type { DialogueSuggestion } from "./types.js";

/** A new bubble (from `newOverlay`) carrying the suggestion's kind, speaker and edited text. */
export function suggestionOverlay(
  base: LetteringOverlay,
  option: DialogueSuggestion,
  text: string,
  speakerName?: string,
): LetteringOverlay {
  const kind = option.kind === "silent" ? "speech" : option.kind;
  const shaped = { ...base, ...bubbleKindPatch(base, kind) };
  return {
    ...shaped,
    text,
    textRanges: [],
    speaker: needsSpeaker(kind) ? (speakerName ?? option.speaker ?? "") : "",
  };
}

/** The patch that puts the suggestion's text into an existing bubble, keeping its kind and look. */
export function suggestionReplacePatch(
  overlay: LetteringOverlay,
  option: DialogueSuggestion,
  text: string,
  speakerName?: string,
): Partial<LetteringOverlay> {
  const speaker = speakerName ?? option.speaker;
  return {
    text,
    // Styled ranges point into the old text; a whole new line starts plain.
    ...(overlay.textRanges ? { textRanges: [] } : {}),
    ...(speaker && needsSpeaker(overlay.kind) ? { speaker } : {}),
  };
}
