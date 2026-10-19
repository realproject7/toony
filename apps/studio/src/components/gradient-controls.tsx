"use client";

import type { LetteringOverlay } from "@toony/schema";
import { InspectorNumberField } from "./inspector-number-field";

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
      <fieldset className="inspector-segmented inspector-fill-type" aria-label="Bubble fill type">
        {(["solid", "linear"] as const).map((type) => (
          <button
            type="button"
            key={type}
            className="btn"
            aria-pressed={type === (gradient ? "linear" : "solid")}
            onClick={() => {
              if ((type === "linear") === Boolean(gradient)) return;
              onChange({
                fillGradient:
                  type === "solid"
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
              });
            }}
          >
            {type === "solid" ? "Solid" : "Gradient"}
          </button>
        ))}
      </fieldset>
      {gradient && (
        <>
          <div className="inspector-gradient-preview-row">
            <div
              className="inspector-gradient-preview"
              aria-hidden="true"
              style={{
                background: `linear-gradient(${gradient.angle + 90}deg, ${gradient.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ")})`,
              }}
            />
            <InspectorNumberField
              label="Angle"
              value={gradient.angle}
              min={0}
              max={359}
              unit="°"
              onCommit={(value) =>
                value !== null && onChange({ fillGradient: { ...gradient, angle: value } })
              }
            />
          </div>
          <div className="gradient-stops">
            <div className="gradient-stop-headings" aria-hidden="true">
              <span>Color</span>
              <span>Position %</span>
              <span>Opacity %</span>
              <span />
            </div>
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
                <InspectorNumberField
                  label={`Stop ${index + 1} position`}
                  hideLabel
                  min={0}
                  max={100}
                  value={Math.round(stop.offset * 100)}
                  onCommit={(value) =>
                    value !== null &&
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
                    })
                  }
                />
                <InspectorNumberField
                  label={`Stop ${index + 1} alpha`}
                  hideLabel
                  min={0}
                  max={100}
                  value={Math.round(
                    (stop.color.length === 9 ? Number.parseInt(stop.color.slice(7), 16) / 255 : 1) *
                      100,
                  )}
                  onCommit={(value) =>
                    value !== null &&
                    onChange({
                      fillGradient: {
                        ...gradient,
                        stops: gradient.stops.map((s, i) =>
                          i === index
                            ? {
                                ...s,
                                color:
                                  s.color.slice(0, 7) +
                                  Math.round((value * 255) / 100)
                                    .toString(16)
                                    .padStart(2, "0"),
                              }
                            : s,
                        ),
                      },
                    })
                  }
                />
                <button
                  type="button"
                  className="btn gradient-stop-remove"
                  title={`Remove stop ${index + 1}`}
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
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn gradient-stop-add"
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
            + Add color stop
          </button>
        </>
      )}
    </Container>
  );
}
