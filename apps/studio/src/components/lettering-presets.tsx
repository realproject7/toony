"use client";

import type { BubbleKind } from "@toony/schema";

const PRESETS: { kind: BubbleKind; label: string; path: string }[] = [
  { kind: "speech", label: "Speech", path: "M4 4h24v16H15l-6 6v-6H4Z" },
  {
    kind: "thought",
    label: "Thought",
    path: "M8 6c-6-1-7 10-1 11 0 6 9 6 10 2 6 3 13-1 10-6 5-6-4-12-8-7-4-5-10-4-11 0ZM8 23h1m-5 4h1",
  },
  {
    kind: "shout",
    label: "Shout",
    path: "m16 2 4 5 8-3-2 8 5 4-7 3 2 8-9-4-7 6-1-8-8-4 7-4-3-7 9 2Z",
  },
  { kind: "whisper", label: "Whisper", path: "M4 4h24v16H15l-6 6v-6H4Z" },
  { kind: "narration", label: "Narration", path: "M3 6h26v18H3Z" },
  { kind: "sfx", label: "Free text", path: "M7 6h20M17 6v20M11 26h12" },
];
export const LETTERING_PRESET_MIME = "application/x-toony-lettering-preset";

export function LetteringPresets({
  armed,
  onArm,
}: {
  armed: BubbleKind | null;
  onArm: (kind: BubbleKind | null) => void;
}) {
  return (
    <fieldset className="lettering-presets" aria-label="Bubble presets">
      {PRESETS.map(({ kind, label, path }) => (
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
          <svg
            width="30"
            height="26"
            viewBox="0 0 34 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
            aria-hidden="true"
            strokeDasharray={kind === "whisper" ? "3 3" : undefined}
          >
            <path d={path} />
          </svg>
          <span>{label}</span>
        </button>
      ))}
    </fieldset>
  );
}
