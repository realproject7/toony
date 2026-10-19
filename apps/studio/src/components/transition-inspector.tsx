"use client";

// The transition inspector: the band's kind, height (with the spacing ladder),
// color, text and a few appearance details. Review bookkeeping and notes stay
// in the files for the agent; this panel holds the craft.

import {
  FADE_DIRECTIONS,
  FADE_TYPES,
  type FadeDirection,
  type FadeType,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  MOOD_COLOR_NAMES,
  MOOD_COLORS,
  type MoodColor,
  PANEL_FOLD_SLICE_PX,
  SPACING_PRESET_NAMES,
  SPACING_PRESETS,
  type SpacingPreset,
  TEXT_ALIGNS,
  type TextAlign,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
  VERTICAL_ALIGNS,
  type VerticalAlign,
} from "@toony/schema";
import { transitionLabel } from "@/lib/episode-editing";
import { ColorPicker } from "./color-picker";
import { InspectorNumberField } from "./inspector-number-field";
import { StudioIcon } from "./studio-icon";

const COLOR_AWARE_TYPES = new Set<TransitionType>([
  "black_band",
  "title_card",
  "palette_shift",
  "desaturate_repeat",
  "scene-break",
  "beat",
  "color_field",
  "void",
  "narration_card",
  "dialogue_card",
  "time_card",
]);

/** Text panels honor the text anchoring; legacy cards keep their fixed layout. */
const TEXT_PANEL_TYPES = new Set<TransitionType>(["narration_card", "dialogue_card", "time_card"]);

/** The current kinds first; older kinds stay available under their own group. */
const MAIN_TYPES: TransitionType[] = [
  "gutter",
  "color_field",
  "void",
  "narration_card",
  "dialogue_card",
  "time_card",
];
const OTHER_TYPES = TRANSITION_TYPES.filter((type) => !MAIN_TYPES.includes(type));

const SPACING_LABELS: Record<SpacingPreset, string> = {
  tight: "Tight",
  beat: "Beat",
  cut: "Cut",
  pause: "Pause",
  timeskip: "Time skip",
};

const MOOD_LABELS: Record<MoodColor, string> = {
  "anger-red": "Anger red",
  "calm-blue": "Calm blue",
  "melancholy-desat": "Faded gray",
  "joy-vivid": "Bright joy",
  "dread-black": "Dread black",
  "shock-white": "Shock white",
};

const FADE_LABELS: Record<FadeType, string> = {
  to_black: "Into black",
  to_white: "Into white",
  to_color: "Into the band color",
};

const DIRECTION_LABELS: Record<FadeDirection, string> = {
  top_bottom: "Top to bottom",
  bottom_up: "Bottom to top",
};

const ALIGN_LABELS: Record<TextAlign | VerticalAlign, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};

