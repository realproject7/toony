// Dialogue suggestions (TXT-01): short alternative lines the agent offers for a
// cut. They sit beside the art; the person copies, edits or inserts one. They
// are never lettering until the person inserts them. Safe to import in the
// browser: no Node modules here.

export const SUGGESTION_KINDS = ["speech", "thought", "narration", "silent"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** At most this many alternatives per cut. */
export const SUGGESTIONS_MAX = 5;
/** The longest line a suggestion may carry. */
export const SUGGESTION_TEXT_MAX = 200;
/** Lines longer than this are flagged as long for one bubble. */
export const SUGGESTION_LONG = 60;

export interface DialogueSuggestion {
  id: string;
  kind: SuggestionKind;
  /** A cast id for speech and thought. */
  speaker?: string;
  /** The line. Absent for "silent": no line, the art carries the beat. */
  text?: string;
  /** Why this line, in a few words: the intent it serves. */
  note?: string;
}

export type SuggestionFlag = "speaker-not-in-cut" | "unknown-speaker" | "long";

/** What the cut editor shows: the options with their flags, and whether the cut changed since. */
export interface CutSuggestionsView {
  cutId: string;
  createdAt: string;
  /** The cut's scene or cast changed after these were written. */
  stale: boolean;
  options: Array<
    DialogueSuggestion & {
      /** The speaker's name in the cast, when known. */
      speakerName?: string;
      flags: SuggestionFlag[];
    }
  >;
}

export function suggestionFlagLabel(flag: SuggestionFlag): string {
  switch (flag) {
    case "speaker-not-in-cut":
      return "Speaker is not in this cut";
    case "unknown-speaker":
      return "Speaker is not in the cast";
    case "long":
      return "Long for one bubble";
  }
}
