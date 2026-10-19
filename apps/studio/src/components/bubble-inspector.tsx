"use client";

// The bubble inspector for the cut editor: Text, Bubble and Layout tabs for ONE
// selected bubble. Text holds who says it, the words and the type; Bubble holds
// the balloon (type, shape, tail, colors); Layout holds stacking, gutter
// placement and exact numbers. Rare controls sit behind "More" disclosures.
//
// Persistence note (from the schema's LETTERING_STYLE_DEFAULTS doc): a style
// field is written only when the person actually changes it. Each control shows
// the resolved default but only sets the field on interaction; it never bakes a
// default onto a bubble that never had one.

import { defaultFontFamilyForKind, FONT_FAMILIES, type FontFamilyId } from "@toony/fonts";
import { bubbleKindStyle, type RenderedTextSegment } from "@toony/render";
import {
  type BubbleKind,
  CORNER_RADIUS_MAX_PX,
  CORNER_RADIUS_MIN_PX,
  defaultLetteringTextLayout,
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
  SFX_MODES,
  type SfxMode,
  TEXT_ALIGNS,
  type TextAlign,
  VERTICAL_ALIGNS,
  type VerticalAlign,
} from "@toony/schema";
import { useEffect, useState } from "react";
import { BUBBLE_PRESETS, bubbleKindPatch } from "@/lib/new-overlay";
import { needsSpeaker } from "@/lib/speaker";
import { AlignmentSymbol } from "./alignment-symbol";
import { BalloonControls } from "./balloon-controls";
import { ColorPicker } from "./color-picker";
import { FontCoverageNotice } from "./font-coverage-notice";
import { GeometryControls } from "./geometry-controls";
import { GradientControls } from "./gradient-controls";
import { InspectorNumberField } from "./inspector-number-field";
import { LetteringTextField } from "./lettering-text-field";
import { SpeakerField } from "./speaker-field";
import { TextLayoutControls } from "./text-layout-controls";

const WEIGHT_LABELS: Record<FontWeight, string> = {
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
};

const ALIGN_LABELS: Record<TextAlign | VerticalAlign, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};

const SFX_LABELS: Record<SfxMode, string> = {
  typeset: "Typeset",
  hand_lettered: "Hand-lettered",
  impact_band: "Impact band",
};

export type InspectorTab = "text" | "bubble" | "layout";

export interface BubbleInspectorProps {
  overlay: LetteringOverlay;
  overflow: boolean;
  referenceWidth: number;
  artWidth: number;
  artHeight: number;
  gutterBandWidth: number;
  fontSegments?: readonly RenderedTextSegment[];
  directSelection?: { start: number; end: number };
  onRestoreSelection?: () => void;
  onChange: (patch: Partial<LetteringOverlay>) => void;
  /** Re-stack the selected bubble. */
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  /** Distinct colors used by other bubbles in this cut. */
  projectPalette: readonly string[];
  /** Picks the default dialogue face the renderer resolves (#213). */
  dialogueLanguage: string;
  /** Names to offer as speakers: the cut's characters first. */
  speakerChoices: readonly string[];
  /** The speaker a bubble gets when it becomes a dialogue kind without one. */
  defaultSpeaker: string;
  /** Open a tab from outside (for example to point at a missing speaker). */
  requestTab?: { tab: InspectorTab; nonce: number } | null;
}

