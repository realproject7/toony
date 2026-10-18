"use client";

import { layoutBubble } from "@toony/render";
import { BUBBLE_KINDS, type LetteringOverlay } from "@toony/schema";
import { useRef } from "react";
import { BUBBLE_PRESETS, bubbleKindLabel, bubbleKindPatch } from "@/lib/new-overlay";
import { BubbleThumbnail } from "./bubble-thumbnail";

export function BubbleKindPicker({
  overlay,
  width,
  height,
  onChange,
  dialogueLanguage,
  gutterBandWidth,
}: {
  overlay: LetteringOverlay;
  width: number;
  height: number;
  dialogueLanguage: string;
  gutterBandWidth: number;
  onChange: (patch: Partial<LetteringOverlay>) => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const preview = (value: LetteringOverlay) =>
    layoutBubble(
      value.kind === "sfx"
        ? { ...value, text: "Aa", textRanges: [], fontSize: 72 }
        : { ...value, text: "", textRanges: [] },
      width,
      height,
      { dialogueLanguage, gutterBandWidth },
    );
  const change = (kind: LetteringOverlay["kind"]) => {
    onChange(bubbleKindPatch(overlay, kind));
    if (disclosure.current) disclosure.current.open = false;
  };
  return (
    <details className="bubble-kind-picker" ref={disclosure}>
      <summary aria-label={`Bubble type: ${bubbleKindLabel(overlay.kind)}`}>
        <BubbleThumbnail plan={preview(overlay)} />
        <span>
          <small>Bubble type</small>
          <strong>{bubbleKindLabel(overlay.kind)}</strong>
        </span>
        <span className="bubble-kind-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <fieldset className="bubble-kind-options" aria-label="Change bubble type">
        {BUBBLE_PRESETS.map(({ kind, label }) => (
          <button
            type="button"
            className="btn bubble-kind-option"
            key={kind}
            aria-pressed={overlay.kind === kind}
            onClick={() => change(kind)}
            aria-label={`Change to ${label}`}
          >
            <BubbleThumbnail plan={preview({ ...overlay, ...bubbleKindPatch(overlay, kind) })} />
            <span>{label}</span>
          </button>
        ))}
      </fieldset>
      <label className="field bubble-other-types">
        <span>All types</span>
        <select
          value={overlay.kind}
          onChange={(event) => change(event.target.value as LetteringOverlay["kind"])}
          data-testid="field-kind"
        >
          {BUBBLE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {bubbleKindLabel(kind)}
            </option>
          ))}
        </select>
      </label>
    </details>
  );
}
