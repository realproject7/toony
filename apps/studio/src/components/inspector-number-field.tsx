"use client";

import { type ReactNode, useId } from "react";
import { clamp } from "@/lib/clamp";

/** Commit a complete numeric edit once; clearing an automatic value restores auto. */
export function InspectorNumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  automatic = false,
  onCommit,
  testId,
  action,
  hideLabel = false,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  automatic?: boolean;
  onCommit: (value: number | null) => void;
  testId?: string;
  action?: ReactNode;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="field inspector-number">
      <div className={hideLabel ? "inspector-number-heading sr-only" : "inspector-number-heading"}>
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <span className="inspector-number-input">
        <input
          key={value ?? "auto"}
          id={id}
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          defaultValue={value ?? ""}
          placeholder={automatic ? "Auto" : undefined}
          data-testid={testId}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim();
            if (!raw || !Number.isFinite(Number(raw))) {
              event.currentTarget.value = automatic ? "" : String(value ?? "");
              if (automatic && value !== null) onCommit(null);
              return;
            }
            // Existing documents may carry more precision than the editing step.
            // Focusing or cancelling an input must not rewrite those values.
            if (Number(raw) === value) return;
            const precision = String(step).split(".")[1]?.length ?? 0;
            const next = clamp(Number(Number(raw).toFixed(precision)), min, max);
            event.currentTarget.value = String(next);
            if (next !== value) onCommit(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.value = String(value ?? "");
              event.currentTarget.blur();
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        {unit && (
          <span className="inspector-unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
