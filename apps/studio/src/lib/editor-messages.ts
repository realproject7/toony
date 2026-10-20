// Save and validation messages in plain words. The save routes answer with the
// project validator's wording ("invalid project after lettering edit:
// episodes[0].lettering[2].speaker: ..."), which names file fields. The editors
// show these sentences instead. Pure, so each mapping is tested.

const RULES: Array<[RegExp, string]> = [
  [/\.speaker\b|speaker must be/i, "Choose who says each dialogue bubble, then save again."],
  [
    /geometry|tail(Target)?\b|tail\./i,
    "A bubble reaches outside the cut. Move it inside, then save again.",
  ],
  [
    /font|style\.|text-ranges|letter|line height|line-height/i,
    "A text style is out of range. Check the bubble's text options.",
  ],
  [/gutter|gutterHeight/i, "A transition height is out of range. Use a height between 0 and 4096."],
  [/transition/i, "A transition setting is not valid. Check the transition and save again."],
  [/sequence/i, "The reading order is not valid. Reload the episode and try again."],
];

/** Whether a save failed because the saved data changed under the editor. */
export function isConflictMessage(text: string): boolean {
  return /changed after you opened it|reload the saved version|artwork changed/i.test(text);
}

/**
 * A message a person can act on. Conflict messages and messages already in
 * plain words pass through; validator output is mapped to a sentence.
 */
export function plainSaveError(text: string): string {
  if (isConflictMessage(text)) return text;
  const technical =
    /invalid project|invalid transitions|episodes\[\d+\]|must be a|request body|unknown (cut|episode|work)/i.test(
      text,
    );
  if (!technical) return text;
  if (/unknown (cut|episode)/i.test(text)) {
    return "This cut or episode is no longer in the project. Reload the episode.";
  }
  for (const [pattern, message] of RULES) {
    if (pattern.test(text)) return message;
  }
  return "Toony could not save this. Undo the last change or reload the episode.";
}
