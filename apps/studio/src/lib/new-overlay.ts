// The seed record for a bubble added in the focused cut editor (#8).
//
// Lives in lib rather than in the editor component so the seeded shape is
// testable under the repo-standard node:test harness (#157), the way the save
// reconciliation is (#150).

import { bubbleKindStyle } from "@toony/render";
import {
  applyLetteringTheme,
  defaultLetteringTextLayout,
  type LetteringOverlay,
  type LetteringTheme,
  resolveReferenceWidth,
} from "@toony/schema";

/**
 * Build a freshly added overlay for `cutId`. Required appearance fields use the kind defaults:
 * `fill` carries the kind's default fill so the new
 * bubble both validates and renders like its kind. The font family is left absent so
 * the renderer resolves its per-kind default; seeding a face here would
 * persist a choice the user never made (#208). New bubbles explicitly opt into
 * width-based text layout and middle alignment. Existing overlays are untouched.
 */
export function newOverlay(
  cutId: string,
  index: number,
  theme?: LetteringTheme,
  referenceWidth = resolveReferenceWidth(undefined),
): LetteringOverlay {
  const bare: LetteringOverlay = {
    id: `ov-${cutId}-${Date.now().toString(36)}-${index}`,
    cutId,
    speaker: "",
    kind: "speech",
    text: "New bubble",
    verticalAlign: "middle",
    textLayout: defaultLetteringTextLayout(referenceWidth),
    textRanges: [],
    fill: bubbleKindStyle("speech").fill,
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.32, y: 0.32, width: 0.36, height: 0.22 },
    overflow: false,
    reviewStatus: "human-edited",
  };
  // The project's lettering theme (#334) seeds a new bubble the way it seeds a
  // compiled one; with no theme the bubble is exactly what it always was.
  return theme === undefined ? bare : applyLetteringTheme(bare, theme);
}
