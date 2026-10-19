"use client";

import type { BubbleRender } from "@toony/render";
import { useId } from "react";

/** The common body fill, gradient and outline for every Studio SVG surface. */
export function BubbleBody({
  plan,
  thumbnail = false,
}: {
  plan: BubbleRender;
  thumbnail?: boolean;
}) {
  const id = `bubble-fill-${useId().replace(/:/g, "")}`;
  const gradient = plan.fillGradient;
  if (!plan.hasBubble) return null;
  return (
    <>
      {gradient && (
        <defs>
          <linearGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            x1={gradient.x1}
            y1={gradient.y1}
            x2={gradient.x2}
            y2={gradient.y2}
          >
            {gradient.stops.map((stop, index) => (
              <stop
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered gradient stops may share an offset.
                key={index}
                offset={stop.offset}
                stopColor={stop.color}
              />
            ))}
          </linearGradient>
        </defs>
      )}
      <path
        d={plan.pathD}
        fill={gradient ? `url(#${id})` : plan.fill}
        fillOpacity={plan.fillOpacity}
        stroke={plan.stroke}
        strokeWidth={thumbnail && plan.strokeWidth > 0 ? 1.1 : plan.strokeWidth}
        strokeDasharray={plan.strokeDash?.join(" ")}
        vectorEffect={thumbnail ? "non-scaling-stroke" : undefined}
        strokeLinejoin="round"
      />
      {plan.accentPathD && <path d={plan.accentPathD} fill={plan.stroke} />}
    </>
  );
}
