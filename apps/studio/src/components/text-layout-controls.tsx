"use client";

import { defaultLetteringTextLayout, type LetteringTextLayout } from "@toony/schema";
import { useEffect, useId, useState } from "react";

function NumericSetting({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (!draft.trim() || !Number.isFinite(Number(draft))) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Number(draft)));
    setDraft(String(next));
    if (next !== value) onCommit(String(next));
  };
  return (
    <input
      id={id}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function TextLayoutControls({
  layout,
  referenceWidth,
  onChange,
}: {
  layout: LetteringTextLayout | undefined;
  referenceWidth: number;
  onChange: (layout: LetteringTextLayout) => void;
}) {
  const baseId = useId();
  if (!layout)
    return (
      <div className="field">
        <button
          type="button"
          className="btn btn-chip"
          onClick={() => onChange(defaultLetteringTextLayout(referenceWidth))}
        >
          Use consistent text sizing
        </button>
        <small>Keep text size consistent across cut heights and exports.</small>
      </div>
    );
  const change = (key: "minFontSize" | "maxFontSize" | "paddingX" | "paddingY", raw: string) => {
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    const padding = key === "paddingX" || key === "paddingY";
    const value = padding
      ? Math.max(0, Math.min(45, number)) / 100
      : Math.max(6, Math.min(200, number));
    onChange({
      ...layout,
      [key]: value,
      ...(key === "minFontSize" ? { maxFontSize: Math.max(value, layout.maxFontSize) } : {}),
      ...(key === "maxFontSize" ? { minFontSize: Math.min(value, layout.minFontSize) } : {}),
    });
  };
  return (
    <div className="field">
      <small>
        Sizes use a {layout.referenceWidth} px artwork width. Auto fit stops at the minimum. Enlarge
        the bubble if text does not fit.
      </small>
      <div className="text-layout-grid">
        <label htmlFor={`${baseId}-min`}>
          Minimum size
          <NumericSetting
            id={`${baseId}-min`}
            label="Minimum fitted text size"
            min={6}
            max={200}
            value={layout.minFontSize}
            onCommit={(raw) => change("minFontSize", raw)}
          />
        </label>
        <label htmlFor={`${baseId}-max`}>
          Maximum size
          <NumericSetting
            id={`${baseId}-max`}
            label="Maximum fitted text size"
            min={6}
            max={200}
            value={layout.maxFontSize}
            onCommit={(raw) => change("maxFontSize", raw)}
          />
        </label>
      </div>
      <div className="text-layout-grid">
        <label htmlFor={`${baseId}-px`}>
          Side padding %
          <NumericSetting
            id={`${baseId}-px`}
            label="Horizontal text padding"
            min={0}
            max={45}
            value={Math.round(layout.paddingX * 100)}
            onCommit={(raw) => change("paddingX", raw)}
          />
        </label>
        <label htmlFor={`${baseId}-py`}>
          Vertical padding %
          <NumericSetting
            id={`${baseId}-py`}
            label="Vertical text padding"
            min={0}
            max={45}
            value={Math.round(layout.paddingY * 100)}
            onCommit={(raw) => change("paddingY", raw)}
          />
        </label>
      </div>
    </div>
  );
}