export function TransitionInspector({
  transition,
  onChange,
  onDelete,
}: {
  transition: Transition;
  onChange: (patch: Partial<Transition>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inspector-form" data-testid="transition-inspector">
      <label className="field">
        <span>Kind</span>
        <select
          value={transition.type}
          onChange={(e) => onChange({ type: e.target.value as TransitionType })}
          data-testid="field-type"
        >
          {MAIN_TYPES.map((type) => (
            <option key={type} value={type}>
              {transitionLabel(type)}
            </option>
          ))}
          <optgroup label="Other styles">
            {OTHER_TYPES.map((type) => (
              <option key={type} value={type}>
                {transitionLabel(type)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <InspectorNumberField
        label="Height"
        value={transition.gutterHeight}
        min={GUTTER_HEIGHT_MIN_PX}
        max={GUTTER_HEIGHT_MAX_PX}
        unit="px"
        testId="field-gutter"
        onCommit={(value) => value !== null && onChange({ gutterHeight: Math.round(value) })}
      />
      <fieldset className="preset-row" data-testid="spacing-presets">
        <legend className="sr-only">Spacing</legend>
        {SPACING_PRESET_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="btn btn-chip"
            aria-pressed={transition.gutterHeight === SPACING_PRESETS[name]}
            onClick={() => onChange({ gutterHeight: SPACING_PRESETS[name] })}
            title={`${SPACING_PRESETS[name]} px`}
            data-testid={`spacing-${name}`}
          >
            {SPACING_LABELS[name]}
          </button>
        ))}
      </fieldset>
      {transition.gutterHeight > PANEL_FOLD_SLICE_PX && (
        <p className="field-hint field-warn" data-testid="slice-warning">
          Taller than {PANEL_FOLD_SLICE_PX} px: on a phone this band spans more than one screen.
        </p>
      )}

      {COLOR_AWARE_TYPES.has(transition.type) && (
        <div className="field">
          <span>Color</span>
          <div className="field-inline">
            <ColorPicker
              label="Band color"
              value={transition.color ?? "#101010"}
              onChange={(hex) => onChange({ color: hex })}
              testId="field-color"
            />
            {transition.color != null && (
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => onChange({ color: null })}
                data-testid="field-color-clear"
              >
                Default
              </button>
            )}
          </div>
          <div className="mood-swatches" data-testid="mood-swatches">
            {MOOD_COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                className="mood-swatch"
                style={{ background: MOOD_COLORS[name] }}
                title={MOOD_LABELS[name]}
                aria-label={MOOD_LABELS[name]}
                onClick={() => onChange({ color: MOOD_COLORS[name] })}
                data-testid={`mood-${name}`}
              />
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>Text</span>
        <textarea
          rows={2}
          value={transition.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value.length > 0 ? e.target.value : null })}
          data-testid="field-text"
        />
      </label>

      {TEXT_PANEL_TYPES.has(transition.type) && (
        <div className="field-row">
          <label className="field">
            <span>Text across</span>
            <select
              value={transition.textAlign ?? "center"}
              onChange={(e) => onChange({ textAlign: e.target.value as TextAlign })}
              data-testid="field-text-align"
            >
              {TEXT_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {ALIGN_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Text down</span>
            <select
              value={transition.verticalAlign ?? "middle"}
              onChange={(e) => onChange({ verticalAlign: e.target.value as VerticalAlign })}
              data-testid="field-vertical-align"
            >
              {VERTICAL_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {ALIGN_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <details className="inspector-disclosure">
        <summary>More appearance</summary>
        {COLOR_AWARE_TYPES.has(transition.type) && (
          <div className="field">
            <span>Gradient</span>
            {transition.gradient ? (
              <>
                <div className="field-row">
                  <ColorPicker
                    label="From"
                    value={transition.gradient.from}
                    onChange={(hex) => {
                      const g = transition.gradient;
                      if (g) onChange({ gradient: { ...g, from: hex } });
                    }}
                    testId="field-gradient-from"
                  />
                  <ColorPicker
                    label="To"
                    value={transition.gradient.to}
                    onChange={(hex) => {
                      const g = transition.gradient;
                      if (g) onChange({ gradient: { ...g, to: hex } });
                    }}
                    testId="field-gradient-to"
                  />
                </div>
                <select
                  aria-label="Gradient direction"
                  value={transition.gradient.direction}
                  onChange={(e) => {
                    const g = transition.gradient;
                    if (g)
                      onChange({ gradient: { ...g, direction: e.target.value as FadeDirection } });
                  }}
                  data-testid="field-gradient-direction"
                >
                  {FADE_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {DIRECTION_LABELS[d]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-chip"
                  onClick={() => onChange({ gradient: null })}
                  data-testid="field-gradient-clear"
                >
                  Remove gradient
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-chip"
                onClick={() =>
                  onChange({
                    gradient: {
                      from: transition.color ?? "#1b2a3a",
                      to: "#0a0a0a",
                      direction: "top_bottom",
                    },
                  })
                }
                data-testid="field-gradient-add"
              >
                <StudioIcon name="plus" /> Add gradient
              </button>
            )}
          </div>
        )}
        <div className="field">
          <span>Fade at the edge</span>
          <select
            aria-label="Fade"
            value={transition.fade?.type ?? ""}
            onChange={(e) => {
              const type = e.target.value;
              if (!type) {
                onChange({ fade: null });
                return;
              }
              const prev = transition.fade;
              onChange({
                fade: {
                  type: type as FadeType,
                  direction: prev?.direction ?? "top_bottom",
                  length: prev?.length ?? Math.max(1, Math.round(transition.gutterHeight * 0.4)),
                },
              });
            }}
            data-testid="field-fade-type"
          >
            <option value="">No fade</option>
            {FADE_TYPES.map((t) => (
              <option key={t} value={t}>
                {FADE_LABELS[t]}
              </option>
            ))}
          </select>
          {transition.fade && (
            <div className="field-row">
              <select
                aria-label="Fade direction"
                value={transition.fade.direction}
                onChange={(e) => {
                  const fade = transition.fade;
                  if (fade)
                    onChange({ fade: { ...fade, direction: e.target.value as FadeDirection } });
                }}
                data-testid="field-fade-direction"
              >
                {FADE_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {DIRECTION_LABELS[d]}
                  </option>
                ))}
              </select>
              <InspectorNumberField
                label="Fade length"
                hideLabel
                value={transition.fade.length}
                min={1}
                max={GUTTER_HEIGHT_MAX_PX}
                unit="px"
                testId="field-fade-length"
                onCommit={(value) => {
                  const fade = transition.fade;
                  if (fade && value !== null)
                    onChange({ fade: { ...fade, length: Math.round(value) } });
                }}
              />
            </div>
          )}
        </div>
        <label className="field">
          <span>Sound effect</span>
          <input
            type="text"
            value={transition.sfx ?? ""}
            onChange={(e) => onChange({ sfx: e.target.value.length > 0 ? e.target.value : null })}
            data-testid="field-sfx"
          />
        </label>
      </details>

      <div className="inspector-actions">
        <button
          type="button"
          className="btn btn-danger"
          onClick={onDelete}
          data-testid="delete-transition"
        >
          <StudioIcon name="trash" /> Remove transition
        </button>
      </div>
    </div>
  );
}
