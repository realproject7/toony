"use client";

import {
  FADE_DIRECTIONS,
  FADE_TYPES,
  type FadeDirection,
  type FadeType,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  MOOD_COLOR_NAMES,
  MOOD_COLORS,
  PANEL_FOLD_SLICE_PX,
  REVIEW_STATUSES,
  type ReviewStatus,
  SPACING_PRESET_NAMES,
  SPACING_PRESETS,
  TEXT_ALIGNS,
  type TextAlign,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
  VERTICAL_ALIGNS,
  type VerticalAlign,
} from "@toony/schema";
import { clamp } from "@/lib/clamp";
import { transitionLabel } from "@/lib/episode-editing";
import { ColorPicker } from "./color-picker";

const COLOR_AWARE_TYPES = new Set<TransitionType>([
  "black_band",
  "title_card",
  "palette_shift",
  "desaturate_repeat",
  "scene-break",
  "beat",
  // v4 interstitial fill panels (#115).
  "color_field",
  "void",
  "narration_card",
  "dialogue_card",
  "time_card",
]);

/**
 * The v4 text-panel kinds (#115) that honor the plan's resolved horizontal +
 * vertical text anchoring, so the editor exposes the H/V align controls only for
 * these (legacy cards keep their fixed centered layout and ignore them).
 */
const TEXT_PANEL_TYPES = new Set<TransitionType>(["narration_card", "dialogue_card", "time_card"]);

function statusChipClass(status: ReviewStatus): string {
  return status === "final"
    ? "chip chip-ok"
    : status === "human-edited"
      ? "chip chip-accent"
      : "chip";
}

