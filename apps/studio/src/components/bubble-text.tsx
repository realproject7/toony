"use client";

import type { BubbleRender } from "@toony/render";
import { bubbleTextStyle } from "@/lib/overlay-text-style";
import { svgLetterSpacing, svgTextAnchor } from "@/lib/text-anchor";

/** Every Studio surface draws the same positioned text segments as raster export. */
export function BubbleText({ plan }: { plan: BubbleRender }) {
  return plan.lines.map((line, i) => (
    <text
      // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional render output.
      key={i}
      x={line.anchorX}
      y={line.baselineY ?? line.y + plan.text.fontSize}
      style={bubbleTextStyle(plan)}
      fontSize={plan.text.fontSize}
      fontWeight={plan.fontWeight}
      textAnchor={line.segments ? "start" : svgTextAnchor(plan.textAlign)}
      letterSpacing={svgLetterSpacing(plan.letterSpacing, plan.text.fontSize)}
      fill={plan.textColor}
      stroke={plan.textOutlineWidth > 0 ? plan.stroke : undefined}
      strokeWidth={plan.textOutlineWidth > 0 ? plan.textOutlineWidth : undefined}
      paintOrder="stroke"
      xmlSpace="preserve"
    >
      {line.segments
        ? line.segments.map((segment, j) => (
            <tspan
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional render output.
              key={j}
              x={segment.x}
              y={segment.baselineY}
              style={{ fontFamily: segment.fontStack }}
              fontSize={segment.fontSize}
              fontWeight={segment.fontWeight}
              fill={segment.textColor}
            >
              {segment.text}
            </tspan>
          ))
        : line.text}
    </text>
  ));
}
