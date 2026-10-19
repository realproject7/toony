"use client";

import type { LetteringOverlay } from "@toony/schema";
import { resolvedTailStyle } from "@/lib/new-overlay";

export function GeometryControls({
  overlay,
  onChange,
}: {
  overlay: LetteringOverlay;
  onChange: (patch: Partial<LetteringOverlay>) => void;
}) {
  return (
    <fieldset className="field-group">
      <legend>Position and size</legend>
      <div className="geometry-controls">
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label className="field" key={key}>
            <span>
              {{ x: "X", y: "Y", width: "Width", height: "Height" }[key]}{" "}
              <span className="field-unit">%</span>
            </span>
            <input
              key={`${overlay.id}-${key}-${overlay.geometry[key]}`}
              aria-label={`Bubble ${key} percent`}
              type="number"
              min={0}
              max={100}
              step={0.1}
              defaultValue={Number((overlay.geometry[key] * 100).toFixed(1))}
              onBlur={(event) => {
                if (!event.target.value.trim()) return;
                const value = Number(event.target.value) / 100;
                if (!Number.isFinite(value)) return;
                const g = { ...overlay.geometry };
                if (Number(event.target.value) === Number((g[key] * 100).toFixed(1))) return;
                if (key === "x") g.x = Math.max(0, Math.min(1 - g.width, value));
                if (key === "y") g.y = Math.max(0, Math.min(1 - g.height, value));
                if (key === "width") g.width = Math.max(0.04, Math.min(1 - g.x, value));
                if (key === "height") g.height = Math.max(0.03, Math.min(1 - g.y, value));
                onChange({ geometry: g });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        ))}
      </div>
      {overlay.tail && (
        <div className="geometry-controls">
          {(["x", "y"] as const).map((key) => (
            <label className="field" key={key}>
              <span>
                Tail {key.toUpperCase()} <span className="field-unit">%</span>
              </span>
              <input
                aria-label={`Tail ${key} percent`}
                disabled={resolvedTailStyle(overlay) === "none"}
                type="number"
                min={0}
                max={100}
                step={0.1}
                key={`${overlay.id}-${key}-${overlay.tail?.[key]}`}
                defaultValue={Number(((overlay.tail?.[key] ?? 0) * 100).toFixed(1))}
                onBlur={(event) => {
                  const value = Number(event.target.value) / 100;
                  if (
                    !event.target.value.trim() ||
                    !Number.isFinite(value) ||
                    !overlay.tail ||
                    Number(event.target.value) === Number((overlay.tail[key] * 100).toFixed(1))
                  )
                    return;
                  onChange({ tail: { ...overlay.tail, [key]: Math.max(0, Math.min(1, value)) } });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
