// Public API for @toony/render: a framework-agnostic geometry/layout core for
// Toony lettering and transitions. Pure TypeScript — no React, no DOM, no
// canvas. It returns plain geometry DATA (command lists, path strings, point
// triangles, positioned text lines) so the studio SVG preview (#7), the focused
// editor (#8), and the headless canvas export (#10) all consume one source of
// truth and cannot drift. Coordinates in are normalized 0..1 (the schema space);
// coordinates out are in the caller's render pixel space.
//
// See README.md for the full API contract and usage from SVG and canvas.

// The one Rec. 709 luminance in the repo: the render core's own band-appearance
// buckets and the craft measurement both read a colour with it, and two copies of
// it would be two definitions of what a measured page value means.
export { rec709Luminance } from "./contrast.js";
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
export {
  ARTLESS_CUT_FILL,
  cutPlacementFrame,
  FALLBACK_CUT_ASPECT,
  layoutBubble,
  layoutCut,
} from "./layout.js";
export { approximateMeasure } from "./measure.js";
export type { CutAspectSource, CutImageSize, ResolvedCutAspect } from "./panel-shape.js";
export { cutHeightAt, resolveCutAspect } from "./panel-shape.js";
export type { BubbleKindStyle, CaptionPlate } from "./style.js";
export {
  bubbleKindStyle,
  CAPTION_MIN_CONTRAST,
  kindHasBubble,
  kindSupportsTail,
  resolveCaptionPlate,
} from "./style.js";
export type {
  BubbleTextLayout,
  BubbleTextOptions,
  MeasureWidth,
} from "./text.js";
export {
  defaultBubbleFontRange,
  gutterBubbleMinFontSize,
  layoutBubbleText,
  matchFaceWeight,
  wrapText,
} from "./text.js";

export type {
  BandAppearance,
  BandBackground,
  BandBackgroundSource,
  BandDivider,
  CardTextLayout,
  CardTextLine,
  PanelTextLayout,
  PanelTextLine,
  ResolvedFade,
  ResolvedGradient,
  TransitionRender,
  TransitionTreatment,
} from "./transition.js";
export {
  BAND_FONT_ID,
  BAND_FONT_STACK,
  BAND_PAGE_BACKGROUND_MIN_VALUE,
  BAND_TEXT_MAX_WIDTH_FRAC,
  BAND_VOID_MAX_VALUE,
  bandAppearanceLabel,
  declaredBandAppearance,
  defaultBandBackground,
  drawnBandAppearance,
  GUTTER_MARGIN_FILL,
  layoutCardText,
  layoutPanelText,
  layoutTransition,
  resolveBandBackground,
  resolveBandDivider,
  resolveBandFade,
  resolveBandHeight,
} from "./transition.js";
