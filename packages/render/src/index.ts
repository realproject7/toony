// Public API for @toony/render: a framework-agnostic geometry/layout core for
// Toony lettering and transitions. Pure TypeScript — no React, no DOM, no
// canvas. It returns plain geometry DATA (command lists, path strings, point
// triangles, positioned text lines) so the studio SVG preview (#7), the focused
// editor (#8), and the headless canvas export (#10) all consume one source of
// truth and cannot drift. Coordinates in are normalized 0..1 (the schema space);
// coordinates out are in the caller's render pixel space.
//
// See README.md for the full API contract and usage from SVG and canvas.

export type {
  BalloonCommand,
  ImpactDecoration,
  ImpactLine,
  Point,
  TailGeometry,
} from "./geometry.js";
export {
  balloonOutline,
  balloonPathD,
  clamp,
  defaultBalloonRadius,
  IMPACT_BURST_FILL,
  IMPACT_BURST_STROKE,
  IMPACT_RAY_COLOR,
  impactDecoration,
  speechTailGeometry,
} from "./geometry.js";

export type {
  BubbleRender,
  LayoutOptions,
  Rect,
  RenderedTextLine,
} from "./layout.js";
export { cutPlacementFrame, GUTTER_BAND_FRAC, layoutBubble, layoutCut } from "./layout.js";

export { approximateMeasure } from "./measure.js";

export type { BubbleKindStyle } from "./style.js";
export { bubbleKindStyle, kindHasBubble, kindSupportsTail } from "./style.js";

export type {
  BubbleTextLayout,
  BubbleTextOptions,
  MeasureWidth,
} from "./text.js";
export { defaultBubbleFontRange, layoutBubbleText, wrapText } from "./text.js";

export type { TransitionRender, TransitionTreatment } from "./transition.js";
export { layoutTransition } from "./transition.js";
