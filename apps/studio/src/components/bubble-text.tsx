"use client";

import type { BubbleRender } from "@toony/render";
import { bubbleTextStyle } from "@/lib/overlay-text-style";
import { svgLetterSpacing, svgTextAnchor } from "@/lib/text-anchor";

/** Every Studio surface draws the same positioned text segments as raster export. */
export function BubbleText({ plan }: { plan: BubbleRender }) {
  return plan.lines.map((line, i) =>
    line.segments ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional render output.
      <g key={i} data-lettering-line={i}>
        {line.segments.map((segment, j) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional render output.
            key={j}
            data-lettering-segment={j}
            x={0}
            y={0}
            transform={`matrix(1 0 ${-segment.skew} 1 ${segment.x + segment.textOffsetX} ${segment.baselineY})`}
            style={{ fontFamily: segment.fontStack, fontStyle: "normal" }}
            fontSize={segment.fontSize}
            fontWeight={segment.fontWeight}
            textAnchor="start"
            letterSpacing={svgLetterSpacing(plan.letterSpacing, plan.text.fontSize)}
            fill={segment.textColor}
            stroke={plan.textOutlineWidth > 0 ? plan.stroke : undefined}
            strokeWidth={plan.textOutlineWidth > 0 ? plan.textOutlineWidth : undefined}
            paintOrder="stroke"
            xmlSpace="preserve"
          >
            {segment.text}
          </text>
        ))}
      </g>
    ) : (
      <text
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional render output.
        key={i}
        x={line.anchorX}
        y={line.baselineY ?? line.y + plan.text.fontSize}
        style={bubbleTextStyle(plan)}
        fontSize={plan.text.fontSize}
        fontWeight={plan.fontWeight}
        textAnchor={svgTextAnchor(plan.textAlign)}
        letterSpacing={svgLetterSpacing(plan.letterSpacing, plan.text.fontSize)}
        fill={plan.textColor}
        stroke={plan.textOutlineWidth > 0 ? plan.stroke : undefined}
        strokeWidth={plan.textOutlineWidth > 0 ? plan.textOutlineWidth : undefined}
        paintOrder="stroke"
        xmlSpace="preserve"
      >
        {line.text}
      </text>
    ),
  );
}
