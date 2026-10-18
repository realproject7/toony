"use client";

import type { BubbleKind, LetteringTheme } from "@toony/schema";
import { BUBBLE_PRESETS, presetPreviewPlan } from "@/lib/new-overlay";
import { BubbleThumbnail } from "./bubble-thumbnail";

export const LETTERING_PRESET_MIME = "application/x-toony-lettering-preset";

export function LetteringPresets({
  armed,
  onArm,
  width,
  height,
  referenceWidth,
  theme,
  dialogueLanguage,
  gutterBandWidth,
}: {
  armed: BubbleKind | null;
  onArm: (kind: BubbleKind | null) => void;
  width: number;
  height: number;
  referenceWidth: number;
  theme?: LetteringTheme;
  dialogueLanguage: string;
  gutterBandWidth: number;
}) {
  return (
    <fieldset className="lettering-presets" aria-label="Bubble presets">
      {BUBBLE_PRESETS.map(({ kind, label }) => (
        <button
          type="button"
          className="btn lettering-preset"
          key={kind}
          aria-pressed={armed === kind}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(LETTERING_PRESET_MIME, kind);
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onArm(armed === kind ? null : kind)}
          title={`Click then place, or drag ${label.toLowerCase()} onto artwork`}
        >
          <BubbleThumbnail
            plan={presetPreviewPlan(kind, {
              width,
              height,
              referenceWidth,
              theme,
              dialogueLanguage,
              gutterBandWidth,
            })}
          />
          <span>{label}</span>
        </button>
      ))}
    </fieldset>
  );
}
