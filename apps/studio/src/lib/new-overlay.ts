// The seed record for a bubble added in the focused cut editor (#8).
//
// Lives in lib rather than in the editor component so the seeded shape is
// testable under the repo-standard node:test harness (#157), the way the save
// reconciliation is (#150).

import { bubbleKindStyle, kindSupportsTail, layoutBubble } from "@toony/render";
import {
  applyLetteringTheme,
  type BalloonShape,
  type BubbleKind,
  defaultLetteringTextLayout,
  type LetteringOverlay,
  type LetteringTheme,
  resolveReferenceWidth,
  type TailStyle,
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
    balloonShape: "oval",
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
      (((kind === "narration" ? 100 : kind === "shout" ? 180 : 168) / options.referenceWidth) *
        options.width) /
        options.height,
    ),
  );
  const x = Math.max(0, Math.min(1 - width, point.x - width / 2)),
    y = Math.max(0, Math.min(1 - height, point.y - height / 2));
  const overlay: LetteringOverlay = {
    ...base,
    kind,
    balloonShape: balloonShapeForKind(kind),
    ...(kind === "shout" ? { tone: "aggressive" as const } : {}),
    text: "",
    fill: bubbleKindStyle(kind).fill,
    geometry: { x, y, width, height },
    tail:
      kind !== "narration" && kindSupportsTail(kind, balloonShapeForKind(kind))
        ? {
            x: Math.min(0.98, x + width * 0.7),
            y: y + height * 1.35 <= 0.98 ? y + height * 1.35 : Math.max(0.02, y - height * 0.35),
          }
        : null,
    ...(kind === "narration" ? { cornerRadius: 0 } : {}),
  };
  return options.theme ? applyLetteringTheme(overlay, options.theme) : overlay;
}

export const BUBBLE_PRESETS: { kind: BubbleKind; label: string }[] = [
  { kind: "speech", label: "Speech" },
  { kind: "thought", label: "Thought" },
  { kind: "shout", label: "Shout" },
  { kind: "whisper", label: "Whisper" },
  { kind: "narration", label: "Narration" },
  { kind: "sfx", label: "Free text" },
];
export const bubbleKindLabel = (kind: BubbleKind) =>
  BUBBLE_PRESETS.find((preset) => preset.kind === kind)?.label ??
  (kind === "beat" ? "Silent beat" : "Ambient");

export function balloonShapeForKind(kind: BubbleKind): BalloonShape | undefined {
  if (kind === "sfx") return undefined;
  return kind === "shout" ? "burst" : kind === "narration" ? "rounded" : "oval";
}

/** An explicit type change keeps authored content, geometry, colors and text styles. */
export function bubbleKindPatch(
  overlay: LetteringOverlay,
  kind: BubbleKind,
): Partial<LetteringOverlay> {
  if (kind === overlay.kind) return {};
  const { x, y, width, height } = overlay.geometry;
  return {
    kind,
    balloonShape: balloonShapeForKind(kind),
    tone: kind === "shout" ? "aggressive" : "neutral",
    cornerRadius: kind === "narration" ? 0 : undefined,
    tail:
      kind !== "narration" && kindSupportsTail(kind, balloonShapeForKind(kind))
        ? (overlay.tail ?? {
            x: Math.min(1, x + width * 0.7),
            y: y + height * 1.35 <= 0.98 ? y + height * 1.35 : Math.max(0.02, y - height * 0.35),
          })
        : null,
    ...(overlay.tailStyle === undefined ? {} : { tailStyle: overlay.tailStyle }),
    tailTarget:
      kindSupportsTail(kind, balloonShapeForKind(kind)) && kind !== "thought"
        ? overlay.tailTarget
        : null,
  };
}

export function presetPreviewPlan(
  kind: BubbleKind,
  options: Parameters<typeof presetOverlay>[4] & {
    dialogueLanguage: string;
    gutterBandWidth: number;
  },
) {
  const overlay = presetOverlay("preview", 0, kind, { x: 0.5, y: 0.4 }, options);
  return layoutBubble(
    { ...overlay, id: `preset-${kind}`, ...(kind === "sfx" ? { text: "Aa", fontSize: 72 } : {}) },
    options.width,
    options.height,
    { dialogueLanguage: options.dialogueLanguage, gutterBandWidth: options.gutterBandWidth },
  );
}

