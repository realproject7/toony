// The seed record for a bubble added in the focused cut editor (#8).
//
// Lives in lib rather than in the editor component so the seeded shape is
// testable under the repo-standard node:test harness (#157), the way the save
// reconciliation is (#150).

import { bubbleKindStyle } from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";

/**
 * Build a freshly added overlay for `cutId`. Style fields are seeded only where
 * the schema requires a value: `fill` carries the kind's default fill so the new
 * bubble both validates and renders like its kind. Typography is left ABSENT so
 * the renderer resolves the per-kind default family; seeding a face here would
 * persist a choice the user never made (#208).
 */
export function newOverlay(cutId: string, index: number): LetteringOverlay {
  return {
    id: `ov-${cutId}-${Date.now().toString(36)}-${index}`,
    cutId,
    speaker: "",
    kind: "speech",
    text: "New bubble",
    fill: bubbleKindStyle("speech").fill,
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.32, y: 0.32, width: 0.36, height: 0.22 },
    overflow: false,
    reviewStatus: "human-edited",
  };
}
