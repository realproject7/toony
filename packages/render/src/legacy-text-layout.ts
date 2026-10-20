// The explicit text layout that keeps an older overlay's look. An overlay saved
// before text layouts existed auto-fits between 2.2% and 5% of the rendered
// cut's height, with 6% and 8% padding. Converting it with the fixed default
// (20 to 30 reference pixels) shrank large lettering such as sound effects to
// a third of its size. This carries the same fit range and padding into
// reference-width units for the cut's shape, so editing starts from the same
// size and line breaks the person already saw.

import {
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  type LetteringOverlay,
  type LetteringTextLayout,
} from "@toony/schema";
import { bubbleKindStyle } from "./style.js";
import { defaultBubbleFontRange } from "./text.js";

const clampSize = (value: number) =>
  Math.min(FONT_SIZE_MAX_PX, Math.max(FONT_SIZE_MIN_PX, Math.round(value * 10) / 10));

/** A text layout that renders `overlay` as its older layout did on a cut of this size. */
export function legacyTextLayout(
  overlay: Pick<LetteringOverlay, "kind">,
  cut: { width: number; height: number },
  referenceWidth: number,
): LetteringTextLayout {
  const renderHeight = referenceWidth * (cut.height / Math.max(1, cut.width));
  const range = defaultBubbleFontRange(renderHeight);
  const scale = bubbleKindStyle(overlay.kind).fontScale;
  const minFontSize = clampSize(range.minFontSize * scale);
  return {
    version: 1,
    referenceWidth,
    paddingX: 0.06,
    paddingY: 0.08,
    minFontSize,
    maxFontSize: Math.max(minFontSize, clampSize(range.maxFontSize * scale)),
  };
}