export function BubbleInspector({
  overlay,
  overflow,
  onChange,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  projectPalette,
  dialogueLanguage,
  referenceWidth,
  artWidth,
  artHeight,
  gutterBandWidth,
  fontSegments = [],
  directSelection,
  onRestoreSelection,
  speakerChoices,
  defaultSpeaker,
  requestTab,
}: BubbleInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("text");
  const selectionStart = directSelection?.start ?? 0;
  const selectionEnd = directSelection?.end ?? 0;
  const [rangeSelected, setRangeSelected] = useState(false);
  useEffect(() => {
    if (selectionEnd > selectionStart) setTab("text");
  }, [selectionStart, selectionEnd]);
  useEffect(() => {
    if (requestTab) setTab(requestTab.tab);
  }, [requestTab]);

  const fontSize = overlay.fontSize ?? null;
  const fontWeight: FontWeight = overlay.fontWeight ?? bubbleKindStyle(overlay.kind).fontWeight;
  const lineHeight = overlay.lineHeight ?? LETTERING_STYLE_DEFAULTS.lineHeight;
  const textAlign: TextAlign = overlay.textAlign ?? LETTERING_STYLE_DEFAULTS.textAlign;
  const verticalAlign: VerticalAlign = overlay.verticalAlign ?? "top";
  const letterSpacing = overlay.letterSpacing ?? LETTERING_STYLE_DEFAULTS.letterSpacing;
  const textColor = overlay.textColor ?? bubbleKindStyle(overlay.kind).text;
  const placement: Placement = overlay.placement ?? "in_panel";
  const placementSide: PlacementSide = overlay.placementSide ?? "right";
  const sfxMode: SfxMode = overlay.sfxMode ?? "typeset";
  const isSfx = overlay.kind === "sfx";
  const defaultFace = defaultFontFamilyForKind(overlay.kind, dialogueLanguage);
  const defaultFaceName =
    FONT_FAMILIES.find((family) => family.id === defaultFace)?.name ?? "Default";
  const kindChoices = BUBBLE_PRESETS.some((preset) => preset.kind === overlay.kind)
    ? BUBBLE_PRESETS
    : [...BUBBLE_PRESETS, { kind: overlay.kind, label: "Other" }];

  const changeKind = (kind: BubbleKind) => {
    const patch = bubbleKindPatch(overlay, kind);
    if (needsSpeaker(kind) && overlay.speaker.trim() === "" && defaultSpeaker) {
      patch.speaker = defaultSpeaker;
    }
    onChange(patch);
  };

  return (
    <div className="inspector-form inspector-organized" data-testid="bubble-inspector">
      <header className="inspector-header">
        <nav className="inspector-tabs" aria-label="Bubble properties">
          {(["text", "bubble", "layout"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              data-testid={`inspector-tab-${value}`}
            >
              {value === "text" ? "Text" : value === "bubble" ? "Bubble" : "Layout"}
            </button>
          ))}
        </nav>
      </header>
      {overflow && (
        <p className="inspector-overflow" data-testid="inspector-overflow">
          The text does not fit. Make the bubble bigger, the text smaller, or the words shorter.
        </p>
      )}

      <section className="inspector-panel" hidden={tab !== "text"} aria-label="Text properties">
        {needsSpeaker(overlay.kind) && (
          <SpeakerField
            value={overlay.speaker}
            choices={speakerChoices}
            onChange={(speaker) => onChange({ speaker })}
          />
        )}
        <LetteringTextField
          key={overlay.id}
          overlay={overlay}
          referenceWidth={referenceWidth}
          onChange={onChange}
          onSelectionActive={setRangeSelected}
          externalSelection={directSelection}
          onRestoreSelection={onRestoreSelection}
        />
        {!rangeSelected && (
          <fieldset className="field-group inspector-typography" data-testid="group-typography">
            <legend>Type</legend>
            <label className="field inspector-font-family">
              <span className="sr-only">Font</span>
              <select
                value={overlay.fontFamily ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange({ fontFamily: value === "" ? undefined : (value as FontFamilyId) });
                }}
                data-testid="field-font-family"
              >
                <option value="">{defaultFaceName} (default)</option>
                {FONT_FAMILIES.map((family) => (
                  <option key={family.id} value={family.id} style={{ fontFamily: family.stack }}>
                    {family.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="inspector-type-style">
              <label className="field">
                <span className="sr-only">Weight</span>
                <select
                  aria-label="Font weight"
                  value={fontWeight}
                  onChange={(event) =>
                    onChange({ fontWeight: Number(event.target.value) as FontWeight })
                  }
                >
                  {FONT_WEIGHTS.map((weight) => (
                    <option key={weight} value={weight}>
                      {WEIGHT_LABELS[weight]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                aria-pressed={overlay.fontStyle === "italic"}
                onClick={() =>
                  onChange({
                    fontStyle: overlay.fontStyle === "italic" ? "normal" : "italic",
                    textLayout: overlay.textLayout ?? defaultLetteringTextLayout(referenceWidth),
                  })
                }
              >
                <i aria-hidden="true">I</i> Italic
              </button>
            </div>
            <div className="inspector-type-metrics">
              <InspectorNumberField
                label="Size"
                value={fontSize}
                min={FONT_SIZE_MIN_PX}
                max={FONT_SIZE_MAX_PX}
                automatic
                onCommit={(value) => onChange({ fontSize: value })}
                testId="field-font-size"
                action={
                  <button
                    type="button"
                    className="inspector-inline-action"
                    aria-pressed={fontSize === null}
                    onClick={() => onChange({ fontSize: null })}
                    data-testid="field-font-size-auto"
                  >
                    Auto
                  </button>
                }
              />
            </div>
            <div className="field">
              <span>Alignment</span>
              <div className="chip-row inspector-segmented inspector-alignment">
                {TEXT_ALIGNS.map((align) => (
                  <button
                    key={align}
                    type="button"
                    className={
                      textAlign === align ? "btn btn-chip btn-chip-active" : "btn btn-chip"
                    }
                    aria-pressed={textAlign === align}
                    aria-label={`Align text ${align}`}
                    title={ALIGN_LABELS[align]}
                    onClick={() => onChange({ textAlign: align })}
                    data-testid={`field-align-${align}`}
                  >
                    <AlignmentSymbol mode={align} />
                  </button>
                ))}
              </div>
            </div>
            <ColorPicker
              label="Text color"
              value={textColor}
              projectPalette={projectPalette}
              onChange={(hex) => onChange({ textColor: hex })}
              inline
              compact
              testId="field-text-color"
            />
            <details className="inspector-disclosure">
              <summary>More text options</summary>
              <div className="inspector-type-metrics">
                <InspectorNumberField
                  label="Line height"
                  value={lineHeight}
                  min={LINE_HEIGHT_MIN}
                  max={LINE_HEIGHT_MAX}
                  step={0.05}
                  unit="×"
                  testId="field-line-height"
                  onCommit={(value) => value !== null && onChange({ lineHeight: value })}
                />
                <InspectorNumberField
                  label="Letter spacing"
                  value={letterSpacing}
                  min={LETTER_SPACING_MIN_EM}
                  max={LETTER_SPACING_MAX_EM}
                  step={0.01}
                  unit="em"
                  testId="field-letter-spacing"
                  onCommit={(value) => value !== null && onChange({ letterSpacing: value })}
                />
              </div>
              <div className="field">
                <span>Vertical position</span>
                <div className="chip-row inspector-segmented inspector-alignment">
                  {VERTICAL_ALIGNS.map((align) => (
                    <button
                      key={align}
                      type="button"
                      className={
                        verticalAlign === align ? "btn btn-chip btn-chip-active" : "btn btn-chip"
                      }
                      aria-pressed={verticalAlign === align}
                      aria-label={`Place text at the ${align}`}
                      title={ALIGN_LABELS[align]}
                      onClick={() => onChange({ verticalAlign: align })}
                      data-testid={`field-valign-${align}`}
                    >
                      <AlignmentSymbol mode={align} vertical />
                    </button>
                  ))}
                </div>
              </div>
              <TextLayoutControls
                layout={overlay.textLayout}
                referenceWidth={referenceWidth}
                onChange={(textLayout) =>
                  onChange({ textLayout, ...(!overlay.textLayout ? { textRanges: [] } : {}) })
                }
              />
            </details>
          </fieldset>
        )}
        <FontCoverageNotice segments={fontSegments} compact />
      </section>

      <section className="inspector-panel" hidden={tab !== "bubble"} aria-label="Bubble appearance">
        <label className="field">
          <span>Bubble type</span>
          <select
            value={overlay.kind}
            onChange={(event) => changeKind(event.target.value as BubbleKind)}
            data-testid="field-kind"
          >
            {kindChoices.map((preset) => (
              <option key={preset.kind} value={preset.kind}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <BalloonControls
          overlay={overlay}
          onChange={onChange}
          width={artWidth}
          height={artHeight}
          dialogueLanguage={dialogueLanguage}
          gutterBandWidth={gutterBandWidth}
        />
        {isSfx ? (
          <label className="field">
            <span>Lettering style</span>
            <select
              value={sfxMode}
              onChange={(event) => onChange({ sfxMode: event.target.value as SfxMode })}
              data-testid="field-sfx-mode"
            >
              {SFX_MODES.map((value) => (
                <option key={value} value={value}>
                  {SFX_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <fieldset className="field-group" data-testid="group-color">
              <legend>Fill</legend>
              <GradientControls overlay={overlay} onChange={onChange} embedded />
              <div
                className={
                  overlay.fillGradient ? "inspector-gradient-opacity" : "inspector-paint-row"
                }
              >
                {!overlay.fillGradient && (
                  <ColorPicker
                    label="Fill color"
                    value={overlay.fill}
                    projectPalette={projectPalette}
                    onChange={(hex) => onChange({ fill: hex })}
                    inline
                    compact
                    testId="field-fill-color"
                  />
                )}
                <InspectorNumberField
                  label="Opacity"
                  value={Math.round(overlay.opacity * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  testId="field-opacity"
                  onCommit={(value) => value !== null && onChange({ opacity: value / 100 })}
                />
              </div>
            </fieldset>
            <fieldset className="field-group" data-testid="group-styling">
              <legend>Outline</legend>
              <div className="inspector-paint-row">
                <ColorPicker
                  label="Outline color"
                  value={overlay.border?.color ?? bubbleKindStyle(overlay.kind).stroke}
                  projectPalette={projectPalette}
                  onChange={(hex) =>
                    onChange({ border: { width: overlay.border?.width ?? 2, color: hex } })
                  }
                  inline
                  compact
                  testId="field-border-color"
                />
                <InspectorNumberField
                  label="Width"
                  value={overlay.border?.width ?? null}
                  min={0}
                  max={Number.MAX_SAFE_INTEGER}
                  step={0.5}
                  unit="px"
                  automatic
                  testId="field-border-width"
                  onCommit={(value) =>
                    onChange({
                      border:
                        value === null
                          ? null
                          : {
                              width: value,
                              color: overlay.border?.color ?? bubbleKindStyle(overlay.kind).stroke,
                            },
                    })
                  }
                />
              </div>
            </fieldset>
            {(!overlay.balloonShape || overlay.balloonShape === "rounded") && (
              <InspectorNumberField
                label="Corner radius"
                value={overlay.cornerRadius ?? null}
                min={CORNER_RADIUS_MIN_PX}
                max={CORNER_RADIUS_MAX_PX}
                unit="px"
                automatic
                testId="field-corner-radius"
                onCommit={(value) => onChange({ cornerRadius: value ?? undefined })}
              />
            )}
          </>
        )}
      </section>

      <section className="inspector-panel" hidden={tab !== "layout"} aria-label="Bubble layout">
        <fieldset className="field-group" data-testid="group-arrangement">
          <legend>Stacking</legend>
          <div className="chip-row inspector-segmented inspector-stacking">
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
        </fieldset>
        <fieldset className="field-group" data-testid="group-craft">
          <legend>Placement</legend>
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
                {value === "in_panel" ? "On the art" : "Beside the art"}
              </button>
            ))}
          </div>
          {placement === "gutter" && (
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
                  {value === "left" ? "Left side" : "Right side"}
                </button>
              ))}
            </div>
          )}
        </fieldset>
        <details className="inspector-disclosure">
          <summary>Exact position</summary>
          <GeometryControls overlay={overlay} onChange={onChange} />
          <div className="field">
            <span>Speaker outside the cut</span>
            {overlay.tailTarget ? (
              <>
                <div className="geometry-controls">
                  <InspectorNumberField
                    label="Across"
                    value={overlay.tailTarget.x}
                    min={-4}
                    max={5}
                    step={0.05}
                    testId="field-tail-target-x"
                    onCommit={(value) =>
                      value !== null &&
                      onChange({ tailTarget: { x: value, y: overlay.tailTarget?.y ?? 0 } })
                    }
                  />
                  <InspectorNumberField
                    label="Down"
                    value={overlay.tailTarget.y}
                    min={-4}
                    max={5}
                    step={0.05}
                    testId="field-tail-target-y"
                    onCommit={(value) =>
                      value !== null &&
                      onChange({ tailTarget: { x: overlay.tailTarget?.x ?? 0, y: value } })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-chip"
                  onClick={() => onChange({ tailTarget: null })}
                  data-testid="field-tail-target-clear"
                >
                  Point inside the cut
                </button>
                <span className="field-hint">
                  0 to 1 is inside the art. Smaller or larger values point past its edge.
                </span>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => onChange({ tailTarget: { x: -0.1, y: 0.5 } })}
                data-testid="field-tail-target-add"
              >
                Point the tail outside the cut
              </button>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}