export function TransitionInspector({
  transition,
  imageUrl,
  onChange,
  onMarkHumanEdited,
  onDelete,
}: {
  transition: Transition;
  imageUrl: string | null;
  onChange: (patch: Partial<Transition>) => void;
  onMarkHumanEdited: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="inspector-form" data-testid="transition-inspector">
      <div className="inspector-head">
        <h2 className="card-title">Transition</h2>
        <span className={statusChipClass(transition.reviewStatus)} data-testid="inspector-status">
          {transition.reviewStatus}
        </span>
      </div>

      <label className="field">
        <span>Type</span>
        <select
          value={transition.type}
          onChange={(e) => onChange({ type: e.target.value as TransitionType })}
          data-testid="field-type"
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {transitionLabel(type)}
            </option>
          ))}
        </select>
      </label>

      {COLOR_AWARE_TYPES.has(transition.type) && (
        <div className="field">
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
                Clear
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
                title={name}
                aria-label={`Mood color ${name}`}
                onClick={() => onChange({ color: MOOD_COLORS[name] })}
                data-testid={`mood-${name}`}
              />
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>Panel height (px)</span>
        <input
          type="number"
          min={GUTTER_HEIGHT_MIN_PX}
          max={GUTTER_HEIGHT_MAX_PX}
          step={1}
          value={transition.gutterHeight}
          onChange={(e) =>
            onChange({
              // Keep an integer inside the schema's allowed range so the edit
              // always validates; the rhythm preview updates live.
              gutterHeight: clamp(
                Math.round(Number(e.target.value) || 0),
                GUTTER_HEIGHT_MIN_PX,
                GUTTER_HEIGHT_MAX_PX,
              ),
            })
          }
          data-testid="field-gutter"
        />
      </label>

      <div className="field">
        <span>Spacing presets</span>
        <div className="preset-row" data-testid="spacing-presets">
          {SPACING_PRESET_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className="btn btn-chip"
              aria-pressed={transition.gutterHeight === SPACING_PRESETS[name]}
              onClick={() => onChange({ gutterHeight: SPACING_PRESETS[name] })}
              data-testid={`spacing-${name}`}
            >
              {name} · {SPACING_PRESETS[name]}
            </button>
          ))}
        </div>
        {transition.gutterHeight > PANEL_FOLD_SLICE_PX && (
          <span className="field-hint field-warn" data-testid="slice-warning">
            Over {PANEL_FOLD_SLICE_PX}px. This panel will be sliced across the mobile fold and may
            not read as one beat.
          </span>
        )}
      </div>

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
            <span>Text align</span>
            <select
              value={transition.textAlign ?? "center"}
              onChange={(e) => onChange({ textAlign: e.target.value as TextAlign })}
              data-testid="field-text-align"
            >
              {TEXT_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Vertical align</span>
            <select
              value={transition.verticalAlign ?? "middle"}
              onChange={(e) => onChange({ verticalAlign: e.target.value as VerticalAlign })}
              data-testid="field-vertical-align"
            >
              {VERTICAL_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <details className="transition-details">
        <summary>Appearance &amp; details</summary>
        {COLOR_AWARE_TYPES.has(transition.type) && (
          <div className="field">
            <span>Gradient fill</span>
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
                  <select
                    value={transition.gradient.direction}
                    onChange={(e) => {
                      const g = transition.gradient;
                      if (g)
                        onChange({
                          gradient: { ...g, direction: e.target.value as FadeDirection },
                        });
                    }}
                    data-testid="field-gradient-direction"
                  >
                    {FADE_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-chip"
                  onClick={() => onChange({ gradient: null })}
                  data-testid="field-gradient-clear"
                >
                  Clear gradient
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
                + Add gradient
              </button>
            )}
            <span className="field-hint">
              A full-panel vertical gradient fill (overrides the solid color).
            </span>
          </div>
        )}

        <div className="field">
          <span>Fade</span>
          <div className="field-row">
            <select
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
              <option value="">none</option>
              {FADE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {transition.fade && (
              <>
                <select
                  value={transition.fade.direction}
                  onChange={(e) => {
                    const fade = transition.fade;
                    if (!fade) return;
                    onChange({ fade: { ...fade, direction: e.target.value as FadeDirection } });
                  }}
                  data-testid="field-fade-direction"
                >
                  {FADE_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={GUTTER_HEIGHT_MAX_PX}
                  step={1}
                  value={transition.fade.length}
                  onChange={(e) => {
                    const fade = transition.fade;
                    if (!fade) return;
                    onChange({
                      fade: {
                        ...fade,
                        length: clamp(
                          Math.round(Number(e.target.value) || 1),
                          1,
                          GUTTER_HEIGHT_MAX_PX,
                        ),
                      },
                    });
                  }}
                  data-testid="field-fade-length"
                  aria-label="Fade length (px)"
                />
              </>
            )}
          </div>
          <span className="field-hint">
            Blends the panel into a color over the fade length (px).
          </span>
        </div>

        <label className="field">
          <span>SFX</span>
          <input
            type="text"
            value={transition.sfx ?? ""}
            onChange={(e) => onChange({ sfx: e.target.value.length > 0 ? e.target.value : null })}
            data-testid="field-sfx"
          />
        </label>

        <label className="field">
          <span>Agent note</span>
          <textarea
            rows={2}
            value={transition.agentNote ?? ""}
            onChange={(e) =>
              onChange({ agentNote: e.target.value.length > 0 ? e.target.value : null })
            }
            data-testid="field-agent-note"
          />
        </label>

        <label className="field">
          <span>Human note</span>
          <textarea
            rows={2}
            value={transition.humanNote ?? ""}
            onChange={(e) =>
              onChange({ humanNote: e.target.value.length > 0 ? e.target.value : null })
            }
            data-testid="field-human-note"
          />
        </label>

        <label className="field">
          <span>Review status</span>
          <select
            value={transition.reviewStatus}
            onChange={(e) => onChange({ reviewStatus: e.target.value as ReviewStatus })}
            data-testid="field-review"
          >
            {REVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        {transition.image && imageUrl && (
          <div className="field">
            <span>Reference image (not included in output)</span>
            {/* biome-ignore lint/performance/noImgElement: local project reference. */}
            <img className="transition-image-preview" src={imageUrl} alt="Transition reference" />
          </div>
        )}
      </details>

      <div className="inspector-actions">
        <button
          type="button"
          className="btn"
          onClick={onMarkHumanEdited}
          disabled={transition.reviewStatus === "human-edited"}
          data-testid="mark-human-edited"
        >
          Mark human-edited
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onDelete}
          data-testid="delete-transition"
        >
          Delete transition
        </button>
      </div>
    </div>
  );
}
