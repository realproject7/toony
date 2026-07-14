"use client";

// Cut bubble overlay — the hydrated client boundary for the read-only preview.
//
// `cut-canvas.tsx` is a SERVER component; only the bubble layout needs a browser
// (a real canvas text measurer, #149). This client child owns exactly that: it
// lays out the bubbles with the injected browser measurer so wrap/auto-fit match
// the export raster, and draws them as SVG. Everything else in the cut preview
// stays server-rendered. Until fonts are ready the measurer is null and the
// layout uses `@toony/render`'s deterministic approximation, then re-layouts.

import {
  type BubbleRender,
  IMPACT_BURST_FILL,
  IMPACT_BURST_STROKE,
  IMPACT_RAY_COLOR,
  layoutCut,
} from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";
import { useMemo } from "react";
import { useBrowserMeasure } from "@/lib/browser-measure";
import type { CutArt } from "@/lib/project";
import { svgLetterSpacing, svgTextAnchor } from "@/lib/text-anchor";

/** One bubble drawn as SVG from its geometry-core render plan. */
function Bubble({ plan }: { plan: BubbleRender }) {
  const fontSize = plan.text.fontSize;
  const impact = plan.impact;
  return (
    <g data-bubble-id={plan.id} data-overflow={plan.overflow ? "true" : undefined}>
      {plan.hasBubble && (
        <path
          d={plan.pathD}
          fill={plan.fill}
          fillOpacity={plan.fillOpacity}
          stroke={plan.stroke}
          strokeWidth={plan.strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {/* impact_band SFX (#99): speed-lines + burst behind the text, from the
          SAME pure-segment plan the export canvas traces → pixel parity. */}
      {impact && (
        <g data-testid={`impact-${plan.id}`}>
          {impact.rays.map((ray, i) => (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: rays are a positional, read-only layout output — the index is the stable identity within one layout pass.
              key={`${plan.id}-ray-${i}`}
              x1={ray.x1}
              y1={ray.y1}
              x2={ray.x2}
              y2={ray.y2}
              stroke={IMPACT_RAY_COLOR}
              strokeWidth={impact.rayWidth}
            />
          ))}
          <polygon
            points={impact.burst.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={IMPACT_BURST_FILL}
            stroke={IMPACT_BURST_STROKE}
            strokeWidth={impact.burstStrokeWidth}
            strokeLinejoin="round"
          />
        </g>
      )}
      {plan.lines.map((line, i) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: wrapped lines are a positional, read-only layout output — the index is the stable identity within a single layout pass.
          key={`${plan.id}-line-${i}`}
          x={line.anchorX}
          y={line.y + fontSize}
          fontFamily={plan.fontStack}
          fontSize={fontSize}
          fontWeight={plan.fontWeight}
          textAnchor={svgTextAnchor(plan.textAlign)}
          letterSpacing={svgLetterSpacing(plan.letterSpacing, fontSize)}
          fill={plan.textColor}
          // SFX bare text is outlined so it reads on any background. Width comes
          // from the render plan (single source: `textOutlineWidth`, >0 ⟺ SFX),
          // so the SVG preview and the export raster stroke it identically (#112).
          stroke={plan.textOutlineWidth > 0 ? plan.stroke : undefined}
          strokeWidth={plan.textOutlineWidth > 0 ? plan.textOutlineWidth : undefined}
          paintOrder="stroke"
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}

/**
 * Lay out and draw the cut's bubbles as an SVG overlay at the art's natural
 * pixel dimensions, using a real browser text measurer (#149) so the preview
 * wraps/auto-fits identically to the export raster. Renders nothing when there
 * are no bubbles to draw.
 */
export function CutOverlay({ bubbles, art }: { bubbles: LetteringOverlay[]; art: CutArt }) {
  const measure = useBrowserMeasure();
  const plans = useMemo(
    () => layoutCut(bubbles, art.width, art.height, measure ? { measure } : undefined),
    [bubbles, art.width, art.height, measure],
  );
  if (plans.length === 0) return null;
  return (
    <svg
      className="cut-overlays"
      viewBox={`0 0 ${art.width} ${art.height}`}
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
    >
      {plans.map((plan) => (
        <Bubble key={plan.id} plan={plan} />
      ))}
    </svg>
  );
}
