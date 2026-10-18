"use client";

import type { LetteringOverlay } from "@toony/schema";

export function GradientControls({
  overlay,
  onChange,
  embedded = false,
}: {
  overlay: LetteringOverlay;
  onChange: (patch: Partial<LetteringOverlay>) => void;
  embedded?: boolean;
}) {
  const gradient = overlay.fillGradient;
  const Container = embedded ? "div" : "fieldset";
  return (
    <Container className={embedded ? "inspector-fill" : "field-group"}>
      {!embedded && <legend>Bubble fill</legend>}
      <label className="field">
        <span>Fill type</span>
        <select
          aria-label="Bubble fill type"
          value={gradient ? "linear" : "solid"}
          onChange={(e) =>
            onChange({
              fillGradient:
                e.target.value === "solid"
                  ? null
                  : {
                      angle: 90,
                      stops: [
                        {
                          offset: 0,
                          color: /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(overlay.fill)
                            ? overlay.fill
                            : "#ffffff",
                        },
                        { offset: 1, color: "#d9e4ef" },
                      ],
                    },
            })
          }
        >
          <option value="solid">Solid</option>
          <option value="linear">Linear gradient</option>
        </select>
      </label>
      {gradient && (
        <>
          <label className="field">
            <span>Gradient angle</span>
            <input
              aria-label="Gradient angle"
              type="range"
              min={0}
              max={359}
              value={gradient.angle}
              onChange={(e) =>
                onChange({ fillGradient: { ...gradient, angle: Number(e.target.value) } })
              }
            />
            {gradient.angle}°
          </label>
          {gradient.stops.map((stop, index) => (
            <div
              className="gradient-stop-controls"
              // biome-ignore lint/suspicious/noArrayIndexKey: controls edit the ordered stop at this position.
              key={index}
            >
              <input
                aria-label={`Stop ${index + 1} color`}
                type="color"
                value={stop.color.slice(0, 7)}
                onInput={(e) =>
                  onChange({
                    fillGradient: {
                      ...gradient,
                      stops: gradient.stops.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              color:
                                e.currentTarget.value +
                                (s.color.length === 9 ? s.color.slice(7) : ""),
                            }
                          : s,
                      ),
                    },
                  })
                }
              />
              <label>
                Position %
                <input
                  aria-label={`Stop ${index + 1} position`}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(stop.offset * 100)}
                  onChange={(e) => {
                    const value = e.target.valueAsNumber;
                    if (Number.isFinite(value))
                      onChange({
                        fillGradient: {
                          ...gradient,
                          stops: gradient.stops.map((s, i) =>
                            i === index
                              ? {
                                  ...s,
                                  offset: Math.max(
                                    gradient.stops[index - 1]?.offset ?? 0,
                                    Math.min(gradient.stops[index + 1]?.offset ?? 1, value / 100),
                                  ),
                                }
                              : s,
                          ),
                        },
                      });
                  }}
                />
              </label>
              <label>
                Alpha %
                <input
                  aria-label={`Stop ${index + 1} alpha`}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(
                    (stop.color.length === 9 ? Number.parseInt(stop.color.slice(7), 16) / 255 : 1) *
                      100,
                  )}
                  onChange={(e) => {
                    const value = e.target.valueAsNumber;
                    if (Number.isFinite(value))
                      onChange({
                        fillGradient: {
                          ...gradient,
                          stops: gradient.stops.map((s, i) =>
                            i === index
                              ? {
                                  ...s,
                                  color:
                                    s.color.slice(0, 7) +
                                    Math.round((Math.max(0, Math.min(100, value)) * 255) / 100)
                                      .toString(16)
                                      .padStart(2, "0"),
                                }
                              : s,
                          ),
                        },
                      });
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-chip"
                aria-label={`Remove gradient stop ${index + 1}`}
                disabled={gradient.stops.length <= 2}
                onClick={() =>
                  onChange({
                    fillGradient: {
                      ...gradient,
                      stops: gradient.stops.filter((_, i) => i !== index),
                    },
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-chip"
            disabled={gradient.stops.length >= 8}
            onClick={() => {
              let index = 0;
              for (let i = 1; i < gradient.stops.length - 1; i++)
                if (
                  (gradient.stops[i + 1]?.offset ?? 0) - (gradient.stops[i]?.offset ?? 0) >
                  (gradient.stops[index + 1]?.offset ?? 0) - (gradient.stops[index]?.offset ?? 0)
                )
                  index = i;
              const a = gradient.stops[index],
                b = gradient.stops[index + 1];
              if (a && b)
                onChange({
                  fillGradient: {
                    ...gradient,
                    stops: [
                      ...gradient.stops.slice(0, index + 1),
                      { offset: (a.offset + b.offset) / 2, color: a.color },
                      ...gradient.stops.slice(index + 1),
                    ],
                  },
                });
            }}
          >
            Add gradient stop
          </button>
        </>
      )}
    </Container>
  );
}
