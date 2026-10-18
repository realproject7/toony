// The seed record for a bubble added in the focused cut editor (#8).
//
// Lives in lib rather than in the editor component so the seeded shape is
// testable under the repo-standard node:test harness (#157), the way the save
// reconciliation is (#150).

import { bubbleKindStyle, kindSupportsTail } from "@toony/render";
import {
  applyLetteringTheme,
  type BubbleKind,
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

/** Presets start with empty literal text and width-based physical proportions. */
export function presetOverlay(
  cutId: string,
  index: number,
  kind: BubbleKind,
  point: { x: number; y: number },
  options: { width: number; height: number; referenceWidth: number; theme?: LetteringTheme },
): LetteringOverlay {
  const base = newOverlay(cutId, index, undefined, options.referenceWidth);
  const width = kind === "sfx" ? 0.42 : kind === "narration" ? 0.34 : 0.38;
  const height = Math.min(
    0.8,
    Math.max(
      0.04,
      (((kind === "narration" ? 100 : 140) / options.referenceWidth) * options.width) /
        options.height,
    ),
  );
  const x = Math.max(0, Math.min(1 - width, point.x - width / 2)),
    y = Math.max(0, Math.min(1 - height, point.y - height / 2));
  const overlay: LetteringOverlay = {
    ...base,
    kind,
    text: "",
    fill: bubbleKindStyle(kind).fill,
    geometry: { x, y, width, height },
    tail: kindSupportsTail(kind)
      ? { x: Math.min(1, x + width * 0.7), y: Math.min(1, y + height + 0.05) }
      : null,
    ...(kind === "narration" ? { cornerRadius: 0 } : {}),
  };
  return options.theme ? applyLetteringTheme(overlay, options.theme) : overlay;
}
