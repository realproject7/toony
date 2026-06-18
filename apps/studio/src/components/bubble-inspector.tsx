"use client";

// Pro-lettering inspector for the focused cut editor (issue #55).
//
// This is the editor-only control surface for ONE selected bubble: typography
// (font family, size, weight, line-height, alignment, letter-spacing), color
// (text / fill / border via the lightweight ColorPicker + fill opacity), bubble
// styling (border width, corner radius, tail), arrangement (z-order, nudge), and
// review status. Every control binds to a `LetteringOverlay` field defined by the
// #54/#56 schema and the bounds it ships; nothing here invents geometry — the
// canvas continues to render through `@toony/render`. It lives in its own module
// so the editor route can lazy-load it (and its ColorPicker dependency) as an
// editor-only chunk, keeping the library/reader bundles lean.
//
// Persistence note (from the schema's LETTERING_STYLE_DEFAULTS doc): a style
// field is written only when the user actually changes it. Each control therefore
// shows the resolved default as its starting value but only sets the field on
// interaction — it never bakes a default onto a bubble that never had one.

import { defaultFontFamilyForKind, FONT_FAMILIES, type FontFamilyId } from "@toony/fonts";
import { kindSupportsTail } from "@toony/render";
import {
  BUBBLE_KINDS,
  BUBBLE_TONES,
  type BubbleKind,
  type BubbleTone,
  CORNER_RADIUS_MAX_PX,
  CORNER_RADIUS_MIN_PX,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_WEIGHTS,
  type FontWeight,
  LETTER_SPACING_MAX_EM,
  LETTER_SPACING_MIN_EM,
  LETTERING_STYLE_DEFAULTS,
  type LetteringOverlay,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  PLACEMENT_SIDES,
  PLACEMENTS,
  type Placement,
  type PlacementSide,
  REVIEW_STATUSES,
  type ReviewStatus,
  SFX_MODES,
  type SfxMode,
  TEXT_ALIGNS,
  type TextAlign,
} from "@toony/schema";
import { clamp } from "@/lib/clamp";
import { ColorPicker } from "./color-picker";

/** Font-size quick presets (px), within the schema's 6..200 bounds. */
const SIZE_PRESETS = [16, 24, 32, 48, 64] as const;
/** Per-weight human labels for the weight selector. */
const WEIGHT_LABELS: Record<FontWeight, string> = {
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
};

export interface BubbleInspectorProps {
  overlay: LetteringOverlay;
  overflow: boolean;
  onChange: (patch: Partial<LetteringOverlay>) => void;
  /** z-order helpers wired by the editor (re-stack the selected bubble). */
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  /** Nudge the selected bubble by the given normalized delta. */
  onNudge: (dx: number, dy: number) => void;
  /** Distinct colors used by other bubbles in this cut (the project palette). */
  projectPalette: readonly string[];
}

