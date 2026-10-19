"use client";

import type { LetteringTheme } from "@toony/schema";
import { BALLOON_LIBRARY, libraryPreview } from "@/lib/new-overlay";
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
  armed: string | null;
  onArm: (kind: string | null) => void;
  width: number;
  height: number;
  referenceWidth: number;
  theme?: LetteringTheme;
  dialogueLanguage: string;
  gutterBandWidth: number;
}) {
  return (
    <fieldset className="lettering-presets" aria-label="Bubble library">
      <legend>Bubble library</legend>
      {BALLOON_LIBRARY.map(({ id, label }) => (
        <button
          type="button"
          className="btn lettering-preset"
          key={id}
          aria-pressed={armed === id}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(LETTERING_PRESET_MIME, id);
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onArm(armed === id ? null : id)}
          title={`Click then place, or drag ${label.toLowerCase()} onto artwork`}
        >
          <BubbleThumbnail
            plan={libraryPreview(id, {
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
