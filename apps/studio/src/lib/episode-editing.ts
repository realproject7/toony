import {
  IssueCollector,
  type SequenceItem,
  type Transition,
  validateSequenceItemValue,
  validateTransitionValue,
} from "@toony/schema";

export interface EpisodeRhythm {
  sequence: SequenceItem[];
  transitions: Transition[];
}

export function transitionLabel(value: string): string {
  const labels: Record<string, string> = {
    gutter: "Spacing",
    "hard-cut": "Hard cut",
    fade: "Fade",
    beat: "Beat",
    "scene-break": "Scene break",
    "time-skip": "Time skip",
    black_band: "Black band",
    title_card: "Title card",
    palette_shift: "Color shift",
    desaturate_repeat: "Muted band",
    color_field: "Color field",
    void: "Silence",
    narration_card: "Narration",
    dialogue_card: "Dialogue",
    time_card: "Time & place",
  };
  return labels[value] ?? value;
}

export function episodeSelection(sequence: SequenceItem[], value?: string): SequenceItem | null {
  return sequence.find((item) => `${item.type}:${item.id}` === value) ?? sequence[0] ?? null;
}

export function removeEpisodeTransition(state: EpisodeRhythm, id: string): EpisodeRhythm {
  return {
    transitions: state.transitions.filter((item) => item.id !== id),
    sequence: state.sequence.filter((item) => item.type !== "transition" || item.id !== id),
  };
}

/** Recovery keeps the original revision so a stale tab cannot overwrite newer work. */
export function readRhythmDraft(raw: string): (EpisodeRhythm & { revision: string }) | null {
  try {
    if (raw.length > 2_100_000) return null;
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.revision) ||
      !Array.isArray(value.sequence) ||
      !Array.isArray(value.transitions)
    )
      return null;
    const issues = new IssueCollector();
    value.sequence.forEach((item: unknown, i: number) => {
      validateSequenceItemValue(item, `sequence[${i}]`, issues);
    });
    value.transitions.forEach((item: unknown, i: number) => {
      validateTransitionValue(item, `transitions[${i}]`, issues);
    });
    if (!issues.result().valid) return null;
    return value;
  } catch {
    return null;
  }
}