export const SHAPE_LABELS: Record<BalloonShape, string> = {
  oval: "Oval",
  soft: "Soft oval",
  rounded: "Rounded box",
  rectangle: "Rectangle",
  cloud: "Puffy cloud",
  wobble: "Wavering",
  burst: "Burst",
  "burst-box": "Box burst",
  spikes: "Spikes",
  radial: "Radial",
  electric: "Broadcast",
};
interface Preset {
  id: string;
  label: string;
  kind: BubbleKind;
  shape?: BalloonShape;
  tail: TailStyle;
  dark?: boolean;
  borderless?: boolean;
}
export const BALLOON_LIBRARY: readonly Preset[] = [
  { id: "dialogue", label: "Dialogue", kind: "speech", shape: "oval", tail: "straight" },
  { id: "soft-dialogue", label: "Soft dialogue", kind: "speech", shape: "soft", tail: "curved" },
  { id: "floating", label: "No-tail dialogue", kind: "speech", shape: "oval", tail: "none" },
  { id: "thought", label: "Thought", kind: "thought", shape: "oval", tail: "beads" },
  { id: "cloud", label: "Cloud", kind: "thought", shape: "cloud", tail: "none" },
  { id: "wavering", label: "Wavering", kind: "speech", shape: "wobble", tail: "straight" },
  { id: "shout", label: "Shout", kind: "shout", shape: "burst", tail: "straight" },
  { id: "box-shout", label: "Box shout", kind: "shout", shape: "burst-box", tail: "none" },
  { id: "inner-voice", label: "Inner voice", kind: "thought", shape: "radial", tail: "none" },
  {
    id: "dark-voice",
    label: "Dark voice",
    kind: "thought",
    shape: "spikes",
    tail: "none",
    dark: true,
  },
  { id: "whisper", label: "Whisper", kind: "whisper", shape: "oval", tail: "curved" },
  { id: "broadcast", label: "Broadcast", kind: "speech", shape: "electric", tail: "none" },
  { id: "caption", label: "Caption", kind: "narration", shape: "rectangle", tail: "none" },
  {
    id: "dark-caption",
    label: "Dark caption",
    kind: "narration",
    shape: "rounded",
    tail: "none",
    dark: true,
  },
  {
    id: "open-dialogue",
    label: "Borderless",
    kind: "speech",
    shape: "soft",
    tail: "none",
    borderless: true,
  },
  { id: "free-text", label: "Free text", kind: "sfx", tail: "none" },
];

/** Theme typography is retained; an explicitly chosen visual preset owns its body and ink. */
export function libraryOverlay(
  cutId: string,
  index: number,
  presetId: string,
  point: { x: number; y: number },
  options: Parameters<typeof presetOverlay>[4],
): LetteringOverlay {
  const preset = BALLOON_LIBRARY.find((p) => p.id === presetId);
  if (!preset) throw new Error("Unknown balloon preset.");
  const base = presetOverlay(cutId, index, preset.kind, point, options);
  return {
    ...base,
    balloonShape: preset.shape,
    tailStyle: preset.tail,
    tail: preset.tail === "none" ? null : (base.tail ?? defaultTail(base)),
    tailTarget: null,
    tailWidth: 0.14,
    tailBend: 0.25,
    fill: preset.kind === "sfx" ? "transparent" : preset.dark ? "#171717" : "#ffffff",
    border: { width: preset.borderless || preset.kind === "sfx" ? 0 : 2.2, color: "#171717" },
    textColor: preset.dark ? "#ffffff" : "#171717",
    fillGradient: undefined,
    cornerRadius: preset.shape === "rounded" ? 12 : undefined,
    opacity: 1,
  };
}
export function defaultTail(overlay: LetteringOverlay) {
  const { x, y, width, height } = overlay.geometry;
  return {
    x: Math.min(0.98, x + width * 0.68),
    y: y + height * 1.35 <= 0.98 ? y + height * 1.35 : Math.max(0.02, y - height * 0.35),
  };
}
export function resolvedTailStyle(overlay: LetteringOverlay): TailStyle {
  if (overlay.tailStyle) return overlay.tailStyle;
  if (
    (!overlay.tail && !overlay.tailTarget) ||
    !kindSupportsTail(overlay.kind, overlay.balloonShape)
  )
    return "none";
  return overlay.kind === "thought" ? "beads" : "curved";
}
export function tailStylePatch(
  overlay: LetteringOverlay,
  style: TailStyle,
): Partial<LetteringOverlay> {
  return {
    balloonShape: overlay.balloonShape ?? (overlay.kind === "narration" ? "rectangle" : "oval"),
    tailStyle: style,
    // None keeps the aimed point so re-enabling restores the same speaker.
    ...(style !== "none" && !overlay.tail && !overlay.tailTarget
      ? { tail: defaultTail(overlay) }
      : {}),
  };
}
export function libraryPreview(
  presetId: string,
  options: Parameters<typeof presetOverlay>[4] & {
    dialogueLanguage: string;
    gutterBandWidth: number;
  },
) {
  const overlay = libraryOverlay("preview", 0, presetId, { x: 0.5, y: 0.4 }, options);
  return layoutBubble(
    { ...overlay, ...(overlay.kind === "sfx" ? { text: "Aa", fontSize: 72 } : {}) },
    options.width,
    options.height,
    { dialogueLanguage: options.dialogueLanguage, gutterBandWidth: options.gutterBandWidth },
  );
}

/** Canvas coordinates become art-relative targets; a manual aim supersedes off-panel routing. */
export function tailDragPatch(
  point: { x: number; y: number },
  art: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): Partial<LetteringOverlay> {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    tailTarget: null,
    tail: {
      x: clamp((point.x * width - art.x) / art.width),
      y: clamp((point.y * height - art.y) / art.height),
    },
  };
}
