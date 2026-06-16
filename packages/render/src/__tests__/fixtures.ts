// Deterministic fixtures for render-core tests: realistic schema records with
// normalized 0..1 geometry covering speech (tailed), narration (tailless),
// and SFX (bare text) kinds.

import type { BubbleBorder, LetteringOverlay, NormalizedPoint, Transition } from "@toony/schema";

export function overlay(
  partial: Partial<LetteringOverlay> & Pick<LetteringOverlay, "id">,
): LetteringOverlay {
  return {
    cutId: "cut-001",
    speaker: "",
    kind: "speech",
    text: "Hello there",
    font: "system",
    fill: "",
    opacity: 1,
    border: null as BubbleBorder | null,
    tail: null as NormalizedPoint | null,
    geometry: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
    overflow: false,
    reviewStatus: "draft",
    ...partial,
  };
}

export const speechOverlay = overlay({
  id: "ov-speech",
  kind: "speech",
  speaker: "Mina",
  text: "We need to move before sunrise.",
  geometry: { x: 0.08, y: 0.06, width: 0.42, height: 0.22 },
  tail: { x: 0.34, y: 0.42 },
});

export const narrationOverlay = overlay({
  id: "ov-narration",
  kind: "narration",
  text: "The city had been quiet for days.",
  geometry: { x: 0.05, y: 0.78, width: 0.9, height: 0.16 },
  tail: null,
});

export const sfxOverlay = overlay({
  id: "ov-sfx",
  kind: "sfx",
  text: "BOOM",
  geometry: { x: 0.6, y: 0.3, width: 0.3, height: 0.12 },
  tail: null,
});

export function transition(partial: Partial<Transition> & Pick<Transition, "id">): Transition {
  return {
    type: "gutter",
    gutterHeight: 48,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
    ...partial,
  };
}
