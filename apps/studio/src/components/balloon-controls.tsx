"use client";

import { layoutBubble } from "@toony/render";
import { BALLOON_SHAPES, type LetteringOverlay, type TailStyle } from "@toony/schema";
import {
  balloonShapePatch,
  resolvedTailStyle,
  SHAPE_LABELS,
  tailStylePatch,
} from "@/lib/new-overlay";
import { BubbleThumbnail } from "./bubble-thumbnail";

export function BalloonControls({
  overlay,
  onChange,
  width,
  height,
  dialogueLanguage,
  gutterBandWidth,
}: {
  overlay: LetteringOverlay;
  onChange: (patch: Partial<LetteringOverlay>) => void;
  width: number;
  height: number;
  dialogueLanguage: string;
  gutterBandWidth: number;
}) {
  const tailStyle = resolvedTailStyle(overlay);
  return (
    <>
      <fieldset className="field-group balloon-shape-picker">
        <legend>Shape</legend>
        {!overlay.balloonShape && overlay.kind !== "sfx" && (
          <p className="field-hint">Original outline. Choose a shape to update it.</p>
        )}
        <div className="balloon-shape-grid">
          {BALLOON_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="btn balloon-shape-option"
              aria-label={`Shape: ${SHAPE_LABELS[shape]}`}
              aria-pressed={overlay.kind !== "sfx" && overlay.balloonShape === shape}
              onClick={() => onChange(balloonShapePatch(overlay, shape))}
            >
              <BubbleThumbnail
                plan={layoutBubble(
                  { ...overlay, ...balloonShapePatch(overlay, shape), text: "" },
                  width,
                  height,
                  { dialogueLanguage, gutterBandWidth },
                )}
              />
              <span>{SHAPE_LABELS[shape]}</span>
            </button>
          ))}
          <button
            type="button"
            className="btn balloon-shape-option"
            aria-label="Shape: Free text"
            aria-pressed={overlay.kind === "sfx"}
            onClick={() => onChange(balloonShapePatch(overlay, null))}
          >
            <span className="balloon-free-text-icon" aria-hidden="true">
              Aa
            </span>
            <span>Free text</span>
          </button>
        </div>
      </fieldset>
      <fieldset className="field-group balloon-tail-picker" hidden={overlay.kind === "sfx"}>
        <legend>Tail</legend>
        <div className="balloon-tail-options">
          {(
            [
              ["none", "None"],
              ["straight", "Pointer"],
              ["curved", "Curved"],
              ["beads", "Thought dots"],
            ] as const
          ).map(([style, label]) => (
            <button
              type="button"
              className="btn"
              key={style}
              aria-pressed={tailStyle === style}
              aria-label={`Tail: ${label}`}
              onClick={() => onChange(tailStylePatch(overlay, style as TailStyle))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="field-hint">
          {tailStyle === "none"
            ? "No tail. Re-enable to restore its target."
            : "Drag the round handle on the artwork to aim the tail."}
        </p>
        {(tailStyle === "straight" || tailStyle === "curved") && (
          <label className="field field-inline">
            <span>Tail width</span>
            <input
              aria-label="Tail width"
              type="range"
              min={0.04}
              max={0.5}
              step={0.01}
              value={overlay.tailWidth ?? 0.14}
              onChange={(e) => onChange({ tailWidth: Number(e.target.value) })}
            />
            <output>{Math.round((overlay.tailWidth ?? 0.14) * 100)}%</output>
          </label>
        )}
        {tailStyle === "curved" && (
          <label className="field field-inline">
            <span>Tail bend</span>
            <input
              aria-label="Tail bend"
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={overlay.tailBend ?? 0.25}
              onChange={(e) => onChange({ tailBend: Number(e.target.value) })}
            />
            <output>{(overlay.tailBend ?? 0.25).toFixed(2)}</output>
          </label>
        )}
      </fieldset>
    </>
  );
}
