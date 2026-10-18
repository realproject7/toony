"use client";

import { FONT_FAMILIES } from "@toony/fonts";
import { bubbleKindStyle } from "@toony/render";
import {
  defaultLetteringTextLayout,
  type LetteringOverlay,
  type LetteringStylePatch,
  letteringGraphemeBoundaries,
  reconcileLetteringText,
  styleLetteringRange,
} from "@toony/schema";
import { useEffect, useRef, useState } from "react";

/** Native input keeps IME ownership; only explicit selection actions add rich ranges. */
export function LetteringTextField({
  overlay,
  referenceWidth,
  onChange,
  externalSelection,
  onRestoreSelection,
  onSelectionActive,
}: {
  overlay: LetteringOverlay;
  referenceWidth: number;
  onChange: (patch: Partial<LetteringOverlay>) => void;
  externalSelection?: { start: number; end: number };
  onRestoreSelection?: () => void;
  onSelectionActive?: (active: boolean) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [localSelection, setSelection] = useState({ start: 0, end: 0 });
  const selection = externalSelection ?? localSelection;
  const select = (input: HTMLTextAreaElement) => {
    const bounds = letteringGraphemeBoundaries(input.value);
    const start = bounds.filter((b) => b <= input.selectionStart).at(-1) ?? 0;
    const end = bounds.find((b) => b >= input.selectionEnd) ?? input.value.length;
    setSelection({ start, end });
  };
  const hasSelection = selection.end > selection.start && selection.end <= overlay.text.length;
  useEffect(() => onSelectionActive?.(hasSelection), [hasSelection, onSelectionActive]);
  const selected = overlay.text.slice(selection.start, selection.end);
  const common = (key: "fontFamily" | "fontWeight" | "fontSize" | "fontStyle" | "textColor") => {
    const values = new Set(
      letteringGraphemeBoundaries(overlay.text)
        .filter((b) => b >= selection.start && b < selection.end)
        .map((b) => overlay.textRanges?.find((r) => r.start <= b && b < r.end)?.style[key]),
    );
    return values.size === 1 ? [...values][0] : undefined;
  };
  const effective = (key: "fontWeight" | "fontStyle") => {
    const inherited =
      key === "fontStyle"
        ? (overlay.fontStyle ?? "normal")
        : (overlay.fontWeight ?? bubbleKindStyle(overlay.kind).fontWeight);
    const values = new Set(
      letteringGraphemeBoundaries(overlay.text)
        .filter((b) => b >= selection.start && b < selection.end)
        .map(
          (b) =>
            overlay.textRanges?.find((r) => r.start <= b && b < r.end)?.style[key] ?? inherited,
        ),
    );
    return values.size === 1 ? [...values][0] : undefined;
  };
  const apply = (patch: LetteringStylePatch, restoreFocus = true) => {
    if (!hasSelection) return;
    const doc = styleLetteringRange(overlay, selection.start, selection.end, patch);
    if (JSON.stringify(doc.textRanges ?? []) === JSON.stringify(overlay.textRanges ?? [])) return;
    onChange({
      ...doc,
      textLayout: overlay.textLayout ?? defaultLetteringTextLayout(referenceWidth),
    });
    if (restoreFocus) {
      if (externalSelection !== undefined) {
        onRestoreSelection?.();
        return;
      }
      textarea.current?.focus();
      textarea.current?.setSelectionRange(selection.start, selection.end);
    }
  };
  return (
    <div className="field">
      <label hidden={externalSelection !== undefined}>
        <span>Text</span>
        <textarea
          ref={textarea}
          rows={3}
          value={overlay.text}
          onChange={(e) => {
            onChange(reconcileLetteringText(overlay, e.target.value));
            select(e.target);
          }}
          onSelect={(e) => select(e.currentTarget)}
          data-testid="field-text"
        />
      </label>
      {hasSelection ? (
        <fieldset className="field-group" data-testid="selection-typography">
          <legend>Selected text</legend>
          <small className="selection-summary" title={selected}>
            {selected}
          </small>
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-chip"
              onMouseDown={(e) => e.preventDefault()}
              aria-pressed={effective("fontWeight") === 700}
              onClick={() => apply({ fontWeight: effective("fontWeight") === 700 ? 400 : 700 })}
            >
              Bold
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onMouseDown={(e) => e.preventDefault()}
              aria-pressed={effective("fontStyle") === "italic"}
              onClick={() =>
                apply({ fontStyle: effective("fontStyle") === "italic" ? "normal" : "italic" })
              }
            >
              Italic
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                apply({
                  fontFamily: null,
                  fontSize: null,
                  fontWeight: null,
                  fontStyle: null,
                  textColor: null,
                })
              }
            >
              Use bubble style
            </button>
          </div>
          <label className="field">
            <span>Selection font</span>
            <select
              aria-label="Selection font"
              value={common("fontFamily") ?? ""}
              onChange={(e) => {
                apply(
                  {
                    fontFamily: (e.target.value || null) as NonNullable<
                      LetteringOverlay["fontFamily"]
                    > | null,
                  },
                  false,
                );
              }}
            >
              <option value="">Bubble style / mixed</option>
              {FONT_FAMILIES.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Selection size</span>
            <input
              aria-label="Selection font size"
              type="number"
              min={6}
              max={200}
              key={`${selection.start}-${selection.end}-${common("fontSize")}`}
              defaultValue={common("fontSize") ?? ""}
              placeholder="Use bubble size"
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (e.target.value && Number.isFinite(value))
                  apply({ fontSize: Math.max(6, Math.min(200, value)) }, false);
                else if (!e.target.value) apply({ fontSize: null }, false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
          <label className="field">
            <span>Selection color</span>
            <input
              aria-label="Selection text color"
              type="color"
              value={String(common("textColor") ?? "#222222").slice(0, 7)}
              onInput={(e) => apply({ textColor: e.currentTarget.value }, false)}
            />
          </label>
        </fieldset>
      ) : (
        <small>Select words to style them separately.</small>
      )}
    </div>
  );
}
