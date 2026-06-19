"use client";

// Transition block — a real interstitial PANEL in the scroll (#118).
//
// A transition is not a UI gap: it is an image panel between scenes (solid color,
// narration/dialogue/time card, void, fade, or plain reading gutter). This
// renders the SAME panel the export canvas composes (`composeTransitionBand`):
// background fill → optional full-panel gradient → optional fade overlay →
// optional text. Geometry/treatment all come from `@toony/render` — the panel
// height floor, and the panel text size/position via the SHARED `layoutPanelText`
// (v4 cards) / `layoutCardText` (legacy cards) helpers the export canvas also
// consumes — so the studio Read panel and the export raster match, with no
// re-derived constants (the #112 single-source rule; #135/#138).
//
// The panel width is measured so the shared layout helpers get the same effective
// dimensions the export canvas uses. `readOnly` (reader, #49) drops authoring
// chrome — only the rendered panel remains; the preview keeps a small meta chip.

import { layoutCardText, layoutPanelText, layoutTransition } from "@toony/render";
import type { Transition } from "@toony/schema";
import { useEffect, useRef, useState } from "react";

/** The v4 text-panel kinds that use `layoutPanelText` (H/V anchored single line). */
const V4_TEXT_PANELS = new Set(["narration_card", "dialogue_card", "time_card"]);

/** `#rgb`/`#rrggbb` → `rgba(r,g,b,a)`; falls back to the raw color for non-hex. */
function rgba(color: string, alpha: number): string {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  let r: number;
  let g: number;
  let b: number;
  if (m3) {
    r = Number.parseInt(`${m3[1]}${m3[1]}`, 16);
    g = Number.parseInt(`${m3[2]}${m3[2]}`, 16);
    b = Number.parseInt(`${m3[3]}${m3[3]}`, 16);
  } else if (m6) {
    r = Number.parseInt(m6[1] as string, 16);
    g = Number.parseInt(m6[2] as string, 16);
    b = Number.parseInt(m6[3] as string, 16);
  } else {
    return color;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const pct = (v: number, total: number): string => `${(v / Math.max(1, total)) * 100}%`;

export function TransitionBlock({
  transition,
  readOnly,
}: {
  transition: Transition;
  readOnly?: boolean;
}) {
  const plan = layoutTransition(transition);
  const ref = useRef<HTMLDivElement | null>(null);
  // Nominal width until measured (matches a typical reading column); a
  // ResizeObserver then feeds the real width to the shared layout helpers so the
  // panel text geometry equals what the export canvas computes at that width.
  const [width, setWidth] = useState(480);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Panel height: honor the authored gutter height; cards/bands get the SAME
  // width-derived legibility floor the export canvas applies (round(width*0.1)).
  const floored = plan.isCard || plan.treatment === "band";
  const height = Math.max(plan.gutterHeight, floored ? Math.round(width * 0.1) : 0);

  // Background fill, in the SAME precedence the export canvas uses.
  let background: string;
  if (plan.gradient) {
    const { from, to, direction } = plan.gradient;
    const [top, bottom] = direction === "top_bottom" ? [from, to] : [to, from];
    background = `linear-gradient(to bottom, ${top}, ${bottom})`;
  } else if (plan.bandFill) {
    background = plan.bandFill;
  } else if (plan.color) {
    background = plan.color;
  } else if (plan.treatment === "card") {
    background = "#15110d";
  } else if (plan.treatment === "fade") {
    background = "linear-gradient(to bottom, #ffffff, #d9d4cc)";
  } else {
    background = "#ffffff";
  }

  // Optional fade overlay (#115), over the fill, under text.
  let fadeBg: string | null = null;
  if (plan.fade) {
    const { color, length, direction } = plan.fade;
    fadeBg =
      direction === "top_bottom"
        ? `linear-gradient(to bottom, ${rgba(color, 0)} calc(100% - ${length}px), ${rgba(color, 1)} 100%)`
        : `linear-gradient(to bottom, ${rgba(color, 1)} 0, ${rgba(color, 0)} ${length}px)`;
  }

  // Text geometry from the shared render helpers (no re-derived constants):
  // v4 text panels → layoutPanelText (H/V anchored); legacy card/break →
  // layoutCardText (detail + small type label).
  const isV4Text = V4_TEXT_PANELS.has(plan.type);
  const panel = isV4Text ? layoutPanelText(plan, width, height) : null;
  const card =
    !isV4Text && (plan.treatment === "card" || plan.treatment === "break")
      ? layoutCardText(plan, width, height)
      : null;

  const anchorX = (a: "left" | "center" | "right") =>
    a === "left" ? "0" : a === "right" ? "-100%" : "-50%";
  const anchorY = (b: "top" | "middle" | "bottom") =>
    b === "top" ? "0" : b === "bottom" ? "-100%" : "-50%";

  return (
    <div
      ref={ref}
      className="transition-block"
      data-testid={`transition-${transition.id}`}
      data-treatment={plan.treatment}
      data-readonly={readOnly ? "true" : undefined}
      style={{ minHeight: `${height}px`, background }}
    >
      {fadeBg && (
        <div className="transition-fade" style={{ background: fadeBg }} aria-hidden="true" />
      )}
      {plan.treatment === "break" && <div className="transition-rule" aria-hidden="true" />}
      {panel && (
        <span
          className="transition-line"
          style={{
            left: pct(panel.x, width),
            top: pct(panel.y, height),
            transform: `translate(${anchorX(panel.align)}, ${anchorY(panel.baseline)})`,
            fontSize: `${panel.fontSize}px`,
            color: panel.color,
            textAlign: panel.align,
          }}
        >
          {panel.text}
        </span>
      )}
      {card?.lines.map((line, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a card has 1–2 positional lines from a single layout pass; the index is their stable identity.
          key={`${transition.id}-cardline-${i}`}
          className="transition-line"
          style={{
            left: pct(line.x, width),
            top: pct(line.y, height),
            transform: "translate(-50%, -50%)",
            fontSize: `${line.fontSize}px`,
            fontWeight: line.weight,
            color: card.color,
          }}
        >
          {line.text}
        </span>
      ))}
      {!readOnly && (
        <span className="transition-meta">
          {plan.label} · {plan.gutterHeight}px
        </span>
      )}
    </div>
  );
}