export function BubbleInspector({
  overlay,
  overflow,
  onChange,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onNudge,
  projectPalette,
}: BubbleInspectorProps) {
  const supportsTail = kindSupportsTail(overlay.kind);

  // Resolved-for-display values: show the renderer's effective default until the
  // user sets the field, but only write the field on an explicit change.
  const fontSize = overlay.fontSize ?? null;
  const fontWeight: FontWeight = overlay.fontWeight ?? LETTERING_STYLE_DEFAULTS.fontWeight;
  const lineHeight = overlay.lineHeight ?? LETTERING_STYLE_DEFAULTS.lineHeight;
  const textAlign: TextAlign = overlay.textAlign ?? LETTERING_STYLE_DEFAULTS.textAlign;
  const letterSpacing = overlay.letterSpacing ?? LETTERING_STYLE_DEFAULTS.letterSpacing;
  const textColor = overlay.textColor ?? LETTERING_STYLE_DEFAULTS.textColor;
  const zIndex = overlay.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex;
  // v3 craft fields (#93/#98/#99): show the renderer's effective default until
  // the user sets the field. tone → "neutral"; placement → "in_panel" with side
  // "right"; sfxMode → "typeset" (only meaningful for kind=sfx).
  const tone: BubbleTone = overlay.tone ?? "neutral";
  const placement: Placement = overlay.placement ?? "in_panel";
  const placementSide: PlacementSide = overlay.placementSide ?? "right";
  const sfxMode: SfxMode = overlay.sfxMode ?? "typeset";
  const isSfx = overlay.kind === "sfx";
  const NUDGE = 0.01;

  return (
    <div className="inspector-form" data-testid="bubble-inspector">
      <h2 className="card-title">Bubble</h2>

      {overflow && (
        <div className="editor-toast editor-toast-warn" data-testid="inspector-overflow">
          Text overflows this bubble even at the minimum font. Enlarge the box or shorten the text.
        </div>
      )}

      <label className="field">
        <span>Speaker</span>
        <input
          type="text"
          value={overlay.speaker}
          onChange={(e) => onChange({ speaker: e.target.value })}
          data-testid="field-speaker"
        />
      </label>

      <label className="field">
        <span>Kind</span>
        <select
          value={overlay.kind}
          onChange={(e) => {
            const kind = e.target.value as BubbleKind;
            const patch: Partial<LetteringOverlay> = { kind };
            // A kind that cannot carry a tail drops any existing tail point.
            if (!kindSupportsTail(kind)) patch.tail = null;
            onChange(patch);
          }}
          data-testid="field-kind"
        >
          {BUBBLE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Text</span>
        <textarea
          rows={3}
          value={overlay.text}
          onChange={(e) => onChange({ text: e.target.value })}
          data-testid="field-text"
        />
      </label>

      {/* --- Craft (#93/#98/#99) -------------------------------------------- */}
      <fieldset className="field-group" data-testid="group-craft">
        <legend>Craft</legend>

        <div className="field">
          <span>Tone</span>
          <div className="chip-row">
            {BUBBLE_TONES.map((value) => (
              <button
                key={value}
                type="button"
                className={tone === value ? "btn btn-chip btn-chip-active" : "btn btn-chip"}
                aria-pressed={tone === value}
                // tone refines the outline SHAPE (scalloped/jagged); the renderer
                // reads it from the overlay. "neutral" clears the override.
                onClick={() => onChange({ tone: value })}
                data-testid={`field-tone-${value}`}
              >
                {value}
              </button>
            ))}
          </div>
          <span className="field-hint">Refines the bubble silhouette to encode emotion.</span>
        </div>

        {isSfx && (
          <label className="field">
            <span>SFX mode</span>
            <select
              value={sfxMode}
              onChange={(e) => onChange({ sfxMode: e.target.value as SfxMode })}
              data-testid="field-sfx-mode"
            >
              {SFX_MODES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="field">
          <span>Placement</span>
          <div className="chip-row">
            {PLACEMENTS.map((value) => (
              <button
                key={value}
                type="button"
                className={placement === value ? "btn btn-chip btn-chip-active" : "btn btn-chip"}
                aria-pressed={placement === value}
                onClick={() => onChange({ placement: value })}
                data-testid={`field-placement-${value}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {placement === "gutter" && (
          <div className="field">
            <span>Gutter side</span>
            <div className="chip-row">
              {PLACEMENT_SIDES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    placementSide === value ? "btn btn-chip btn-chip-active" : "btn btn-chip"
                  }
                  aria-pressed={placementSide === value}
                  onClick={() => onChange({ placementSide: value })}
                  data-testid={`field-placement-side-${value}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="field-hint">
              The bubble sits in a reserved strip on this side; its tail crosses into the art via
              the off-panel target below.
            </span>
          </div>
        )}

        {/* Off-panel speaker target (#93): an art-space point that MAY lie outside
            [0,1] (the speaker is off-panel). Editable as two numbers; the toggle
            adds/clears it. */}
        <div className="field">
          <span>Off-panel tail target</span>
          {overlay.tailTarget ? (
            <>
              <div className="field-inline">
                <label className="field-inline">
                  <span>x</span>
                  <input
                    type="number"
                    step={0.05}
                    value={overlay.tailTarget.x}
                    onChange={(e) =>
                      onChange({
                        tailTarget: {
                          x: Number(e.target.value),
                          y: overlay.tailTarget?.y ?? 0,
                        },
                      })
                    }
                    data-testid="field-tail-target-x"
                  />
                </label>
                <label className="field-inline">
                  <span>y</span>
                  <input
                    type="number"
                    step={0.05}
                    value={overlay.tailTarget.y}
                    onChange={(e) =>
                      onChange({
                        tailTarget: {
                          x: overlay.tailTarget?.x ?? 0,
                          y: Number(e.target.value),
                        },
                      })
                    }
                    data-testid="field-tail-target-y"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => onChange({ tailTarget: null })}
                data-testid="field-tail-target-clear"
              >
                Clear target
              </button>
              <span className="field-hint">
                Art-space point; may lie outside 0–1 for an off-panel speaker. The drawn tip clamps
                to the art edge.
              </span>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-chip"
              onClick={() => onChange({ tailTarget: { x: -0.1, y: 0.5 } })}
              data-testid="field-tail-target-add"
            >
              Add off-panel target
            </button>
          )}
        </div>
      </fieldset>

      {/* --- Typography ------------------------------------------------------ */}
      <fieldset className="field-group" data-testid="group-typography">
        <legend>Typography</legend>

        <label className="field">
          <span>Font family</span>
          <select
            value={overlay.fontFamily ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              // Empty option clears the override so the bubble resolves to the
              // per-kind default family (back-compatible with overlays that never
              // set one). A non-empty value is always a curated family id.
              onChange({ fontFamily: value === "" ? undefined : (value as FontFamilyId) });
            }}
            data-testid="field-font-family"
          >
            <option value="">Default ({defaultFontFamilyForKind(overlay.kind)})</option>
            {FONT_FAMILIES.map((family) => (
              <option key={family.id} value={family.id} style={{ fontFamily: family.stack }}>
                {family.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Size</span>
          <div className="field-inline">
            <input
              type="number"
              min={FONT_SIZE_MIN_PX}
              max={FONT_SIZE_MAX_PX}
              step={1}
              value={fontSize ?? ""}
              placeholder="Auto"
              onChange={(e) => {
                const raw = e.target.value;
                // Empty input clears the override → renderer auto-fit (null).
                if (raw === "") {
                  onChange({ fontSize: null });
                  return;
                }
                onChange({
                  fontSize: clamp(Math.round(Number(raw)), FONT_SIZE_MIN_PX, FONT_SIZE_MAX_PX),
                });
              }}
              data-testid="field-font-size"
            />
            <button
              type="button"
              className={fontSize === null ? "btn btn-chip btn-chip-active" : "btn btn-chip"}
              onClick={() => onChange({ fontSize: null })}
              data-testid="field-font-size-auto"
            >
              Auto
            </button>
          </div>
          <div className="chip-row">
            {SIZE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                className={fontSize === size ? "btn btn-chip btn-chip-active" : "btn btn-chip"}
                onClick={() => onChange({ fontSize: size })}
                data-testid={`field-font-size-${size}`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Weight</span>
          <div className="chip-row">
            {FONT_WEIGHTS.map((weight) => (
              <button
                key={weight}
                type="button"
                className={fontWeight === weight ? "btn btn-chip btn-chip-active" : "btn btn-chip"}
                style={{ fontWeight: weight }}
                aria-pressed={fontWeight === weight}
                onClick={() => onChange({ fontWeight: weight })}
                data-testid={`field-weight-${weight}`}
              >
                {WEIGHT_LABELS[weight]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Alignment</span>
          <div className="chip-row">
            {TEXT_ALIGNS.map((align) => (
              <button
                key={align}
                type="button"
                className={textAlign === align ? "btn btn-chip btn-chip-active" : "btn btn-chip"}
                aria-pressed={textAlign === align}
                onClick={() => onChange({ textAlign: align })}
                data-testid={`field-align-${align}`}
              >
                {align}
              </button>
            ))}
          </div>
        </div>

        <label className="field field-inline">
          <span>Line height</span>
          <input
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.05}
            value={lineHeight}
            onChange={(e) =>
              onChange({
                lineHeight: clamp(Number(e.target.value), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
              })
            }
            data-testid="field-line-height"
          />
          <output>{lineHeight.toFixed(2)}</output>
        </label>

        <label className="field field-inline">
          <span>Letter spacing</span>
          <input
            type="range"
            min={LETTER_SPACING_MIN_EM}
            max={LETTER_SPACING_MAX_EM}
            step={0.01}
            value={letterSpacing}
            onChange={(e) =>
              onChange({
                letterSpacing: clamp(
                  Number(e.target.value),
                  LETTER_SPACING_MIN_EM,
                  LETTER_SPACING_MAX_EM,
                ),
              })
            }
            data-testid="field-letter-spacing"
          />
          <output>{letterSpacing.toFixed(2)}em</output>
        </label>
      </fieldset>

      {/* --- Color ---------------------------------------------------------- */}
      <fieldset className="field-group" data-testid="group-color">
        <legend>Color</legend>
        <ColorPicker
          label="Text"
          value={textColor}
          projectPalette={projectPalette}
          onChange={(hex) => onChange({ textColor: hex })}
          testId="field-text-color"
        />
        <ColorPicker
          label="Fill"
          value={overlay.fill}
          projectPalette={projectPalette}
          onChange={(hex) => onChange({ fill: hex })}
          testId="field-fill-color"
        />
        <ColorPicker
          label="Border"
          value={overlay.border?.color ?? "#101010"}
          projectPalette={projectPalette}
          onChange={(hex) =>
            onChange({
              border: { width: overlay.border?.width ?? 2, color: hex },
            })
          }
          testId="field-border-color"
        />
        <label className="field field-inline">
          <span>Fill opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={overlay.opacity}
            onChange={(e) => onChange({ opacity: Number(e.target.value) })}
            data-testid="field-opacity"
          />
          <output>{overlay.opacity.toFixed(2)}</output>
        </label>
      </fieldset>

      {/* --- Bubble styling ------------------------------------------------- */}
      <fieldset className="field-group" data-testid="group-styling">
        <legend>Styling</legend>

        <label className="field field-inline">
          <input
            type="checkbox"
            checked={overlay.border !== null}
            onChange={(e) =>
              onChange({ border: e.target.checked ? { width: 2, color: "#101010" } : null })
            }
            data-testid="field-border-toggle"
          />
          <span>Custom border</span>
        </label>
        {overlay.border !== null && (
          <label className="field field-inline">
            <span>Border width</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={overlay.border.width}
              onChange={(e) =>
                onChange({
                  border: {
                    width: Math.max(0, Number(e.target.value)),
                    color: overlay.border?.color ?? "#101010",
                  },
                })
              }
              data-testid="field-border-width"
            />
          </label>
        )}

        <label className="field field-inline">
          <span>Corner radius</span>
          <input
            type="number"
            min={CORNER_RADIUS_MIN_PX}
            max={CORNER_RADIUS_MAX_PX}
            step={1}
            value={overlay.cornerRadius ?? ""}
            placeholder="Default"
            onChange={(e) => {
              const raw = e.target.value;
              // Empty input clears the override → per-kind default radius.
              if (raw === "") {
                onChange({ cornerRadius: undefined });
                return;
              }
              onChange({
                cornerRadius: clamp(Number(raw), CORNER_RADIUS_MIN_PX, CORNER_RADIUS_MAX_PX),
              });
            }}
            data-testid="field-corner-radius"
          />
        </label>

        <div className="field">
          <span>Tail</span>
          {supportsTail ? (
            <div className="field-inline">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  onChange({
                    tail: overlay.tail
                      ? null
                      : {
                          // Default tip just below the box center, inside the image.
                          x: clamp(overlay.geometry.x + overlay.geometry.width / 2, 0, 1),
                          y: clamp(overlay.geometry.y + overlay.geometry.height + 0.06, 0, 1),
                        },
                  })
                }
                data-testid="field-tail-toggle"
              >
                {overlay.tail ? "Clear tail" : "Add tail"}
              </button>
              <span className="field-hint">
                {overlay.tail ? "Drag the tail handle on the canvas to aim it." : "No tail."}
              </span>
            </div>
          ) : (
            <span className="field-hint">This kind does not draw a tail.</span>
          )}
        </div>
      </fieldset>

      {/* --- Arrangement ---------------------------------------------------- */}
      <fieldset className="field-group" data-testid="group-arrangement">
        <legend>Arrangement</legend>

        <div className="field">
          <span>Stacking order (z {zIndex})</span>
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-chip"
              onClick={onSendToBack}
              data-testid="field-z-send-to-back"
            >
              To back
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onClick={onSendBackward}
              data-testid="field-z-send-backward"
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onClick={onBringForward}
              data-testid="field-z-bring-forward"
            >
              Forward
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onClick={onBringToFront}
              data-testid="field-z-bring-to-front"
            >
              To front
            </button>
          </div>
        </div>

        <div className="field">
          <span>Nudge</span>
          <div className="nudge-pad">
            <button
              type="button"
              className="btn btn-chip nudge-up"
              onClick={() => onNudge(0, -NUDGE)}
              aria-label="Nudge up"
              data-testid="field-nudge-up"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-chip nudge-left"
              onClick={() => onNudge(-NUDGE, 0)}
              aria-label="Nudge left"
              data-testid="field-nudge-left"
            >
              ←
            </button>
            <button
              type="button"
              className="btn btn-chip nudge-right"
              onClick={() => onNudge(NUDGE, 0)}
              aria-label="Nudge right"
              data-testid="field-nudge-right"
            >
              →
            </button>
            <button
              type="button"
              className="btn btn-chip nudge-down"
              onClick={() => onNudge(0, NUDGE)}
              aria-label="Nudge down"
              data-testid="field-nudge-down"
            >
              ↓
            </button>
          </div>
        </div>
      </fieldset>

      <label className="field">
        <span>Review status</span>
        <select
          value={overlay.reviewStatus}
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
    </div>
  );
}
