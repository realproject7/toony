// Plain export defaults (#154), with no Node/canvas imports.
//
// The Node-only export engine imports these, AND the Studio's browser client
// single-sources them via "@toony/export/defaults", a module with no runtime
// dependencies, so a client bundle does NOT drag in `@napi-rs/canvas` or
// `node:fs`. Exactly one defining site.

import type { ExportOptionValues, ExportTargetKind, SocialFrameId } from "@toony/schema";

/** Default width of each cut image, in px. */
export const CUTS_DEFAULT_WIDTH = 1200;
/** Legacy fixed width used by geometry planning. The strip itself uses referenceWidth. */
export const STITCHED_DEFAULT_WIDTH = 1200;

/** Default lossy encode quality (0..100) for JPEG. */
export const DEFAULT_JPEG_QUALITY = 82;

/** Background behind cut images, social frames and strip pixels with alpha. */
export const EXPORT_BACKGROUND = "#ffffff";

/**
 * The legibility floor for fitting a tall cut whole into a social frame: the
 * composed width divided by the project's reference column. Lettering is
 * authored on that column, so below this ratio it reads too small and the cut is
 * split into rows instead.
 */
export const SOCIAL_FIT_MIN_SCALE = 0.6;

/** Safe insets in px at frame size, kept clear of content. */
export interface FrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A fixed frame the social engine lays an episode out on. */
export interface SocialFrame {
  id: SocialFrameId;
  label: string;
  width: number;
  height: number;
  safe: FrameInsets;
  /** Most images one post can carry; files are grouped into posts of this size. */
  imagesPerPost: number;
}

export const SOCIAL_FRAMES: Readonly<Record<SocialFrameId, SocialFrame>> = {
  "instagram-portrait": {
    id: "instagram-portrait",
    label: "Instagram 4:5",
    width: 1080,
    height: 1350,
    safe: { top: 54, right: 54, bottom: 54, left: 54 },
    imagesPerPost: 20,
  },
  "instagram-square": {
    id: "instagram-square",
    label: "Instagram 1:1",
    width: 1080,
    height: 1080,
    safe: { top: 54, right: 54, bottom: 54, left: 54 },
    imagesPerPost: 20,
  },
  "x-landscape": {
    id: "x-landscape",
    label: "X 16:9",
    width: 1600,
    height: 900,
    safe: { top: 45, right: 80, bottom: 45, left: 80 },
    imagesPerPost: 4,
  },
};

/** A built-in output: what `toony export --output <id>` and the Studio list run. */
export interface BuiltinOutput {
  id: string;
  kind: ExportTargetKind;
  /** Options the output pins; an explicit caller option overrides them. */
  options: ExportOptionValues;
}

/** The built-in outputs, in the order people see them. */
export const BUILTIN_OUTPUTS: readonly BuiltinOutput[] = [
  { id: "strip", kind: "strip", options: {} },
  { id: "cuts", kind: "cuts", options: {} },
  { id: "instagram", kind: "social", options: { frame: "instagram-portrait" } },
  { id: "instagram-square", kind: "social", options: { frame: "instagram-square" } },
  { id: "x", kind: "social", options: { frame: "x-landscape" } },
  {
    id: "webtoon",
    kind: "strip",
    options: { width: 800, sliceHeight: 1280, format: "jpeg", quality: 90 },
  },
];

/** Earlier output names that still select a built-in output. */
export const OUTPUT_ALIASES: Readonly<Record<string, string>> = {
  stitched: "strip",
  platform: "cuts",
};

/** The built-in output whose folder a social frame writes to by default. */
export function socialOutputForFrame(frame: SocialFrameId): string {
  return (
    BUILTIN_OUTPUTS.find((output) => output.kind === "social" && output.options.frame === frame)
      ?.id ?? frame
  );
}
